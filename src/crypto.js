const crypto = require('crypto');
const { getConfig } = require('./config');

const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
  const key = Buffer.from(getConfig('encryption_key'), 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  const key = Buffer.from(getConfig('encryption_key'), 'hex');
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
