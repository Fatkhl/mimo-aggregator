const retryBudgets = new Map();

function retryBudget(req, res, next) {
  const clientKey = req.headers['x-api-key'] || req.ip;
  const now = Date.now();
  const windowMs = 60000;
  const maxRetries = 10;

  if (!retryBudgets.has(clientKey)) {
    retryBudgets.set(clientKey, []);
  }

  const timestamps = retryBudgets.get(clientKey).filter(t => now - t < windowMs);
  timestamps.push(now);
  retryBudgets.set(clientKey, timestamps);

  if (timestamps.length > maxRetries) {
    return res.status(429).json({ error: 'Retry budget exceeded', message: 'Too many requests in short period' });
  }

  next();
}

module.exports = { retryBudget };
