// Small helpers used across the server.
import './timezone.js'; // must run before any date is created
import crypto from 'node:crypto';

// ---------- errors ----------
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra; // extra JSON fields sent to the browser, e.g. { customerId }
  }
}
/** Stops the request with an HTTP error, e.g. fail(400, 'Phone number is required') */
export function fail(status, message, extra) {
  throw new HttpError(status, message, extra);
}

// ---------- dates (stored as local time text 'YYYY-MM-DD HH:MM:SS') ----------
const pad = (n) => String(n).padStart(2, '0');

export function toSqlDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function toSqlDateTime(date = new Date()) {
  return `${toSqlDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function parseSqlDateTime(text) {
  const [datePart, timePart = '00:00:00'] = String(text).split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
}
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 0);
  return d;
}
export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
/** Whole calendar days from a to b (b later = positive) */
export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
}

// ---------- random ids ----------
/** Long unguessable secret, safe to put in a URL */
export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}
// No 0/O or 1/I so codes are easy to read out loud and type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(length) {
  let code = '';
  for (const byte of crypto.randomBytes(length)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

// ---------- input cleaning ----------
export function cleanText(value, max = 100) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Accepts "98765 43210", "+91 98765-43210", "09876543210" -> "9876543210" (or null if invalid) */
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Bill amount typed in rupees -> integer paise (or null if invalid) */
export function rupeesToPaise(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return null;
  return Math.round(n * 100);
}

/** "MM-DD" or "YYYY-MM-DD" -> "MM-DD"; '' -> null; anything else -> undefined (invalid) */
export function parseBirthday(value) {
  if (value === undefined || value === null || value === '') return null;
  const match = String(value).match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return undefined;
  return `${match[1]}-${match[2]}`;
}

export function intInRange(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    fail(400, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

export function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s-]+/g, '-')
      .slice(0, 40)
      .replace(/^-|-$/g, '') || 'shop'
  );
}

// ---------- formatting for WhatsApp messages ----------
export function rupees(paise) {
  return '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
export function shortDate(date) {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
/** wa.me link with the message typed in. Without a phone, WhatsApp asks whom to send it to. */
export function whatsappLink(phone, text) {
  return `https://wa.me/${phone ? `91${phone}` : ''}?text=${encodeURIComponent(text)}`;
}
