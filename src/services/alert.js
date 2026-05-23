const db = require('../db');
const { getConfig } = require('../config');
const https = require('https');
const http = require('http');

class AlertService {
  constructor() {
    this.wsBroadcast = null;
  }

  setBroadcaster(fn) {
    this.wsBroadcast = fn;
  }

  create(type, message, severity = 'info') {
    db.prepare('INSERT INTO alerts (type, message, severity) VALUES (?, ?, ?)').run(type, message, severity);
    this._notify({ type, message, severity });
    if (this.wsBroadcast) {
      this.wsBroadcast({ type: 'alert', data: { type, message, severity, created_at: new Date().toISOString() } });
    }
  }

  getAll(limit = 100) {
    return db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  async _notify(alert) {
    const discordWebhook = getConfig('discord_webhook', '');
    const telegramToken = getConfig('telegram_bot_token', '');
    const telegramChatId = getConfig('telegram_chat_id', '');
    const genericWebhook = getConfig('generic_webhook', '');

    if (discordWebhook) await this._sendDiscord(discordWebhook, alert);
    if (telegramToken && telegramChatId) await this._sendTelegram(telegramToken, telegramChatId, alert);
    if (genericWebhook) await this._sendGeneric(genericWebhook, alert);
  }

  async _sendDiscord(url, alert) {
    try {
      const payload = JSON.stringify({
        embeds: [{ title: alert.type, description: alert.message, color: alert.severity === 'error' ? 0xff0000 : alert.severity === 'warning' ? 0xffaa00 : 0x00ff00 }],
      });
      await this._httpPost(url, payload, 'application/json');
    } catch {}
  }

  async _sendTelegram(token, chatId, alert) {
    try {
      const text = `[${alert.severity.toUpperCase()}] ${alert.type}\n${alert.message}`;
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      await this._httpPost(url, JSON.stringify({ chat_id: chatId, text }), 'application/json');
    } catch {}
  }

  async _sendGeneric(url, alert) {
    try {
      await this._httpPost(url, JSON.stringify(alert), 'application/json');
    } catch {}
  }

  _httpPost(url, body, contentType) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) }, timeout: 5000 }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = new AlertService();
