// Creates a demo shop with ~4 months of realistic customers and bills.
//   npm run seed
// Log in with demo@looply.in / demo1234
//
// It replays every day from 120 days ago until today and records bills
// through the same code the counter uses, so all discounts, levels,
// stamps and coupons in the demo follow the real rules.
//
// With DATABASE_URL set (Supabase), the demo is first built in a fast
// in-memory database and then copied to Supabase in a few big inserts.
// Only the demo shop is replaced; other shops are never touched.
import '../src/timezone.js';

const remoteUrl = process.env.DATABASE_URL;
if (remoteUrl) {
  delete process.env.DATABASE_URL;
  process.env.DB_PATH = 'memory';
}

const { all, one, run, closeDatabase } = await import('../src/db.js');
const { SCHEMA } = await import('../src/schema.js');
const { createShop, getShop } = await import('../src/services/shops.js');
const { createCustomer } = await import('../src/services/customers.js');
const { recordBill } = await import('../src/services/visits.js');
const { createCoupon, missingCustomers } = await import('../src/services/offers.js');
const { addDays, startOfDay } = await import('../src/utils.js');

const { DEMO_EMAIL: EMAIL } = await import('../src/constants.js');
const DAYS = 120;

// Small seeded random generator, so every run creates the same demo.
let seed = 20261023;
function random() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;

const NAMES = [
  'Anita Rao', 'Rahul Verma', 'Priya Nair', 'Arjun Mehta', 'Sneha Kulkarni', 'Vikram Singh', 'Pooja Iyer',
  'Imran Khan', 'Kavya Reddy', 'Rohan Das', 'Meera Joshi', 'Aditya Gupta', 'Fatima Sheikh', 'Siddharth Bose',
  'Neha Agarwal', 'Karan Malhotra', 'Divya Menon', 'Harpreet Kaur', 'Amit Patel', 'Ritu Chauhan', 'Sanjay Yadav',
  'Ayesha Siddiqui', 'Nikhil Jain', 'Shreya Ghosh', 'Manoj Tiwari', 'Lakshmi Pillai', 'Varun Kapoor',
  'Tanvi Deshpande', 'Gaurav Mishra', 'Nandini Rao', 'Abdul Rehman', 'Swati Pandey', 'Kunal Shah', 'Anjali Sharma',
  'Deepak Chaudhary', 'Zoya Mirza', 'Prakash Hegde', 'Ishita Banerjee', 'Ramesh Babu', 'Simran Gill', 'Yash Thakur',
  'Bhavna Soni', 'Farhan Ali', 'Kritika Saxena', 'Mohit Arora', 'Sunita Devi', 'Tarun Bhatt', 'Ananya Sen',
  'Joseph Mathew', 'Pallavi Kale', 'Rakesh Kumar', 'Nisha Thomas', 'Sameer Qureshi', 'Geeta Rawat', 'Vivek Anand',
  'Rashmi Shetty', 'Aman Dhillon', 'Sonal Vyas', 'Harish Naidu', 'Madhuri Patil', 'Chetan Rathore', 'Usha Krishnan',
  'Faisal Ansari', 'Jyoti Bisht', 'Naveen Gowda', 'Preeti Sinha', 'Ajay Rawal', 'Shalini Dubey', 'Rajat Sood',
  'Lata Mangal', 'Om Prakash', 'Tanya Bhalla',
];

// How often each kind of customer comes (days between visits)
const PROFILES = {
  regular: { count: 14, gap: [1, 4], stopAfter: null },
  weekly: { count: 16, gap: [5, 10], stopAfter: null },
  occasional: { count: 14, gap: [12, 26], stopAfter: null },
  lapsed: { count: 14, gap: [3, 12], stopAfter: [2, 6] }, // stop coming after a few visits
  oneTime: { count: 8, gap: null, stopAfter: [1, 1] },
  newcomer: { count: 6, gap: [3, 8], stopAfter: null, recent: true },
};

function billAmount() {
  // Mostly chai and snacks, sometimes a big group order.
  const r = random();
  if (r < 0.03) return between(2, 4) * 10; // just a toffee or water bottle: below the minimum bill
  if (r < 0.55) return between(6, 18) * 10;
  if (r < 0.9) return between(18, 32) * 10;
  return between(32, 65) * 10;
}

