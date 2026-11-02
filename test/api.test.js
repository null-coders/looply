// End-to-end API tests: start the real server on a temporary database
// and talk to it over HTTP, like the browser does.  Run with:  npm test
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

// A fresh Postgres in memory (PGlite) for every test run; never the real database.
// To test against a real, EMPTY Postgres server instead:  TEST_DATABASE_URL=postgres://... npm test
// (its tables are deleted first, so never point it at your real database).
if (process.env.TEST_DATABASE_URL) {
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  await admin.query('DROP TABLE IF EXISTS sessions, visits, coupons, customers, tiers, shops CASCADE');
  await admin.end();
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
  process.env.DB_PATH = 'memory';
}
const { createApp } = await import('../src/app.js');
const { closeDatabase } = await import('../src/db.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server.close();
  await closeDatabase();
});

/** A tiny browser: keeps its own login cookie. */
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
  };
}

const shopA = client();
const shopB = client();
const visitor = client();
let anita;

test('a shopkeeper can register and gets a ready reward program', async () => {
  const r = await shopA('POST', '/auth/register', {
    shopName: 'Test Salon', ownerName: 'Meena', email: 'meena@example.com', password: 'password1', category: 'salon',
  });
  assert.equal(r.status, 201);
  const me = await shopA('GET', '/me');
  assert.equal(me.data.shop.name, 'Test Salon');
  assert.equal(me.data.program.tiers[1].name, 'Silver');
  assert.equal(me.data.program.settings.one_visit_per_day, 1);
});

test('wrong password and missing login are refused', async () => {
  assert.equal((await visitor('POST', '/auth/login', { email: 'meena@example.com', password: 'nope' })).status, 401);
  assert.equal((await visitor('GET', '/customers')).status, 401);
});

test('customers are created once per mobile number', async () => {
  const r = await shopA('POST', '/customers', { name: 'Anita Rao', phone: '+91 98765-43210', birthday: '03-14', consent: true });
  assert.equal(r.status, 201);
  anita = r.data.customer;
  assert.equal(anita.phone, '9876543210');
  assert.match(r.data.whatsappUrl, /^https:\/\/wa\.me\/919876543210\?text=/);

  const dup = await shopA('POST', '/customers', { name: 'Someone', phone: '9876543210' });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.customerId, anita.id);

  assert.equal((await shopA('POST', '/customers', { name: 'X', phone: '12345' })).status, 400);
});

test('bills follow the reward rules', async () => {
  const first = await shopA('POST', '/visits', { customerId: anita.id, bill: 500 });
  assert.equal(first.status, 201);
  assert.equal(first.data.visit.visit_number, 1);
  assert.equal(first.data.visit.discount_amount, 0);

  // Same day again: not a new visit, no comeback offer.
  const again = await shopA('POST', '/visits/preview', { customerId: anita.id, bill: 500 });
  assert.equal(again.data.counts, false);

  // Below the salon minimum (₹200): nothing.
  const small = await shopA('POST', '/visits/preview', { customerId: anita.id, bill: 50 });
  assert.equal(small.data.discountPaise, 0);
});

test('undo removes a bill and gives the coupon back', async () => {
  const coupon = await shopA('POST', `/customers/${anita.id}/coupons`, { kind: 'gift', percent: 40, days: 10 });
  assert.equal(coupon.status, 201);
  const bill = await shopA('POST', '/visits', { customerId: anita.id, bill: 1000 });
  assert.equal(bill.data.visit.discount_type, 'coupon');
  assert.equal(bill.data.visit.discount_amount, 40000);

  assert.equal((await shopA('POST', `/visits/${bill.data.visit.id}/undo`, {})).status, 200);
  const profile = await shopA('GET', `/customers/${anita.id}`);
  assert.equal(profile.data.coupons[0].status, 'active');
  assert.equal(profile.data.customer.bills, 1);
});

test('one shop can never see another shop\'s customers', async () => {
  await shopB('POST', '/auth/register', {
    shopName: 'Other Shop', ownerName: 'Ravi', email: 'ravi@example.com', password: 'password2', category: 'kirana',
  });
  assert.equal((await shopB('GET', `/customers/${anita.id}`)).status, 404);
  assert.equal((await shopB('POST', '/visits', { customerId: anita.id, bill: 300 })).status, 404);
  const lookup = await shopB('GET', `/customers/lookup?q=${anita.cardToken}`);
  assert.equal(lookup.data.exact, null);
  const list = await shopB('GET', '/customers');
  assert.equal(list.data.total, 0);
});

test('the public card shows rewards but not private details', async () => {
  await shopA('PUT', `/customers/${anita.id}`, { name: 'Anita Rao', phone: '9876543210', notes: 'secret note', consent: true });
  const card = await visitor('GET', `/public/cards/${anita.cardToken}`);
  assert.equal(card.status, 200);
  const text = JSON.stringify(card.data);
  assert.ok(!text.includes('secret note'));
  assert.ok(!text.includes('9876543210'));
  assert.equal(card.data.customer.phoneEnd, '3210');

  // The customer can stop offers themselves
  const off = await visitor('PUT', `/public/cards/${anita.cardToken}/consent`, { consent: false });
  assert.equal(off.data.consent, false);
  const winback = await shopA('POST', `/customers/${anita.id}/coupons`, { kind: 'winback' });
  assert.equal(winback.status, 400);
});

