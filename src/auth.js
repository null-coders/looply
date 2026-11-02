// Login, sessions and passwords for shopkeepers.
//
// * Passwords are hashed with scrypt (built into Node) and a random salt.
//   The database never contains the real password.
// * After login the browser gets a random session token in an httpOnly
//   cookie, so page JavaScript cannot read or steal it. Online (https) the
//   cookie is also marked Secure.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { one, run } from './db.js';
import { addDays, fail, randomToken, toSqlDateTime } from './utils.js';

const COOKIE = 'looply_session';
const SESSION_DAYS = 30;
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function createSession(req, res, shopId) {
  const token = randomToken(32);
  const now = new Date();
  // Clean up old sessions now and then, so the table does not grow forever.
  await run(`DELETE FROM sessions WHERE expires_at < :now`, { now: toSqlDateTime(now) });
  await run(
    `INSERT INTO sessions (token, shop_id, created_at, expires_at) VALUES (:token, :shopId, :createdAt, :expiresAt)`,
    { token, shopId, createdAt: toSqlDateTime(now), expiresAt: toSqlDateTime(addDays(now, SESSION_DAYS)) }
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 86_400_000,
    path: '/',
  });
}

export async function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await run(`DELETE FROM sessions WHERE token = :token`, { token });
  res.clearCookie(COOKIE, { path: '/' });
}

/** Logs out every browser of a shop (used after a password change). */
export async function destroyOtherSessions(req, shopId) {
  const token = readCookie(req, COOKIE);
  await run(`DELETE FROM sessions WHERE shop_id = :shopId AND token != :token`, { shopId, token });
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Middleware: only lets logged-in shopkeepers through and sets req.shop */
export async function requireShop(req, res, next) {
  const token = readCookie(req, COOKIE);
  const session = token
    ? await one(`SELECT shop_id FROM sessions WHERE token = :token AND expires_at > :now`, {
        token,
        now: toSqlDateTime(),
      })
    : null;
  if (!session) fail(401, 'Please log in again.');
  req.shop = await one(`SELECT * FROM shops WHERE id = :id`, { id: session.shop_id });
  if (!req.shop) fail(401, 'Please log in again.');
  next();
}

/**
 * Small in-memory rate limiter (per IP address). It stops someone from
 * guessing passwords or spamming the sign-up form. Online, each server
 * instance counts on its own, which is still enough to slow down guessing.
 */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [key, entry] of hits) if (now - entry.start > windowMs) hits.delete(key);
    }
    const key = req.headers['x-nf-client-connection-ip'] || req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) fail(429, message);
    next();
  };
}
