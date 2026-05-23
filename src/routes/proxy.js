const express = require('express');
const https = require('https');
const http = require('http');
const db = require('../db');
const keypool = require('../services/keypool');
const router_service = require('../services/router');
const quota = require('../services/quota');
const alert = require('../services/alert');
const logger = require('../services/logger');
const ws = require('../ws/handler');
const { getConfig } = require('../config');
const { rateLimit } = require('../middleware/ratelimit');
const { retryBudget } = require('../middleware/retry');

const router = express.Router();

// Client key authentication
function clientAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || (req.headers.authorization || '').replace('Bearer ', '');
  if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

  const client = db.prepare('SELECT * FROM client_keys WHERE api_key = ? AND enabled = 1').get(apiKey);
  if (!client) return res.status(401).json({ error: 'Invalid or disabled API key' });

  // IP whitelist check
  if (client.ip_whitelist) {
    const allowed = client.ip_whitelist.split(',').map(s => s.trim());
    if (allowed.length > 0 && !allowed.includes(req.ip) && !allowed.includes('*')) {
      return res.status(403).json({ error: 'IP not whitelisted' });
    }
  }

  req.client = client;
  next();
}

// Model scope check
function checkModelScope(client, model) {
  if (!model) return true;
  if (client.allowed_models === '*') return true;
  const allowed = client.allowed_models.split(',').map(s => s.trim());
  return allowed.includes(model);
}

// Proxy to upstream provider
async function proxyRequest(apiKeyEntry, body, timeout) {
  const { decrypt } = require('../crypto');
  const decryptedKey = decrypt(apiKeyEntry.api_key);
  const provider = apiKeyEntry.provider || 'openai';
  const url = getProviderUrl(provider);
  const parsed = new URL(url);
  const mod = parsed.protocol === 'https:' ? https : http;

  // Adjust headers per provider
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = decryptedKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = 'Bearer ' + decryptedKey;
  }

  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) },
      timeout: timeout || 30000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data), rawData: data });
        } catch {
          resolve({ statusCode: res.statusCode, data: null, rawData: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(payload);
    req.end();
  });
}

function getProviderUrl(provider) {
  const urls = {
    openai: 'https://api.openai.com/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/v1/chat/completions',
    together: 'https://api.together.xyz/v1/chat/completions',
    fireworks: 'https://api.fireworks.ai/inference/v1/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    mistral: 'https://api.mistral.ai/v1/chat/completions',
    custom: 'https://api.openai.com/v1/chat/completions',
  };
  return urls[provider] || urls.openai;
}

// Main proxy endpoint
router.post('/chat/completions', clientAuth, rateLimit, retryBudget, async (req, res) => {
  const startTime = Date.now();
  const { model } = req.body;
  const clientIp = req.ip;
  const maxRetries = parseInt(getConfig('max_retries', '3'));
  const timeout = parseInt(getConfig('request_timeout', '30000'));

  if (!checkModelScope(req.client, model)) {
    return res.status(403).json({ error: `Model '${model}' not allowed for this client key` });
  }

  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const selectedKey = router_service.selectKey(model, clientIp);
    if (!selectedKey) {
      return res.status(503).json({ error: 'No API keys available' });
    }

    // Check quota
    const quotaCheck = quota.check(selectedKey.id);
    if (!quotaCheck.allowed) {
      continue; // Try next key
    }

    try {
      const result = await proxyRequest(selectedKey, req.body, timeout);
      const latency = Date.now() - startTime;
      const usage = result.data && result.data.usage ? result.data.usage : {};

      // Record success
      keypool.recordSuccess(selectedKey.id, latency);

      // Log
      logger.log({
        client_key: req.client.api_key.slice(0, 12) + '...',
        api_key_used: selectedKey.id,
        model,
        status_code: result.statusCode,
        latency_ms: latency,
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        ip_address: clientIp,
      });

      // Broadcast
      ws.broadcastRequest({
        model,
        status: result.statusCode,
        latency,
        key_name: selectedKey.name,
        client: req.client.name,
        timestamp: new Date().toISOString(),
      });

      // Update client stats
      db.prepare('UPDATE client_keys SET total_requests = total_requests + 1 WHERE id = ?').run(req.client.id);

      if (result.statusCode >= 200 && result.statusCode < 300) {
        return res.status(result.statusCode).json(result.data);
      } else {
        lastError = { status: result.statusCode, data: result.data };
        continue;
      }
    } catch (e) {
      lastError = { error: e.message };
      keypool.recordError(selectedKey.id, e.message);
      logger.log({
        client_key: req.client.api_key.slice(0, 12) + '...',
        api_key_used: selectedKey.id,
        model,
        status_code: 0,
        latency_ms: Date.now() - startTime,
        error: e.message,
        ip_address: clientIp,
      });
      continue;
    }
  }

  // All retries failed
  alert.create('proxy_error', `All ${maxRetries} retries failed for model ${model}`, 'error');
  res.status(502).json({ error: 'All API keys failed', last_error: lastError });
});

// Models endpoint (OpenAI compatible)
router.get('/models', clientAuth, (req, res) => {
  const keys = keypool.getEnabled();
  const models = new Set();
  for (const key of keys) {
    const m = JSON.parse(key.models || '[]');
    m.forEach(mod => models.add(mod));
  }
  if (models.size === 0) models.add('gpt-3.5-turbo');

  res.json({
    object: 'list',
    data: Array.from(models).map(m => ({
      id: m,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'mimo-aggregator',
    })),
  });
});

module.exports = router;
