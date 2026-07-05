'use strict';

const crypto = require('crypto');

/**
 * Password hashing and token helpers.
 *
 * Passwords are hashed with scrypt and stored as `scrypt$<saltHex>$<hashHex>`.
 * Comparison is constant-time. No external dependencies — uses node:crypto.
 */

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 1) {
    throw new Error('password must be a non-empty string');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Cryptographically-random opaque session/id token. */
function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { hashPassword, verifyPassword, newToken };
