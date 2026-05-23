const db = require('../db');
const keypool = require('./keypool');
const { getConfig } = require('../config');
const https = require('https');
const http = require('http');

class HealthChecker {
  constructor() {
    this.interval = null;
  }

  start() {
    const intervalMs = parseInt(getConfig('health_check_interval', '60')) * 1000;
    this.interval = setInterval(() => this.checkAll(), intervalMs);
    this.checkAll();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  async checkAll() {
    const keys = keypool.getEnabled();
    for (const key of keys) {
      try {
        await this.checkKey(key.id);
      } catch (e) {
        keypool.recordError(key.id, e.message);
        keypool.updateHealthScore(key.id, 0);
        db.prepare("UPDATE api_keys SET status = 'down', updated_at = datetime('now') WHERE id = ?").run(key.id);
      }
    }
  }

  async checkKey(id) {
    const key = keypool.getDecryptedKey(id);
    if (!key) return null;

    const startTime = Date.now();
    try {
      const result = await this._ping(key);
      const latency = Date.now() - startTime;

      const successRate = key.success_count / Math.max(key.total_requests, 1);
      const latencyScore = Math.max(0, 1 - (latency / 10000));
      const noError = 1 - (key.error_count / Math.max(key.total_requests, 1));
      const score = Math.round(((successRate * 0.4) + (latencyScore * 0.3) + (noError * 0.3)) * 100);

      keypool.updateHealthScore(id, score);
      let status = 'healthy';
      if (score < 50) status = 'down';
      else if (score < 80) status = 'degraded';
      db.prepare("UPDATE api_keys SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);

      return { score, latency, status };
    } catch (e) {
      throw e;
    }
  }

  async _ping(key) {
    return new Promise((resolve, reject) => {
      const url = this._getProviderUrl(key.provider);
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;

      const req = mod.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key.api_key,
        },
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode < 500) resolve({ status: res.statusCode });
          else reject(new Error('HTTP ' + res.statusCode));
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }));
      req.end();
    });
  }

  _getProviderUrl(provider) {
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

  getStats() {
    const keys = keypool.getAll();
    const healthy = keys.filter(k => k.status === 'healthy').length;
    const degraded = keys.filter(k => k.status === 'degraded').length;
    const down = keys.filter(k => k.status === 'down').length;
    const unknown = keys.filter(k => k.status === 'unknown').length;
    return { total: keys.length, healthy, degraded, down, unknown };
  }
}

module.exports = new HealthChecker();
