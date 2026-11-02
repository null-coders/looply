// All API endpoints. Every route is short: it reads the request, calls a
// service function (src/services/*) and sends JSON back. Express 5 passes
// errors from async routes to the error handler in src/app.js.
import os from 'node:os';
import express from 'express';
import QRCode from 'qrcode';
import { databaseKind, explainDatabaseError, one, run } from './db.js';
import {
  createSession, destroyOtherSessions, destroySession, hashPassword, rateLimit, requireShop, verifyPassword,
} from './auth.js';
import { TEMPLATES } from './rewards.js';
import {
  createShop, getProgram, getShop, getTiers, shopProfile, updateProgram, updateShopProfile,
} from './services/shops.js';
import {
  createCustomer, customerState, customerVisits, deleteCustomer, findExact, getCustomer,
  listCustomers, searchCustomers, setConsent, updateCustomer,
} from './services/customers.js';
import { previewBill, recordBill, undoBill } from './services/visits.js';
import {
  cancelCoupon, createCoupon, customerCoupons, listCoupons, missingCustomers, upcomingBirthdays,
} from './services/offers.js';
import { cardUrl, welcomeMessage } from './services/messages.js';
import { customersCsv, dashboard, report, visitsCsv } from './services/reports.js';
import { fail, toSqlDate } from './utils.js';

export const api = express.Router();

/** Address that phones should use to open links (card links, QR codes). */
export function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/** Wi-Fi addresses of this computer, e.g. http://192.168.1.5:3000 */
export function lanUrls(port) {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}

async function sendQr(res, text) {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1b2140', light: '#ffffff' },
  });
  res.type('image/svg+xml').set('Cache-Control', 'private, max-age=600').send(svg);
}

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1 || n > 2_000_000_000) fail(404, 'Not found.');
  return n;
};
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

// =============================================================== health

/** Open /api/health to see if the database is connected (and what to fix if not). */
api.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const kind = await databaseKind();
    await one(`SELECT 1 AS ok`);
    res.json({ ok: true, database: kind === 'postgres' ? 'Supabase / Postgres connected' : 'local database' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ ok: false, problem: explainDatabaseError(err) || `Database error (${err.code || 'unknown'}).` });
  }
});

// =============================================================== auth

const DUMMY_HASH = '00000000000000000000000000000000:' + '0'.repeat(128);

const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  message: 'Too many attempts. Wait 15 minutes and try again.',
});

api.post('/auth/register', authLimit, async (req, res) => {
  const shop = await createShop(body(req));
  await createSession(req, res, shop.id);
  res.status(201).json({ shop: shopProfile(shop) });
});

api.post('/auth/login', authLimit, async (req, res) => {
  const email = String(body(req).email ?? '').trim().toLowerCase().slice(0, 120);
  const password = String(body(req).password ?? '').slice(0, 200);
  const shop = await one(`SELECT * FROM shops WHERE email = :email`, { email });
  // Check a password even when the email is unknown, so both answers take the same time.
  const ok = await verifyPassword(password, shop?.password_hash ?? DUMMY_HASH);
  if (!shop || !ok) fail(401, 'Email or password is wrong.');
  await createSession(req, res, shop.id);
  res.json({ shop: shopProfile(shop) });
});

