const { getConfig } = require('../config');

const requestCounts = new Map();

function rateLimit(req, res, next) {
  const clientKey = req.headers['x-api-key'] || req.ip;
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = parseInt(getConfig('global_rate_limit', '100'));

  if (!requestCounts.has(clientKey)) {
    requestCounts.set(clientKey, []);
  }

  const timestamps = requestCounts.get(clientKey).filter(t => now - t < windowMs);
  timestamps.push(now);
  requestCounts.set(clientKey, timestamps);

  if (timestamps.length > maxRequests) {
    return res.status(429).json({ error: 'Rate limit exceeded', retry_after: Math.ceil((timestamps[0] + windowMs - now) / 1000) });
  }

  res.set('X-RateLimit-Limit', String(maxRequests));
  res.set('X-RateLimit-Remaining', String(maxRequests - timestamps.length));
  next();
}

module.exports = { rateLimit };
