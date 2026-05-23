const express = require('express');
const db = require('../db');
const keypool = require('../services/keypool');
const router_service = require('../services/router');
const health = require('../services/health');
const quota = require('../services/quota');
const alert = require('../services/alert');
const backup = require('../services/backup');
const logger = require('../services/logger');
const { authMiddleware, requireRole } = require('../auth');
const { getConfig, setConfig } = require('../config');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const router = express.Router();
router.use(authMiddleware);

// Dashboard overview
router.get('/overview', (req, res) => {
  const keys = keypool.getAll();
  const stats = logger.getStats();
  const healthStats = health.getStats();
  const recentLogs = logger.getLogs({ limit: 20 }).logs;
  const alertsRecent = alert.getAll(10);

  res.json({
    keys: { total: keys.length, enabled: keys.filter(k => k.enabled).length, ...healthStats },
    stats,
    recent_logs: recentLogs,
    alerts: alertsRecent,
    routing: { strategy: getConfig('routing_strategy', 'failover') },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// API Keys CRUD
router.get('/keys', (req, res) => {
  res.json(keypool.getAll());
});

router.post('/keys', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const key = keypool.add(req.body);
    res.json(key);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/keys/:id', requireRole('super_admin', 'admin'), (req, res) => {
  const key = keypool.update(req.params.id, req.body);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  res.json(key);
});

router.delete('/keys/:id', requireRole('super_admin'), (req, res) => {
  keypool.delete(req.params.id);
  res.json({ success: true });
});

router.post('/keys/bulk-import', requireRole('super_admin', 'admin'), (req, res) => {
  const { keys } = req.body;
  if (!Array.isArray(keys)) return res.status(400).json({ error: 'keys must be an array' });
  const results = keypool.bulkImport(keys);
  res.json({ results });
});

router.post('/keys/:id/test', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const result = await health.checkKey(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Client Keys
router.get('/clients', (req, res) => {
  res.json(db.prepare('SELECT * FROM client_keys ORDER BY created_at DESC').all());
});

router.post('/clients', requireRole('super_admin', 'admin'), (req, res) => {
  const { name, allowed_models, rate_limit, ip_whitelist } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  const apiKey = 'mk-' + uuidv4().replace(/-/g, '');
  db.prepare('INSERT INTO client_keys (id, name, api_key, allowed_models, rate_limit, ip_whitelist) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, name, apiKey, allowed_models || '*', rate_limit || 60, ip_whitelist || ''
  );
  res.json(db.prepare('SELECT * FROM client_keys WHERE id = ?').get(id));
});

router.put('/clients/:id', requireRole('super_admin', 'admin'), (req, res) => {
  const { name, allowed_models, rate_limit, ip_whitelist, enabled } = req.body;
  const client = db.prepare('SELECT * FROM client_keys WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  db.prepare('UPDATE client_keys SET name = ?, allowed_models = ?, rate_limit = ?, ip_whitelist = ?, enabled = ? WHERE id = ?').run(
    name || client.name, allowed_models || client.allowed_models, rate_limit || client.rate_limit,
    ip_whitelist !== undefined ? ip_whitelist : client.ip_whitelist, enabled !== undefined ? enabled : client.enabled, req.params.id
  );
  res.json(db.prepare('SELECT * FROM client_keys WHERE id = ?').get(req.params.id));
});

router.delete('/clients/:id', requireRole('super_admin'), (req, res) => {
  db.prepare('DELETE FROM client_keys WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Routing config
router.get('/routing', (req, res) => {
  res.json({
    strategy: getConfig('routing_strategy', 'failover'),
    max_retries: parseInt(getConfig('max_retries', '3')),
    request_timeout: parseInt(getConfig('request_timeout', '30000')),
  });
});

router.put('/routing', requireRole('super_admin', 'admin'), (req, res) => {
  const { strategy, max_retries, request_timeout } = req.body;
  if (strategy) setConfig('routing_strategy', strategy);
  if (max_retries !== undefined) setConfig('max_retries', String(max_retries));
  if (request_timeout !== undefined) setConfig('request_timeout', String(request_timeout));
  res.json({ success: true });
});

// Analytics
router.get('/analytics', (req, res) => {
  const { from, to } = req.query;
  res.json(logger.getStats(from, to));
});

// Logs
router.get('/logs', (req, res) => {
  res.json(logger.getLogs(req.query));
});

// Alerts
router.get('/alerts', (req, res) => {
  res.json(alert.getAll(parseInt(req.query.limit) || 100));
});

router.get('/alerts/config', (req, res) => {
  res.json({
    discord_webhook: getConfig('discord_webhook', ''),
    telegram_bot_token: getConfig('telegram_bot_token', ''),
    telegram_chat_id: getConfig('telegram_chat_id', ''),
    generic_webhook: getConfig('generic_webhook', ''),
  });
});

router.put('/alerts/config', requireRole('super_admin'), (req, res) => {
  const { discord_webhook, telegram_bot_token, telegram_chat_id, generic_webhook } = req.body;
  if (discord_webhook !== undefined) setConfig('discord_webhook', discord_webhook);
  if (telegram_bot_token !== undefined) setConfig('telegram_bot_token', telegram_bot_token);
  if (telegram_chat_id !== undefined) setConfig('telegram_chat_id', telegram_chat_id);
  if (generic_webhook !== undefined) setConfig('generic_webhook', generic_webhook);
  res.json({ success: true });
});

router.post('/alerts/test', requireRole('super_admin'), (req, res) => {
  alert.create('test', 'Test alert from MIMO Aggregator', 'info');
  res.json({ success: true });
});

// Backups
router.get('/backups', (req, res) => {
  res.json(backup.list());
});

router.post('/backups', requireRole('super_admin'), (req, res) => {
  const result = backup.create();
  res.json(result);
});

router.post('/backups/:filename/restore', requireRole('super_admin'), (req, res) => {
  const result = backup.restore(req.params.filename);
  res.json(result);
});

// Settings
router.get('/settings', (req, res) => {
  res.json({
    port: getConfig('port', '3000'),
    host: getConfig('host', '0.0.0.0'),
    health_check_interval: getConfig('health_check_interval', '60'),
    backup_interval: getConfig('backup_interval', '360'),
    log_retention_days: getConfig('log_retention_days', '7'),
    global_rate_limit: getConfig('global_rate_limit', '100'),
    routing_strategy: getConfig('routing_strategy', 'failover'),
  });
});

router.put('/settings', requireRole('super_admin'), (req, res) => {
  const allowed = ['port', 'host', 'health_check_interval', 'backup_interval', 'log_retention_days', 'global_rate_limit'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) setConfig(key, String(req.body[key]));
  }
  res.json({ success: true });
});

router.put('/settings/password', requireRole('super_admin'), (req, res) => {
  const { current_password, new_password } = req.body;
  const hash = getConfig('admin_password_hash', '');
  if (!bcrypt.compareSync(current_password || '', hash)) {
    return res.status(400).json({ error: 'Current password incorrect' });
  }
  setConfig('admin_password_hash', bcrypt.hashSync(new_password, 10));
  res.json({ success: true });
});

// Real-time stats
router.get('/stats/realtime', (req, res) => {
  const last5min = db.prepare(`SELECT COUNT(*) as requests, AVG(latency_ms) as avg_latency FROM request_logs WHERE timestamp >= datetime('now', '-5 minutes')`).get();
  const last1hr = db.prepare(`SELECT strftime('%H:%M', timestamp) as time, COUNT(*) as requests FROM request_logs WHERE timestamp >= datetime('now', '-1 hour') GROUP BY strftime('%H:%M', timestamp) ORDER BY time`).all();
  res.json({ current: last5min, hourly: last1hr });
});

module.exports = router;
