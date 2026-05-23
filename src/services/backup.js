const db = require('../db');
const path = require('path');
const fs = require('fs');

class BackupService {
  constructor() {
    this.interval = null;
  }

  start() {
    const intervalMs = parseInt(require('../config').getConfig('backup_interval', '360')) * 60 * 1000;
    this.interval = setInterval(() => this.create(), intervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  create() {
    const backupDir = path.join(__dirname, '..', '..', 'data', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.db`;
    const dest = path.join(backupDir, filename);

    try {
      db.exec(`VACUUM INTO '${dest}'`);
      const stats = fs.statSync(dest);
      db.prepare('INSERT INTO backups (filename, size) VALUES (?, ?)').run(filename, stats.size);
      this._cleanup();
      return { success: true, filename, size: stats.size };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  restore(filename) {
    const backupDir = path.join(__dirname, '..', '..', 'data', 'backups');
    const src = path.join(backupDir, filename);
    if (!fs.existsSync(src)) return { success: false, error: 'Backup not found' };
    const dest = path.join(__dirname, '..', '..', 'data', 'aggregator.db');
    try {
      fs.copyFileSync(src, dest);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  list() {
    return db.prepare('SELECT * FROM backups ORDER BY created_at DESC').all();
  }

  _cleanup() {
    const backups = db.prepare('SELECT id FROM backups ORDER BY created_at DESC').all();
    if (backups.length > 10) {
      const toDelete = backups.slice(10);
      const backupDir = path.join(__dirname, '..', '..', 'data', 'backups');
      for (const b of toDelete) {
        const row = db.prepare('SELECT filename FROM backups WHERE id = ?').get(b.id);
        if (row) {
          const fp = path.join(backupDir, row.filename);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
          db.prepare('DELETE FROM backups WHERE id = ?').run(b.id);
        }
      }
    }
  }
}

module.exports = new BackupService();
