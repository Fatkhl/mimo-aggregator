const db = require('../db');

class Logger {
  log({ client_key, api_key_used, model, status_code, latency_ms, prompt_tokens, completion_tokens, total_tokens, error, ip_address }) {
    db.prepare(`INSERT INTO request_logs
      (client_key, api_key_used, model, status_code, latency_ms, prompt_tokens, completion_tokens, total_tokens, error, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(client_key, api_key_used, model, status_code, latency_ms || 0, prompt_tokens || 0, completion_tokens || 0, total_tokens || 0, error || null, ip_address);
  }

  getLogs({ limit = 50, offset = 0, model, client_key, status, search, from, to }) {
    let where = [];
    let params = [];
    if (model) { where.push('model = ?'); params.push(model); }
    if (client_key) { where.push('client_key = ?'); params.push(client_key); }
    if (status) { where.push('status_code = ?'); params.push(parseInt(status)); }
    if (search) { where.push("(model LIKE ? OR client_key LIKE ? OR api_key_used LIKE ? OR error LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
    if (from) { where.push('timestamp >= ?'); params.push(from); }
    if (to) { where.push('timestamp <= ?'); params.push(to); }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db.prepare(`SELECT * FROM request_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM request_logs ${whereClause}`).get(...params).cnt;
    return { logs: rows, total, limit, offset };
  }

  getStats(from, to) {
    let where = '';
    let params = [];
    if (from && to) {
      where = 'WHERE timestamp BETWEEN ? AND ?';
      params = [from, to];
    } else if (from) {
      where = 'WHERE timestamp >= ?';
      params = [from];
    }

    const total = db.prepare(`SELECT COUNT(*) as requests, SUM(total_tokens) as tokens, AVG(latency_ms) as avg_latency FROM request_logs ${where}`).get(...params);
    const byModel = db.prepare(`SELECT model, COUNT(*) as requests, SUM(total_tokens) as tokens, AVG(latency_ms) as avg_latency FROM request_logs ${where} GROUP BY model ORDER BY requests DESC`).all(...params);
    const byHour = db.prepare(`SELECT strftime('%Y-%m-%d %H:00', timestamp) as hour, COUNT(*) as requests, SUM(total_tokens) as tokens FROM request_logs ${where} GROUP BY hour ORDER BY hour DESC LIMIT 168`).all(...params);
    const errors = db.prepare(`SELECT COUNT(*) as cnt FROM request_logs ${where ? where + ' AND' : 'WHERE'} error IS NOT NULL`).get(...params);

    return {
      total_requests: total.requests || 0,
      total_tokens: total.tokens || 0,
      avg_latency: Math.round((total.avg_latency || 0) * 100) / 100,
      error_count: errors.cnt || 0,
      error_rate: total.requests > 0 ? Math.round((errors.cnt / total.requests) * 10000) / 100 : 0,
      by_model: byModel,
      by_hour: byHour,
    };
  }

  cleanup(retentionDays) {
    db.prepare(`DELETE FROM request_logs WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(retentionDays);
  }
}

module.exports = new Logger();