api.post('/auth/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

// =============================================================== public (customers, no login)

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

async function cardByToken(token) {
  if (!TOKEN.test(String(token))) fail(404, 'This card does not exist any more.');
  const customer = await one(`SELECT * FROM customers WHERE card_token = :token`, { token: String(token) });
  if (!customer) fail(404, 'This card does not exist any more.');
  const shop = await getShop(customer.shop_id);
  return { customer, shop };
}

api.get('/public/cards/:token', async (req, res) => {
  const { customer, shop } = await cardByToken(req.params.token);
  const [s, recent] = await Promise.all([customerState(shop, customer), customerVisits(customer.id, 5)]);
  res.set('Cache-Control', 'no-store');
  // Only what the customer should see. No shop notes, no full phone number.
  res.json({
    shop: { name: shop.name, category: shop.category, address: shop.address, phone: shop.phone },
    customer: {
      name: customer.name,
      phoneEnd: customer.phone.slice(-4),
      cardCode: customer.card_code,
      joinedAt: customer.created_at,
      consent: !!customer.marketing_consent,
    },
    visits: s.visits,
    totalSaved: s.totalSaved,
    level: s.level,
    nextVisit: s.nextVisit,
    upcoming: s.upcoming,
    comeback: s.comeback,
    stamps: s.stamps,
    coupons: s.coupons.map(({ code, kind, percent, expiresAt }) => ({ code, kind, percent, expiresAt })),
    tiers: s.tiers,
    recent: recent.map((v) => ({
      date: v.created_at,
      paid: v.final_amount,
      saved: v.discount_amount,
      label: v.discount_label,
      freeReward: v.free_reward,
    })),
  });
});

api.get('/public/cards/:token/qr.svg', async (req, res) => {
  const { customer } = await cardByToken(req.params.token);
  await sendQr(res, cardUrl(baseUrl(req), customer.card_token));
});

const cardLimit = rateLimit({ windowMs: 15 * 60_000, max: 30, message: 'Too many tries. Wait a few minutes.' });

api.put('/public/cards/:token/consent', cardLimit, async (req, res) => {
  const { customer } = await cardByToken(req.params.token);
  const consent = body(req).consent === true;
  await setConsent(customer.id, consent);
  res.json({ consent });
});

api.post('/public/cards/:token/delete', cardLimit, async (req, res) => {
  const { customer } = await cardByToken(req.params.token);
  if (String(body(req).phoneEnd ?? '').trim() !== customer.phone.slice(-4)) {
    fail(400, 'The last 4 digits do not match the mobile number on this card.');
  }
  await deleteCustomer(customer.shop_id, customer.id);
  res.json({ ok: true });
});

async function shopBySlug(slug) {
  const shop = await one(`SELECT * FROM shops WHERE slug = :slug`, { slug: String(slug).slice(0, 60) });
  if (!shop) fail(404, 'This shop link is not valid.');
  return shop;
}

api.get('/public/shops/:slug', async (req, res) => {
  const shop = await shopBySlug(req.params.slug);
  const tiers = await getTiers(shop.id);
  res.json({
    name: shop.name,
    category: shop.category,
    address: shop.address,
    tiers: tiers.map((t) => ({ name: t.name, atVisit: t.min_visits, percent: t.discount_percent })),
    comeback: shop.comeback_enabled ? { percent: shop.comeback_percent, days: shop.comeback_days } : null,
    stamps: shop.stamp_enabled
      ? { every: shop.stamp_every, reward: shop.stamp_reward, welcome: !!shop.welcome_stamp }
      : null,
    birthdayPercent: shop.birthday_percent,
  });
});

const joinLimit = rateLimit({
  windowMs: 60 * 60_000,
  max: 30,
  message: 'Too many sign-ups from this network. Please ask at the counter.',
});

api.post('/public/shops/:slug/join', joinLimit, async (req, res) => {
  const shop = await shopBySlug(req.params.slug);
  try {
    const customer = await createCustomer(shop, body(req), { joinedVia: 'qr' });
    res.status(201).json({ cardPath: `/card/${customer.card_token}` });
  } catch (err) {
    // Never reveal someone else's card link just because their number was typed.
    if (err.status === 409) {
      fail(409, 'This number already has a card here. Ask at the counter and they will send your card link on WhatsApp.');
    }
    throw err;
  }
});

// =============================================================== shopkeeper (login needed)

api.use(requireShop);
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store'); // private shop data: never keep in shared caches
  next();
});

api.get('/me', async (req, res) => {
  const host = req.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  res.json({
    shop: shopProfile(req.shop),
    program: await getProgram(req.shop),
    baseUrl: baseUrl(req),
    joinUrl: `${baseUrl(req)}/join/${req.shop.slug}`,
    // When the app is opened as "localhost", phones cannot open the links in QR codes.
    phoneUrls: local && !process.env.PUBLIC_URL && req.socket?.localPort ? lanUrls(req.socket.localPort) : [],
    today: toSqlDate(new Date()),
  });
});

api.put('/shop', async (req, res) => {
  await updateShopProfile(req.shop, body(req));
  res.json({ ok: true });
});

api.put('/shop/password', async (req, res) => {
  if (!(await verifyPassword(String(body(req).current ?? '').slice(0, 200), req.shop.password_hash))) {
    fail(400, 'Current password is wrong.');
  }
  const next = String(body(req).next ?? '');
  if (next.length < 8) fail(400, 'New password must be at least 8 characters.');
  if (next.length > 200) fail(400, 'New password is too long.');
  await run(`UPDATE shops SET password_hash = :hash WHERE id = :id`, { hash: await hashPassword(next), id: req.shop.id });
  await destroyOtherSessions(req, req.shop.id); // log out other phones and laptops
  res.json({ ok: true });
});