function atTime(day, minHour = 8, maxHour = 21) {
  const d = new Date(day);
  d.setHours(between(minHour, maxHour), between(0, 59), between(0, 59), 0);
  return d;
}

const usedPhones = new Set();
function phone() {
  for (;;) {
    const p = `${pick(['9', '8', '7', '6'])}${String(between(0, 999999999)).padStart(9, '0')}`;
    if (!usedPhones.has(p)) {
      usedPhones.add(p);
      return p;
    }
  }
}

// ---------------------------------------------------------------- build the demo
async function buildDemo() {
  const existing = await one(`SELECT id FROM shops WHERE email = :email`, { email: EMAIL });
  if (existing) await run(`DELETE FROM shops WHERE id = :id`, { id: existing.id });

  const now = new Date();
  const today = startOfDay(now);
  const firstDay = addDays(today, -DAYS);

  let shop = await createShop({
    shopName: 'Kesar Chai Corner',
    ownerName: 'Ravi Sharma',
    email: EMAIL,
    password: 'demo1234',
    phone: '9811122233',
    category: 'cafe',
    address: 'Shop 12, Main Market, Sector 15',
    now: addDays(firstDay, -2),
  });
  await run(`UPDATE shops SET max_discount_per_visit = 100 WHERE id = :id`, { id: shop.id });
  shop = await getShop(shop.id);

  // Plan the customers
  const people = [];
  let nameIndex = 0;
  for (const [kind, profile] of Object.entries(PROFILES)) {
    for (let i = 0; i < profile.count; i++) {
      const joinOffset = profile.recent ? between(DAYS - 14, DAYS - 1) : kind === 'lapsed' ? between(0, 50) : between(0, DAYS - 20);
      people.push({
        profile,
        name: NAMES[nameIndex++ % NAMES.length],
        phone: phone(),
        consent: chance(0.78),
        birthday: chance(0.65) ? `${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}` : '',
        next: addDays(firstDay, joinOffset),
        visitsLeft: profile.stopAfter ? between(...profile.stopAfter) : Infinity,
        customer: null,
      });
    }
  }
  // A few birthdays this week, so the dashboard has something to show.
  for (const [i, inDays] of [[0, 0], [3, 2], [8, 5]]) {
    const d = addDays(today, inDays);
    people[i].birthday = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    people[i].consent = true;
  }

  // Replay every day
  let bills = 0;
  for (let day = new Date(firstDay); day <= today; day = addDays(day, 1)) {
    const isToday = day.getTime() === today.getTime();

    // Twice a month the owner sends win-back offers to customers who stopped coming.
    const dayIndex = Math.round((day - firstDay) / 86_400_000);
    if (dayIndex > 40 && dayIndex % 15 === 0 && !isToday) {
      const sendTime = atTime(day, 10, 12);
      for (const m of await missingCustomers(shop, sendTime)) {
        if (!m.consent || m.offer || !chance(0.7)) continue;
        await createCoupon(shop, m.id, { kind: 'winback' }, { now: sendTime });
        const person = people.find((p) => p.customer?.id === m.id);
        if (person && chance(0.45)) {
          // This one comes back while the coupon is still valid.
          person.next = addDays(day, between(1, 6));
          person.visitsLeft = between(1, 4);
        }
      }
    }

    for (const person of people) {
      if (!person.next || person.next > day || person.visitsLeft <= 0) continue;
      let when = atTime(day);
      if (isToday) {
        // Only times between opening (7 am) and a little before now.
        const open = new Date(today);
        open.setHours(7, 0, 0, 0);
        const latest = new Date(now.getTime() - 20 * 60_000);
        if (latest <= open) continue;
        when = new Date(open.getTime() + random() * (latest - open));
      }
      if (!person.customer) {
        person.customer = await createCustomer(
          shop,
          { name: person.name, phone: person.phone, birthday: person.birthday, consent: person.consent },
          { now: new Date(when.getTime() - 60_000), joinedVia: chance(0.25) ? 'qr' : 'counter' }
        );
      }
      await recordBill(shop, { customerId: person.customer.id, bill: billAmount() }, { now: when });
      bills += 1;
      person.visitsLeft -= 1;
      const gap = person.profile.gap || [999, 999];
      person.next = addDays(day, between(...gap));
    }
  }

  // One birthday offer already sent this week
  if (people[3].customer) await createCoupon(shop, people[3].customer.id, { kind: 'birthday' }, { now: addDays(now, -1) });
  return { shopId: shop.id, bills };
}

