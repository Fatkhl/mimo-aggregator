const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getConfig } = require('./config');

function generateToken(payload) {
  return jwt.sign(payload, getConfig('jwt_secret'), { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, getConfig('jwt_secret'));
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = decoded;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { generateToken, verifyToken, authMiddleware, requireRole };
