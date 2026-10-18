// Password hashing (scrypt), opaque session tokens, login throttling.
import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { ...params, maxmem: SCRYPT_MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const key = await scryptAsync(password.normalize('NFKC'), salt, { N, r, p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// A fixed dummy hash used to equalize timing when no owner exists.
let dummyHashPromise = null;
export function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(24).toString('base64'));
  return dummyHashPromise;
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * In-memory failed-login throttle, keyed per client address plus a global
 * bucket (single owner account, so distributed guessing is also limited).
 */
export class LoginThrottle {
  constructor({ maxAttempts = 5, windowMs = 15 * 60 * 1000, lockoutMs = 15 * 60 * 1000, globalMaxAttempts = 30 } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
    this.globalMaxAttempts = globalMaxAttempts;
    this.buckets = new Map();
  }

  _bucket(key, now) {
    let b = this.buckets.get(key);
    if (!b || (b.lockedUntil <= now && now - b.windowStart > this.windowMs)) {
      b = { count: 0, windowStart: now, lockedUntil: 0 };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Returns remaining lock milliseconds (0 when allowed). */
  check(clientKey, now = Date.now()) {
    if (this.buckets.size > 10000) this._prune(now);
    const keys = [`ip:${clientKey}`, 'global'];
    let wait = 0;
    for (const k of keys) {
      const b = this._bucket(k, now);
      if (b.lockedUntil > now) wait = Math.max(wait, b.lockedUntil - now);
    }
    return wait;
  }

  /** Record an attempt as failed (called before verification, reset on success). */
  fail(clientKey, now = Date.now()) {
    const pairs = [
      [`ip:${clientKey}`, this.maxAttempts],
      ['global', this.globalMaxAttempts],
    ];
    for (const [k, limit] of pairs) {
      const b = this._bucket(k, now);
      b.count += 1;
      if (b.count >= limit) {
        b.lockedUntil = now + this.lockoutMs;
        b.count = 0;
        b.windowStart = now;
      }
    }
  }

  /** Undo the provisional failure for a successful login. */
  succeed(clientKey) {
    this.buckets.delete(`ip:${clientKey}`);
    const g = this.buckets.get('global');
    if (g && g.count > 0) g.count -= 1;
  }

  _prune(now) {
    for (const [k, b] of this.buckets) {
      if (b.lockedUntil <= now && now - b.windowStart > this.windowMs) this.buckets.delete(k);
    }
  }
}
