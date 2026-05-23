const WebSocket = require('ws');

class WSHandler {
  constructor() {
    this.clients = new Set();
    this.wss = null;
  }

  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      ws.send(JSON.stringify({ type: 'connected', data: { message: 'Connected to MIMO Aggregator' } }));
    });
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(data); } catch {}
      }
    }
  }

  broadcastRequest(logEntry) {
    this.broadcast({ type: 'request', data: logEntry });
  }

  broadcastKeyUpdate(key) {
    this.broadcast({ type: 'key_update', data: key });
  }

  broadcastStats(stats) {
    this.broadcast({ type: 'stats', data: stats });
  }
}

module.exports = new WSHandler();