test('self sign-up never reveals an existing card', async () => {
  const shop = (await shopA('GET', '/me')).data.shop;
  const joined = await visitor('POST', `/public/shops/${shop.slug}/join`, { name: 'New Person', phone: '9000000001' });
  assert.equal(joined.status, 201);
  assert.match(joined.data.cardPath, /^\/card\/[\w-]{20,}$/);
  const dup = await visitor('POST', `/public/shops/${shop.slug}/join`, { name: 'Faker', phone: '9876543210' });
  assert.equal(dup.status, 409);
  assert.ok(!JSON.stringify(dup.data).includes(anita.cardToken));
});

test('CSV export cannot run Excel formulas', async () => {
  await shopA('POST', '/customers', { name: '=HYPERLINK("http://evil")', phone: '9111111111' });
  const csv = await shopA('GET', '/export/customers.csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.data.includes(`"'=HYPERLINK(""http://evil"")"`));
});

test('requests that are not JSON are refused (CSRF protection)', async () => {
  const res = await fetch(`${base}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=x&phone=9999999999',
  });
  assert.equal(res.status, 415);
});

test('a customer can delete their own card with the last 4 digits', async () => {
  assert.equal((await visitor('POST', `/public/cards/${anita.cardToken}/delete`, { phoneEnd: '0000' })).status, 400);
  assert.equal((await visitor('POST', `/public/cards/${anita.cardToken}/delete`, { phoneEnd: '3210' })).status, 200);
  assert.equal((await visitor('GET', `/public/cards/${anita.cardToken}`)).status, 404);
  // Sales stay in the reports
  const report = await shopA('GET', '/reports?days=7');
  assert.equal(report.data.current.bills, 1);
});

test('two bills at the same moment cannot use one coupon twice', async () => {
  const c = (await shopA('POST', '/customers', { name: 'Ravi Kumar', phone: '9222222222', consent: true })).data.customer;
  await shopA('POST', `/customers/${c.id}/coupons`, { kind: 'gift', percent: 50, days: 5 });
  const [a, b] = await Promise.all([
    shopA('POST', '/visits', { customerId: c.id, bill: 400 }),
    shopA('POST', '/visits', { customerId: c.id, bill: 400 }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const used = [a, b].filter((r) => r.data.visit.discount_type === 'coupon');
  assert.equal(used.length, 1);
  // and only one of them counted as a visit (one visit per day)
  assert.equal([a, b].filter((r) => r.data.visit.counted === 1).length, 1);
});

test('only the newest bill of a customer can be undone', async () => {
  const c = (await shopA('POST', '/customers', { name: 'Undo Test', phone: '9333333333' })).data.customer;
  const first = await shopA('POST', '/visits', { customerId: c.id, bill: 300 });
  const second = await shopA('POST', '/visits', { customerId: c.id, bill: 300 });
  assert.equal((await shopA('POST', `/visits/${first.data.visit.id}/undo`, {})).status, 400);
  assert.equal((await shopA('POST', `/visits/${second.data.visit.id}/undo`, {})).status, 200);
  assert.equal((await shopA('POST', `/visits/${first.data.visit.id}/undo`, {})).status, 200);
});

test('editing a customer without the notes field keeps the notes', async () => {
  const c = (await shopA('POST', '/customers', { name: 'Notes Test', phone: '9444444444' })).data.customer;
  await shopA('PUT', `/customers/${c.id}`, { name: 'Notes Test', phone: '9444444444', notes: 'likes masala chai' });
  await shopA('PUT', `/customers/${c.id}`, { name: 'Notes Tester', phone: '9444444444' });
  const profile = await shopA('GET', `/customers/${c.id}`);
  assert.equal(profile.data.customer.notes, 'likes masala chai');
  assert.equal(profile.data.customer.name, 'Notes Tester');
});

test('reward levels are checked before saving', async () => {
  const program = (await shopA('GET', '/program')).data;
  const base = { ...program.settings };
  const same = await shopA('PUT', '/program', { ...base, tiers: [
    { name: 'Gold', min_visits: 1, discount_percent: 0 }, { name: 'gold', min_visits: 3, discount_percent: 5 },
  ] });
  assert.equal(same.status, 400);
  const lower = await shopA('PUT', '/program', { ...base, tiers: [
    { name: 'A', min_visits: 1, discount_percent: 10 }, { name: 'B', min_visits: 3, discount_percent: 5 },
  ] });
  assert.equal(lower.status, 400);
  const ok = await shopA('PUT', '/program', { ...base, tiers: program.tiers });
  assert.equal(ok.status, 200);
});

test('changing the password logs out other devices', async () => {
  const phone = client();
  assert.equal((await phone('POST', '/auth/login', { email: 'meena@example.com', password: 'password1' })).status, 200);
  assert.equal((await phone('GET', '/me')).status, 200);
  assert.equal((await shopA('PUT', '/shop/password', { current: 'password1', next: 'password9' })).status, 200);
  assert.equal((await phone('GET', '/me')).status, 401);
  assert.equal((await shopA('GET', '/me')).status, 200);
});

test('unknown emails and wrong passwords get the same answer', async () => {
  const a = await visitor('POST', '/auth/login', { email: 'nobody@example.com', password: 'whatever1' });
  const b = await visitor('POST', '/auth/login', { email: 'meena@example.com', password: 'whatever1' });
  assert.equal(a.status, 401);
  assert.deepEqual(a.data, b.data);
});
