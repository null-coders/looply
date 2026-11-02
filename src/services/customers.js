// Customers (loyalty card holders) and everything we work out about them.
import { all, insert, one, run } from '../db.js';
import { comebackOffer, journey, levelFor, sortTiers, stampStatus } from '../rewards.js';
import { getTiers } from './shops.js';
import {
  addDays, cleanText, daysBetween, fail, normalizePhone, parseBirthday, parseSqlDateTime,
  randomCode, randomToken, startOfDay, toSqlDate, toSqlDateTime,
} from '../utils.js';

export async function getCustomer(shopId, id) {
  const customerId = Number(id);
  if (!Number.isInteger(customerId) || customerId < 1) fail(404, 'Customer not found.');
  const customer = await one(`SELECT * FROM customers WHERE id = :customerId AND shop_id = :shopId`, { customerId, shopId });
  if (!customer) fail(404, 'Customer not found. They may have deleted their card.');
  return customer;
}

/** Numbers about one customer, worked out from their bills. */
export async function customerStats(customer, now = new Date()) {
  const row = await one(
    `SELECT COALESCE(SUM(counted), 0)                         AS counted_visits,
            COUNT(*)                                          AS bills,
            COALESCE(SUM(final_amount), 0)                    AS total_spent,
            COALESCE(SUM(discount_amount), 0)                 AS total_saved,
            MAX(CASE WHEN counted = 1 THEN created_at END)    AS last_counted_at,
            MAX(created_at)                                   AS last_seen_at
       FROM visits
      WHERE customer_id = :id AND voided = 0 AND created_at <= :now`,
    { id: customer.id, now: toSqlDateTime(now) }
  );
  return {
    countedVisits: row.counted_visits,
    bills: row.bills,
    totalSpent: row.total_spent,
    totalSaved: row.total_saved,
    lastCountedAt: row.last_counted_at ? parseSqlDateTime(row.last_counted_at) : null,
    lastSeenAt: row.last_seen_at ? parseSqlDateTime(row.last_seen_at) : null,
    lastSeenText: row.last_seen_at,
    countedToday: !!row.last_counted_at && row.last_counted_at.slice(0, 10) === toSqlDate(now),
    stampsEarned: row.counted_visits + customer.bonus_stamps,
  };
}

export function activeCoupons(customerId, now = new Date()) {
  return all(
    `SELECT id, code, kind, discount_percent, expires_at FROM coupons
      WHERE customer_id = :customerId AND status = 'active' AND expires_at >= :now
      ORDER BY expires_at, id`,
    { customerId, now: toSqlDateTime(now) }
  );
}

/**
 * The full loyalty state of a customer: level, next discount, offers,
 * stamps. Used by the counter screen, the customer page and the card.
 */
export async function customerState(shop, customer, { now = new Date(), tiers } = {}) {
  const [stats, levels, coupons] = await Promise.all([
    customerStats(customer, now),
    tiers ? Promise.resolve(tiers) : getTiers(shop.id),
    activeCoupons(customer.id, now),
  ]);
  const path = journey(levels, stats.countedVisits);
  const comeback = comebackOffer(shop, stats.lastCountedAt, now);
  const stamps = stampStatus(shop, stats.stampsEarned);
  const daysSinceLastVisit = stats.lastSeenAt ? daysBetween(stats.lastSeenAt, now) : null;

  let status = 'active';
  if (stats.bills === 0) status = 'new';
  else if (daysSinceLastVisit > shop.inactive_after_days) status = 'missing';

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    cardCode: customer.card_code,
    cardToken: customer.card_token,
    birthday: customer.birthday,
    consent: !!customer.marketing_consent,
    notes: customer.notes,
    joinedVia: customer.joined_via,
    joinedAt: customer.created_at,
    visits: stats.countedVisits,
    bills: stats.bills,
    totalSpent: stats.totalSpent,
    totalSaved: stats.totalSaved,
    lastSeenAt: stats.lastSeenText,
    daysSinceLastVisit,
    status,
    level: { name: path.current.name, percent: path.current.discount_percent },
    nextVisit: { percent: path.nextVisitPercent, level: path.nextVisitLevel.name },
    upcoming: path.upcoming && {
      name: path.upcoming.name,
      percent: path.upcoming.discount_percent,
      atVisit: path.upcoming.min_visits,
      visitsToGo: path.upcoming.visitsToGo,
    },
    // Only worth showing when it beats the normal next-visit discount.
    comeback:
      comeback && comeback.percent > path.nextVisitPercent
        ? { percent: comeback.percent, expiresAt: toSqlDateTime(comeback.expiresAt) }
        : null,
    stamps,
    coupons: coupons.map((c) => ({
      id: c.id, code: c.code, kind: c.kind, percent: c.discount_percent, expiresAt: c.expires_at,
    })),
    tiers: sortTiers(levels).map((t) => ({ name: t.name, atVisit: t.min_visits, percent: t.discount_percent })),
  };
}

// ---------------------------------------------------------------- find

