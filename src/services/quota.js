const db = require('../db');

class Quota {
  checkDaily(keyId) {
    const row = db.prepare("SELECT daily_quota FROM api_keys WHERE id = ?").get(keyId);
    if (!row || row.daily_quota <= 0) return { allowed: true, remaining: Infinity };
    const today = db.prepare(`SELECT COUNT(*) as cnt FROM request_logs WHERE api_key_used = ? AND timestamp >= date('now')`).get(keyId);
    const remaining = row.daily_quota - today.cnt;
    return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: row.daily_quota };
  }

  checkHourly(keyId) {
    const row = db.prepare("SELECT hourly_quota FROM api_keys WHERE id = ?").get(keyId);
    if (!row || row.hourly_quota <= 0) return { allowed: true, remaining: Infinity };
    const hour = db.prepare(`SELECT COUNT(*) as cnt FROM request_logs WHERE api_key_used = ? AND timestamp >= datetime('now', '-1 hour')`).get(keyId);
    const remaining = row.hourly_quota - hour.cnt;
    return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: row.hourly_quota };
  }

  check(keyId) {
    const daily = this.checkDaily(keyId);
    const hourly = this.checkHourly(keyId);
    return {
      allowed: daily.allowed && hourly.allowed,
      daily,
      hourly,
    };
  }
}

module.exports = new Quota();
