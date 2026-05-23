const http = require('http');

const BASE = 'http://localhost:3000';
let adminToken = '';
let clientKey = '';
let keyId = '';
let clientId = '';
let passed = 0;
let failed = 0;

async function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
    const r = http.request(url, opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, data: d }); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function assert(name, condition) {
  if (condition) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

async function run() {
  console.log('\nMIMO Aggregator v3.0 — Test Suite\n');

  // 1. Health endpoint
  console.log('Health:');
  const h = await req('GET', '/health');
  assert('GET /health returns 200', h.status === 200);
  assert('Health has status ok', h.data.status === 'ok');

  // 2. Login
  console.log('\nAuth:');
  const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  assert('Wrong password returns 401', login.status === 401);
  // Read password from config
  const db = require('../src/db');
  const plainPass = db.prepare("SELECT value FROM config WHERE key = 'admin_password_plain'").get();
  const goodLogin = await req('POST', '/api/auth/login', { username: 'admin', password: plainPass.value });
  assert('Correct login returns token', goodLogin.status === 200 && goodLogin.data.token);
  adminToken = goodLogin.data.token;

  // 3. Dashboard overview
  console.log('\nDashboard:');
  const overview = await req('GET', '/api/admin/overview', null, { Authorization: 'Bearer ' + adminToken });
  assert('Overview returns 200', overview.status === 200);
  assert('Overview has keys', overview.data.keys !== undefined);
  assert('Overview has stats', overview.data.stats !== undefined);

  // 4. API Keys CRUD
  console.log('\nAPI Keys:');
  const addKey = await req('POST', '/api/admin/keys', { name: 'Test Key', provider: 'openai', api_key: 'sk-test-12345', models: ['gpt-4'] }, { Authorization: 'Bearer ' + adminToken });
  assert('Add key returns 200', addKey.status === 200);
  assert('Add key has id', addKey.data.id);
  keyId = addKey.data.id;

  const getKeys = await req('GET', '/api/admin/keys', null, { Authorization: 'Bearer ' + adminToken });
  assert('Get keys returns array', Array.isArray(getKeys.data));
  assert('Keys contain added key', getKeys.data.some(k => k.id === keyId));

  const updateKey = await req('PUT', '/api/admin/keys/' + keyId, { name: 'Updated Key', weight: 5 }, { Authorization: 'Bearer ' + adminToken });
  assert('Update key returns 200', updateKey.status === 200);
  assert('Key name updated', updateKey.data.name === 'Updated Key');

  // 5. Client Keys
  console.log('\nClient Keys:');
  const addClient = await req('POST', '/api/admin/clients', { name: 'Test Client', allowed_models: '*', rate_limit: 30 }, { Authorization: 'Bearer ' + adminToken });
  assert('Add client returns 200', addClient.status === 200);
  assert('Client has api_key', addClient.data.api_key);
  clientKey = addClient.data.api_key;
  clientId = addClient.data.id;

  const getClients = await req('GET', '/api/admin/clients', null, { Authorization: 'Bearer ' + adminToken });
  assert('Get clients returns array', Array.isArray(getClients.data));

  // 6. Routing
  console.log('\nRouting:');
  const getRouting = await req('GET', '/api/admin/routing', null, { Authorization: 'Bearer ' + adminToken });
  assert('Get routing returns strategy', getRouting.data.strategy);

  const setRouting = await req('PUT', '/api/admin/routing', { strategy: 'round-robin' }, { Authorization: 'Bearer ' + adminToken });
  assert('Set routing returns 200', setRouting.status === 200);

  // 7. Analytics
  console.log('\nAnalytics:');
  const analytics = await req('GET', '/api/admin/analytics', null, { Authorization: 'Bearer ' + adminToken });
  assert('Analytics returns 200', analytics.status === 200);
  assert('Analytics has total_requests', analytics.data.total_requests !== undefined);

  // 8. Logs
  console.log('\nLogs:');
  const logs = await req('GET', '/api/admin/logs', null, { Authorization: 'Bearer ' + adminToken });
  assert('Logs returns 200', logs.status === 200);
  assert('Logs has logs array', Array.isArray(logs.data.logs));

  // 9. Settings
  console.log('\nSettings:');
  const settings = await req('GET', '/api/admin/settings', null, { Authorization: 'Bearer ' + adminToken });
  assert('Settings returns 200', settings.status === 200);
  assert('Settings has port', settings.data.port);

  // 10. Proxy endpoint (no keys available, should return 503)
  console.log('\nProxy:');
  const proxy = await req('POST', '/v1/chat/completions', { model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] }, { 'x-api-key': clientKey });
  assert('Proxy with no enabled keys returns 503 or 200', proxy.status === 503 || proxy.status === 200 || proxy.status === 502);

  // 11. Models endpoint
  console.log('\nModels:');
  const models = await req('GET', '/v1/models', null, { 'x-api-key': clientKey });
  assert('Models returns 200', models.status === 200);
  assert('Models has data array', Array.isArray(models.data.data));

  // 12. Alerts
  console.log('\nAlerts:');
  const alertConfig = await req('GET', '/api/admin/alerts/config', null, { Authorization: 'Bearer ' + adminToken });
  assert('Alert config returns 200', alertConfig.status === 200);

  // 13. Backups
  console.log('\nBackups:');
  const backups = await req('GET', '/api/admin/backups', null, { Authorization: 'Bearer ' + adminToken });
  assert('Backups returns 200', backups.status === 200);

  // Cleanup
  await req('DELETE', '/api/admin/keys/' + keyId, null, { Authorization: 'Bearer ' + adminToken });
  await req('DELETE', '/api/admin/clients/' + clientId, null, { Authorization: 'Bearer ' + adminToken });

  // Dashboard page loads
  console.log('\nDashboard HTML:');
  const dash = await new Promise((resolve, reject) => {
    http.get(BASE + '/dashboard', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, html: d }));
    }).on('error', reject);
  });
  assert('Dashboard returns 200', dash.status === 200);
  assert('Dashboard has MIMO Aggregator title', dash.html.includes('MIMO Aggregator'));
  assert('Dashboard has Chart.js', dash.html.includes('chart.js'));

  console.log('\n══════════════════════════════════');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('══════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Test error:', e); process.exit(1); });