/**
 * Finds one customer from whatever the shopkeeper typed or scanned:
 * a card link / QR code, a mobile number, or the 6-letter card code.
 */
export async function findExact(shopId, query) {
  const q = String(query ?? '').trim().slice(0, 300);
  const fromLink = q.match(/\/card\/([A-Za-z0-9_-]{16,64})/);
  const token = fromLink ? fromLink[1] : /^[A-Za-z0-9_-]{20,64}$/.test(q) ? q : null;
  if (token) {
    return one(`SELECT * FROM customers WHERE card_token = :token AND shop_id = :shopId`, { token, shopId });
  }
  const phone = normalizePhone(q);
  if (phone) return one(`SELECT * FROM customers WHERE phone = :phone AND shop_id = :shopId`, { phone, shopId });
  const code = q.replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-Z2-9]{6}$/.test(code)) {
    return one(`SELECT * FROM customers WHERE card_code = :code AND shop_id = :shopId`, { code, shopId });
  }
  return null;
}

/** '%text%' for a LIKE search, with % and _ removed so they are not wildcards. */
const likePattern = (q) => {
  const text = cleanText(q, 60).replace(/[%_\\]/g, '');
  return text ? `%${text}%` : null;
};

export async function searchCustomers(shopId, query, limit = 8) {
  const like = likePattern(query);
  if (!like) return [];
  return all(
    `SELECT id, name, phone, card_code FROM customers
      WHERE shop_id = :shopId AND (name ILIKE :like OR phone LIKE :like OR card_code ILIKE :like)
      ORDER BY lower(name) LIMIT :limit`,
    { shopId, like, limit }
  );
}

// ---------------------------------------------------------------- create / update / delete

async function uniqueCardCode(shopId) {
  for (;;) {
    const code = randomCode(6);
    if (!(await one(`SELECT 1 FROM customers WHERE shop_id = :shopId AND card_code = :code`, { shopId, code }))) return code;
  }
}

function readCustomerInput(input) {
  const name = cleanText(input.name, 60);
  const phone = normalizePhone(input.phone);
  const birthday = parseBirthday(input.birthday);
  if (name.length < 2) fail(400, 'Enter the customer name.');
  if (!phone) fail(400, 'Enter a valid 10-digit mobile number.');
  if (birthday === undefined) fail(400, 'Birthday is not a valid date.');
  return { name, phone, birthday };
}

const isYes = (v) => v === true || v === 1 || v === '1';

export async function createCustomer(shop, input, { joinedVia = 'counter', now = new Date() } = {}) {
  const { name, phone, birthday } = readCustomerInput(input);
  const existing = await one(`SELECT id FROM customers WHERE shop_id = :shopId AND phone = :phone`, { shopId: shop.id, phone });
  if (existing) fail(409, 'This mobile number already has a card at this shop.', { customerId: existing.id });
  const consent = isYes(input.consent);
  try {
    const id = await insert(
      `INSERT INTO customers (shop_id, name, phone, birthday, card_token, card_code, bonus_stamps,
                              marketing_consent, consent_at, joined_via, created_at)
       VALUES (:shopId, :name, :phone, :birthday, :token, :code, :bonus, :consent, :consentAt, :joinedVia, :createdAt)`,
      {
        shopId: shop.id, name, phone, birthday, joinedVia,
        token: randomToken(16),
        code: await uniqueCardCode(shop.id),
        bonus: shop.stamp_enabled && shop.welcome_stamp ? 1 : 0,
        consent,
        consentAt: consent ? toSqlDateTime(now) : null,
        createdAt: toSqlDateTime(now),
      }
    );
    return getCustomer(shop.id, id);
  } catch (err) {
    if (err.code === '23505') {
      // The same number was added from two places at the same moment.
      const again = await one(`SELECT id FROM customers WHERE shop_id = :shopId AND phone = :phone`, { shopId: shop.id, phone });
      fail(409, 'This mobile number already has a card at this shop.', { customerId: again?.id });
    }
    throw err;
  }
}

export async function updateCustomer(shop, id, input) {
  const customer = await getCustomer(shop.id, id);
  const { name, phone, birthday } = readCustomerInput(input);
  const clash = await one(
    `SELECT id FROM customers WHERE shop_id = :shopId AND phone = :phone AND id != :id`,
    { shopId: shop.id, phone, id: customer.id }
  );
  if (clash) fail(409, 'Another customer already uses this mobile number.');
  const consent = isYes(input.consent) ? 1 : 0;
  await run(
    `UPDATE customers SET name = :name, phone = :phone, birthday = :birthday, notes = :notes,
            marketing_consent = :consent,
            consent_at = CASE WHEN :consent::int = 1 AND marketing_consent = 0 THEN :now::text
                              WHEN :consent::int = 0 THEN NULL ELSE consent_at END
      WHERE id = :id`,
    {
      id: customer.id, name, phone, birthday, consent, now: toSqlDateTime(),
      notes: input.notes === undefined ? customer.notes : cleanText(input.notes, 300) || null,
    }
  );
  return getCustomer(shop.id, customer.id);
}

