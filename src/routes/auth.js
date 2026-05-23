const express = require('express');
const bcrypt = require('bcryptjs');
const { getConfig } = require('../config');
const { generateToken, verifyToken, authMiddleware, requireRole } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== 'admin') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const hash = getConfig('admin_password_hash', '');
  if (!bcrypt.compareSync(password || '', hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = generateToken({ username: 'admin', role: 'super_admin' });
  res.json({ token, role: 'super_admin' });
});

router.post('/refresh', authMiddleware, (req, res) => {
  const token = generateToken({ username: req.user.username, role: req.user.role });
  res.json({ token });
});

module.exports = router;
