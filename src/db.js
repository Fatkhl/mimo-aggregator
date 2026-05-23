const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'aggregator.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openai',
    api_key TEXT NOT NULL,
    models TEXT DEFAULT '[]',
    daily_quota INTEGER DEFAULT 0,
    hourly_quota INTEGER DEFAULT 0,
    weight INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'unknown',
    health_score REAL DEFAULT 100,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    avg_latency REAL DEFAULT 0,
    last_used_at TEXT,
    last_error TEXT,
    last_health_check TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS client_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    allowed_models TEXT DEFAULT '*',
    rate_limit INTEGER DEFAULT 60,
    ip_whitelist TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    total_requests INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    client_key TEXT,
    api_key_used TEXT,
    model TEXT,
    status_code INTEGER,
    latency_ms REAL,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    error TEXT,
    ip_address TEXT
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    size INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_logs_client ON request_logs(client_key);
  CREATE INDEX IF NOT EXISTS idx_logs_model ON request_logs(model);
  CREATE INDEX IF NOT EXISTS idx_keys_status ON api_keys(status);
`);

module.exports = db;