/** Removes the customer's personal data. Their past bills stay (without a name) for sales reports. */
export async function deleteCustomer(shopId, id) {
  const customer = await getCustomer(shopId, id);
  await run(`DELETE FROM customers WHERE id = :id AND shop_id = :shopId`, { id: customer.id, shopId });
}

export function setConsent(customerId, consent) {
  return run(
    `UPDATE customers SET marketing_consent = :consent, consent_at = :at WHERE id = :customerId`,
    { customerId, consent: consent ? 1 : 0, at: consent ? toSqlDateTime() : null }
  );
}

// ---------------------------------------------------------------- lists

const SORTS = {
  recent: 's.last_seen DESC NULLS LAST, c.id DESC',
  visits: 'visits DESC, spent DESC, c.id DESC',
  spent: 'spent DESC, c.id DESC',
  name: 'lower(c.name), c.id',
  joined: 'c.created_at DESC, c.id DESC',
};

/** Customer list with search, filters and sorting (Customers screen). */
export async function listCustomers(shop, params = {}, now = new Date()) {
  const tiers = sortTiers(await getTiers(shop.id));
  const filter = ['new', 'missing', 'birthday', 'consent'].includes(params.filter) ? params.filter : 'all';
  const sort = SORTS[params.sort] ? params.sort : 'recent';
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
  const offset = Math.min(Math.max(Number(params.offset) || 0, 0), 100000);

  // Level filter -> range of visit counts
  let minVisits = null;
  let maxVisits = null;
  const levelIndex = tiers.findIndex((t) => String(t.id) === String(params.level));
  if (levelIndex >= 0) {
    if (levelIndex > 0) minVisits = tiers[levelIndex].min_visits;
    if (levelIndex < tiers.length - 1) maxVisits = tiers[levelIndex + 1].min_visits - 1;
  }

  const where = `
    WHERE c.shop_id = :shopId
      AND (:like::text IS NULL OR c.name ILIKE :like OR c.phone LIKE :like OR c.card_code ILIKE :like)
      AND (:filter::text != 'new'      OR c.created_at >= :newSince)
      AND (:filter::text != 'missing'  OR (s.last_seen IS NOT NULL AND s.last_seen < :missingBefore))
      AND (:filter::text != 'birthday' OR substr(c.birthday, 1, 2) = :month)
      AND (:filter::text != 'consent'  OR c.marketing_consent = 1)
      AND (:minVisits::int IS NULL OR COALESCE(s.visits, 0) >= :minVisits)
      AND (:maxVisits::int IS NULL OR COALESCE(s.visits, 0) <= :maxVisits)`;
  const withStats = `
    WITH s AS (
      SELECT customer_id, SUM(counted) AS visits, SUM(final_amount) AS spent, MAX(created_at) AS last_seen
        FROM visits WHERE shop_id = :shopId AND voided = 0 GROUP BY customer_id
    )`;
  const values = {
    shopId: shop.id,
    like: likePattern(params.q),
    filter,
    newSince: toSqlDateTime(startOfDay(addDays(now, -30))),
    missingBefore: toSqlDateTime(startOfDay(addDays(now, -shop.inactive_after_days))),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    minVisits,
    maxVisits,
  };

  const [rows, count] = await Promise.all([
    all(
      `${withStats}
       SELECT c.id, c.name, c.phone, c.card_code, c.birthday, c.marketing_consent, c.created_at,
              COALESCE(s.visits, 0) AS visits, COALESCE(s.spent, 0) AS spent, s.last_seen
         FROM customers c LEFT JOIN s ON s.customer_id = c.id
         ${where}
        ORDER BY ${SORTS[sort]}
        LIMIT :limit OFFSET :offset`,
      { ...values, limit, offset }
    ),
    one(`${withStats} SELECT COUNT(*) AS total FROM customers c LEFT JOIN s ON s.customer_id = c.id ${where}`, values),
  ]);

  return {
    total: count.total,
    customers: rows.map((r) => {
      const level = levelFor(tiers, Math.max(r.visits, 1));
      const daysSince = r.last_seen ? daysBetween(parseSqlDateTime(r.last_seen), now) : null;
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        cardCode: r.card_code,
        birthday: r.birthday,
        consent: !!r.marketing_consent,
        joinedAt: r.created_at,
        visits: r.visits,
        spent: r.spent,
        lastSeenAt: r.last_seen,
        daysSinceLastVisit: daysSince,
        status: !r.last_seen ? 'new' : daysSince > shop.inactive_after_days ? 'missing' : 'active',
        level: { name: level.name, percent: level.discount_percent },
      };
    }),
  };
}

/** Bills of one customer, newest first (Customer page + card). */
export function customerVisits(customerId, limit = 50) {
  return all(
    `SELECT id, created_at, counted, visit_number, bill_amount, discount_percent, discount_amount,
            final_amount, discount_type, discount_label, free_reward
       FROM visits WHERE customer_id = :customerId AND voided = 0
      ORDER BY created_at DESC, id DESC LIMIT :limit`,
    { customerId, limit }
  );
}
