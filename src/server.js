const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

// Init config first (generates defaults if needed)
const { getConfig } = require('./config');

const app = express();
const server = http.createServer(app);

// Init WebSocket
const wsHandler = require('./ws/handler');
wsHandler.init(server);

// Init alert broadcaster
const alertService = require('./services/alert');
alertService.setBroadcaster((msg) => wsHandler.broadcast(msg));

// Middleware
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10mb' }));

// Trust proxy for correct IP
app.set('trust proxy', 1);

// Dashboard
app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});
app.get('/dashboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0', uptime: process.uptime() });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/v1', require('./routes/proxy'));
app.use('/api/v1', require('./routes/proxy'));

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start
const PORT = parseInt(getConfig('port', '3000'));
const HOST = getConfig('host', '0.0.0.0');

server.listen(PORT, HOST, () => {
  const password = getConfig('admin_password_plain', 'admin');
  console.log('');
  console.log('\x1b[36m╔══════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[1m\x1b[35mMIMO Key Aggregator v3.0\x1b[0m                              \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m                                                          \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[32m▸\x1b[0m Server:     http://' + HOST + ':' + PORT + '                     \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[32m▸\x1b[0m Dashboard:  http://' + HOST + ':' + PORT + '/dashboard          \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[32m▸\x1b[0m API:        http://' + HOST + ':' + PORT + '/v1/chat/completions\x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[32m▸\x1b[0m WebSocket:  ws://' + HOST + ':' + PORT + '/ws                 \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m                                                          \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[33m👤 Admin Login:\x1b[0m                                         \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m     \x1b[1mUsername:\x1b[0m admin                                       \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m     \x1b[1mPassword:\x1b[0m \x1b[1m\x1b[33m' + password + '\x1b[0m' + ' '.repeat(40 - password.length) + '\x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m     \x1b[31m⚠ Save this password! Shown only once.\x1b[0m               \x1b[36m║\x1b[0m');
  console.log('\x1b[36m╚══════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');

  // Start health checker
  const healthChecker = require('./services/health');
  healthChecker.start();

  // Start backup service
  const backupService = require('./services/backup');
  backupService.start();

  // Cleanup old logs
  const logger = require('./services/logger');
  const retentionDays = parseInt(getConfig('log_retention_days', '7'));
  setInterval(() => logger.cleanup(retentionDays), 3600000);
});

module.exports = { app, server };
