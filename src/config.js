const db = require('./db');
const crypto = require('crypto');

function getConfig(key, defaultVal) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : defaultVal;
}

function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

function initDefaults() {
  if (!getConfig('admin_password_hash', null)) {
    const bcrypt = require('bcryptjs');
    const password = crypto.randomBytes(8).toString('hex');
    const hash = bcrypt.hashSync(password, 10);
    setConfig('admin_password_hash', hash);
    setConfig('admin_password_plain', password);
  }
  if (!getConfig('encryption_key', null)) {
    setConfig('encryption_key', crypto.randomBytes(32).toString('hex'));
  }
  if (!getConfig('jwt_secret', null)) {
    setConfig('jwt_secret', crypto.randomBytes(32).toString('hex'));
  }
  if (!getConfig('port', null)) {
    setConfig('port', '3000');
  }
  if (!getConfig('host', null)) {
    setConfig('host', '0.0.0.0');
  }
  if (!getConfig('health_check_interval', null)) {
    setConfig('health_check_interval', '60');
  }
  if (!getConfig('backup_interval', null)) {
    setConfig('backup_interval', '360');
  }
  if (!getConfig('log_retention_days', null)) {
    setConfig('log_retention_days', '7');
  }
  if (!getConfig('routing_strategy', null)) {
    setConfig('routing_strategy', 'failover');
  }
  if (!getConfig('max_retries', null)) {
    setConfig('max_retries', '3');
  }
  if (!getConfig('request_timeout', null)) {
    setConfig('request_timeout', '30000');
  }
}

initDefaults();

module.exports = { getConfig, setConfig };
