const db = require('../db');
const { encrypt, decrypt } = require('../crypto');
const { v4: uuidv4 } = require('uuid');

class KeyPool {
  getAll() {
    return db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all();
  }

  getById(id) {
    return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
  }

  getEnabled() {
    return db.prepare('SELECT * FROM api_keys WHERE enabled = 1').all();
  }

  getDecryptedKey(id) {
    const key = this.getById(id);
    if (!key) return null;
    key.api_key = decrypt(key.api_key);
    key.models = JSON.parse(key.models || '[]');
    return key;
  }

  add({ name, provider, api_key, models, daily_quota, hourly_quota, weight }) {
    const id = uuidv4();
    const encrypted = encrypt(api_key);
    db.prepare(`INSERT INTO api_keys (id, name, provider, api_key, models, daily_quota, hourly_quota, weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, name, provider || 'openai', encrypted,
      JSON.stringify(models || []),
      daily_quota || 0, hourly_quota || 0, weight || 1
    );
    return this.getById(id);
  }

  update(id, fields) {
    const allowed = ['name', 'provider', 'api_key', 'models', 'daily_quota', 'hourly_quota', 'weight', 'enabled'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) {
        if (k === 'api_key') {
          sets.push('api_key = ?');
          vals.push(encrypt(v));
        } else if (k === 'models') {
          sets.push('models = ?');
          vals.push(JSON.stringify(v));
        } else {
          sets.push(k + ' = ?');
          vals.push(v);
        }
      }
    }
    if (sets.length === 0) return this.getById(id);
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    db.prepare('UPDATE api_keys SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    return this.getById(id);
  }

  delete(id) {
    db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  }

  recordSuccess(id, latencyMs) {
    const key = this.getById(id);
    if (!key) return;
    const total = key.total_requests + 1;
    const avgLat = ((key.avg_latency * key.total_requests) + latencyMs) / total;
    db.prepare(`UPDATE api_keys SET
      success_count = success_count + 1,
      total_requests = ?,
      avg_latency = ?,
      last_used_at = datetime('now'),
      status = 'healthy',
      updated_at = datetime('now')
      WHERE id = ?`).run(total, Math.round(avgLat * 100) / 100, id);
  }

  recordError(id, error) {
    const key = this.getById(id);
    if (!key) return;
    db.prepare(`UPDATE api_keys SET
      error_count = error_count + 1,
      total_requests = total_requests + 1,
      last_error = ?,
      last_used_at = datetime('now'),
      updated_at = datetime('now')
      WHERE id = ?`).run(String(error).slice(0, 500), id);
    // Mark degraded if error rate > 20%
    const total = key.total_requests + 1;
    const errRate = (key.error_count + 1) / total;
    if (errRate > 0.5) {
      db.prepare("UPDATE api_keys SET status = 'down' WHERE id = ?").run(id);
    } else if (errRate > 0.2) {
      db.prepare("UPDATE api_keys SET status = 'degraded' WHERE id = ?").run(id);
    }
  }

  updateHealthScore(id, score) {
    db.prepare(`UPDATE api_keys SET health_score = ?, last_health_check = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(score, id);
  }

  bulkImport(keys) {
    const results = [];
    for (const k of keys) {
      try {
        const added = this.add(k);
        results.push({ success: true, id: added.id, name: k.name });
      } catch (e) {
        results.push({ success: false, name: k.name, error: e.message });
      }
    }
    return results;
  }
}

module.exports = new KeyPool();