// ---------------------------------------------------------------- copy to Supabase
async function copyToRemote(url, shopId) {
  const { default: pg } = await import('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  await client.connect();

  /** INSERT many rows at once (in batches) and return the new ids in the same order. */
  async function insertRows(table, rows, keyColumn) {
    if (!rows.length) return new Map();
    const columns = Object.keys(rows[0]).filter((c) => c !== 'id');
    const perBatch = Math.floor(30000 / columns.length);
    const ids = new Map();
    for (let start = 0; start < rows.length; start += perBatch) {
      const batch = rows.slice(start, start + perBatch);
      const values = [];
      const tuples = batch.map((row) => {
        const marks = columns.map((c) => {
          values.push(row[c]);
          return `$${values.length}`;
        });
        return `(${marks.join(', ')})`;
      });
      const result = await client.query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} RETURNING id${keyColumn ? `, ${keyColumn}` : ''}`,
        values
      );
      if (keyColumn) for (const r of result.rows) ids.set(r[keyColumn], r.id);
    }
    return ids;
  }

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7731)');
    const { rows } = await client.query(`SELECT to_regclass('public.sessions') IS NOT NULL AS ready`);
    if (!rows[0].ready) await client.query(SCHEMA);
    await client.query('DELETE FROM shops WHERE email = $1', [EMAIL]); // old demo (everything below it goes too)

    const shop = await one(`SELECT * FROM shops WHERE id = :shopId`, { shopId });
    // The join link (slug) must stay unique online, even if a real shop has the same name.
    const taken = await client.query('SELECT 1 FROM shops WHERE slug = $1', [shop.slug]);
    if (taken.rows.length) shop.slug = `${shop.slug}-demo`;
    const shopIds = await insertRows('shops', [shop], 'slug');
    const newShopId = shopIds.get(shop.slug);

    const tiers = await all(`SELECT * FROM tiers WHERE shop_id = :shopId`, { shopId });
    await insertRows('tiers', tiers.map((t) => ({ ...t, shop_id: newShopId })));

    const customers = await all(`SELECT * FROM customers WHERE shop_id = :shopId ORDER BY id`, { shopId });
    const tokenToNew = await insertRows('customers', customers.map((c) => ({ ...c, shop_id: newShopId })), 'card_token');
    const customerMap = new Map(customers.map((c) => [c.id, tokenToNew.get(c.card_token)]));

    const coupons = await all(`SELECT * FROM coupons WHERE shop_id = :shopId ORDER BY id`, { shopId });
    const codeToNew = await insertRows(
      'coupons',
      coupons.map((k) => ({ ...k, shop_id: newShopId, customer_id: customerMap.get(k.customer_id) })),
      'code'
    );
    const couponMap = new Map(coupons.map((k) => [k.id, codeToNew.get(k.code)]));

    const visits = await all(`SELECT * FROM visits WHERE shop_id = :shopId ORDER BY id`, { shopId });
    await insertRows(
      'visits',
      visits.map((v) => ({
        ...v,
        shop_id: newShopId,
        customer_id: v.customer_id ? customerMap.get(v.customer_id) : null,
        coupon_id: v.coupon_id ? couponMap.get(v.coupon_id) : null,
      }))
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------- run
try {
  console.log(remoteUrl ? '\n  Building the demo shop, then copying it to Supabase...' : '\n  Building the demo shop...');
  const { shopId, bills } = await buildDemo();
  const counts = await one(
    `SELECT (SELECT COUNT(*) FROM customers WHERE shop_id = :id) AS customers,
            (SELECT COUNT(*) FROM coupons WHERE shop_id = :id) AS coupons`,
    { id: shopId }
  );
  if (remoteUrl) await copyToRemote(remoteUrl, shopId);
  console.log(`  Demo shop ready${remoteUrl ? ' on Supabase' : ''}: ${counts.customers} customers, ${bills} bills, ${counts.coupons} coupons.`);
  console.log(`  Log in with ${EMAIL} / demo1234\n`);
} catch (err) {
  console.error(`\n  Could not create the demo: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