api.get('/shop/join-qr.svg', async (req, res) => {
  await sendQr(res, `${baseUrl(req)}/join/${req.shop.slug}`);
});

api.get('/program', async (req, res) => {
  res.json({
    ...(await getProgram(req.shop)),
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, ...t })),
  });
});

api.put('/program', async (req, res) => {
  await updateProgram(req.shop, body(req));
  res.json(await getProgram(await getShop(req.shop.id)));
});

// ---------- customers

api.get('/customers', async (req, res) => {
  res.json(await listCustomers(req.shop, req.query));
});

/** Counter search: exact match (scan / phone / card code) + name suggestions */
api.get('/customers/lookup', async (req, res) => {
  const q = String(req.query.q ?? '');
  const exact = await findExact(req.shop.id, q);
  res.json({
    exact: exact ? await customerState(req.shop, exact) : null,
    results: exact ? [] : await searchCustomers(req.shop.id, q),
  });
});

api.post('/customers', async (req, res) => {
  const customer = await createCustomer(req.shop, body(req));
  const state = await customerState(req.shop, customer);
  res.status(201).json({
    customer: state,
    whatsappUrl: welcomeMessage({ shop: req.shop, customer, nextVisitPercent: state.nextVisit.percent, baseUrl: baseUrl(req) }),
  });
});

api.get('/customers/:id', async (req, res) => {
  const customer = await getCustomer(req.shop.id, id(req));
  const [state, visits, coupons] = await Promise.all([
    customerState(req.shop, customer),
    customerVisits(customer.id, 100),
    customerCoupons(customer.id),
  ]);
  res.json({
    customer: state,
    visits,
    coupons,
    cardUrl: cardUrl(baseUrl(req), customer.card_token),
    whatsappCardUrl: welcomeMessage({
      shop: req.shop, customer, nextVisitPercent: state.nextVisit.percent, baseUrl: baseUrl(req),
    }),
  });
});

api.put('/customers/:id', async (req, res) => {
  const customer = await updateCustomer(req.shop, id(req), body(req));
  res.json({ customer: await customerState(req.shop, customer) });
});

api.delete('/customers/:id', async (req, res) => {
  await deleteCustomer(req.shop.id, id(req));
  res.json({ ok: true });
});

api.post('/customers/:id/coupons', async (req, res) => {
  const result = await createCoupon(req.shop, id(req), body(req), { baseUrl: baseUrl(req) });
  res.status(result.reused ? 200 : 201).json(result);
});

// ---------- bills

api.post('/visits/preview', async (req, res) => {
  res.json(await previewBill(req.shop, body(req)));
});

api.post('/visits', async (req, res) => {
  res.status(201).json(await recordBill(req.shop, body(req), { baseUrl: baseUrl(req) }));
});

api.post('/visits/:id/undo', async (req, res) => {
  await undoBill(req.shop, id(req));
  res.json({ ok: true });
});

// ---------- offers

api.get('/offers/missing', async (req, res) => res.json({ customers: await missingCustomers(req.shop) }));
api.get('/offers/birthdays', async (req, res) => res.json({ customers: await upcomingBirthdays(req.shop, new Date(), 30) }));
api.get('/coupons', async (req, res) => res.json({ coupons: await listCoupons(req.shop) }));
api.post('/coupons/:id/cancel', async (req, res) => {
  await cancelCoupon(req.shop, id(req));
  res.json({ ok: true });
});

// ---------- numbers

api.get('/dashboard', async (req, res) => res.json(await dashboard(req.shop)));

api.get('/reports', async (req, res) => {
  const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.json(await report(req.shop, days));
});

function sendCsv(res, name, csv) {
  res
    .type('text/csv; charset=utf-8')
    .attachment(`${name}-${toSqlDate(new Date())}.csv`)
    .send('﻿' + csv); // BOM so Excel shows ₹ and Hindi names correctly
}
api.get('/export/customers.csv', async (req, res) => sendCsv(res, 'customers', await customersCsv(req.shop)));
api.get('/export/visits.csv', async (req, res) => sendCsv(res, 'bills', await visitsCsv(req.shop)));
