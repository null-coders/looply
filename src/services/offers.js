// Coupons and the two lists that bring customers back:
//  * customers who stopped coming  -> win-back coupon
//  * birthdays coming up           -> birthday coupon
import { all, insert, one, run, transaction } from '../db.js';
import { COUPON_KIND_LABEL } from '../rewards.js';
import { getCustomer } from './customers.js';
import { couponMessage } from './messages.js';
import {
  addDays, daysBetween, endOfDay, fail, intInRange, parseSqlDateTime, randomCode,
  startOfDay, toSqlDateTime,
} from '../utils.js';

const PREFIX = { winback: 'MISS', birthday: 'BDAY', gift: 'GIFT' };

async function uniqueCouponCode(shopId, kind) {
  for (;;) {
    const code = `${PREFIX[kind]}-${randomCode(4)}`;
    if (!(await one(`SELECT 1 FROM coupons WHERE shop_id = :shopId AND code = :code`, { shopId, code }))) return code;
  }
}

/**
 * Creates a one-time coupon for a customer and returns a ready WhatsApp
 * message. If the customer already has a running coupon of the same kind,
 * that one is sent again instead of making a second one.
 */
export async function createCoupon(shop, customerId, input = {}, { now = new Date(), baseUrl = '' } = {}) {
  const customer = await getCustomer(shop.id, customerId);
  const kind = input.kind;
  if (!Object.hasOwn(PREFIX, kind)) fail(400, 'Unknown coupon type.');

  if (kind !== 'gift' && !customer.marketing_consent) {
    fail(400, `${customer.name} has not agreed to get offers on WhatsApp. Ask them at the counter first.`);
  }

  const percent =
    kind === 'winback' ? shop.winback_percent
    : kind === 'birthday' ? shop.birthday_percent
    : intInRange(input.percent, 1, 90, 'Gift discount');
  const days =
    kind === 'winback' ? shop.winback_days
    : kind === 'birthday' ? 7
    : intInRange(input.days ?? 14, 1, 90, 'Gift validity');

  return transaction(async () => {
    // Lock the customer so two clicks cannot create two coupons.
    await one(`SELECT id FROM customers WHERE id = :id FOR UPDATE`, { id: customer.id });
    const existing = await one(
      `SELECT * FROM coupons WHERE customer_id = :customerId AND kind = :kind
          AND status = 'active' AND expires_at >= :now ORDER BY id DESC LIMIT 1`,
      { customerId: customer.id, kind, now: toSqlDateTime(now) }
    );
    if (existing && kind !== 'gift') {
      return { coupon: existing, reused: true, whatsappUrl: couponMessage({ shop, customer, coupon: existing, baseUrl }) };
    }
    const id = await insert(
      `INSERT INTO coupons (shop_id, customer_id, code, kind, discount_percent, expires_at, created_at)
       VALUES (:shopId, :customerId, :code, :kind, :percent, :expiresAt, :createdAt)`,
      {
        shopId: shop.id,
        customerId: customer.id,
        code: await uniqueCouponCode(shop.id, kind),
        kind,
        percent,
        expiresAt: toSqlDateTime(endOfDay(addDays(now, days))),
        createdAt: toSqlDateTime(now),
      }
    );
    const coupon = await one(`SELECT * FROM coupons WHERE id = :id`, { id });
    return { coupon, reused: false, whatsappUrl: couponMessage({ shop, customer, coupon, baseUrl }) };
  });
}

export async function cancelCoupon(shop, couponId) {
  const coupon = await one(`SELECT * FROM coupons WHERE id = :couponId AND shop_id = :shopId`, {
    couponId: Number(couponId),
    shopId: shop.id,
  });
  if (!coupon) fail(404, 'Coupon not found.');
  if (coupon.status !== 'active') fail(400, 'Only unused coupons can be cancelled.');
  await run(`UPDATE coupons SET status = 'cancelled' WHERE id = :id AND status = 'active'`, { id: coupon.id });
}

/** 'used' | 'cancelled' | 'expired' | 'active' */
export function couponStatus(coupon, now = new Date()) {
  if (coupon.status !== 'active') return coupon.status;
  return parseSqlDateTime(coupon.expires_at) < now ? 'expired' : 'active';
}

function couponForJson(k, now) {
  return {
    id: k.id,
    code: k.code,
    kind: k.kind,
    kindLabel: COUPON_KIND_LABEL[k.kind],
    percent: k.discount_percent,
    createdAt: k.created_at,
    expiresAt: k.expires_at,
    usedAt: k.used_at,
    status: couponStatus(k, now),
  };
}

/** All coupons made in the last `days` days, newest first (Bring back > Offers sent). */
export async function listCoupons(shop, { days = 90 } = {}, now = new Date()) {
  const rows = await all(
    `SELECT k.*, c.name AS customer_name, v.final_amount AS used_bill
       FROM coupons k
       JOIN customers c ON c.id = k.customer_id
       LEFT JOIN visits v ON v.coupon_id = k.id AND v.voided = 0
      WHERE k.shop_id = :shopId AND k.created_at >= :since
      ORDER BY k.created_at DESC, k.id DESC
      LIMIT 500`,
    { shopId: shop.id, since: toSqlDateTime(startOfDay(addDays(now, -days))) }
  );
  return rows.map((k) => ({
    ...couponForJson(k, now),
    usedBill: k.used_bill,
    customerId: k.customer_id,
    customerName: k.customer_name,
  }));
}

/** Every coupon of one customer (Customer page). */
export async function customerCoupons(customerId, now = new Date()) {
  const rows = await all(
    `SELECT * FROM coupons WHERE customer_id = :customerId ORDER BY created_at DESC, id DESC LIMIT 100`,
    { customerId }
  );
  return rows.map((k) => couponForJson(k, now));
}

/**
 * Customers who visited before but have not come for `inactive_after_days`.
 * Most valuable customers (highest spend) are listed first.
 */
export async function missingCustomers(shop, now = new Date()) {
  const cutoff = toSqlDateTime(startOfDay(addDays(now, -shop.inactive_after_days)));
  const rows = await all(
    `WITH s AS (
       SELECT customer_id, SUM(counted) AS visits, SUM(final_amount) AS spent, MAX(created_at) AS last_seen
         FROM visits WHERE shop_id = :shopId AND voided = 0 AND created_at <= :now GROUP BY customer_id
     ),
     w AS (
       SELECT DISTINCT ON (customer_id) customer_id, code, status, expires_at, created_at
         FROM coupons WHERE shop_id = :shopId AND kind = 'winback'
        ORDER BY customer_id, id DESC
     )
     SELECT c.id, c.name, c.phone, c.marketing_consent, s.visits, s.spent, s.last_seen,
            w.code AS w_code, w.status AS w_status, w.expires_at AS w_expires, w.created_at AS w_created
       FROM customers c
       JOIN s ON s.customer_id = c.id
       LEFT JOIN w ON w.customer_id = c.id
      WHERE c.shop_id = :shopId AND s.last_seen < :cutoff
      ORDER BY s.spent DESC, c.id
      LIMIT 500`,
    { shopId: shop.id, cutoff, now: toSqlDateTime(now) }
  );
  return rows.map((r) => {
    let offer = null;
    // Only offers sent after their last visit count (older ones are history).
    if (r.w_code && r.w_created > r.last_seen) {
      offer = {
        code: r.w_code,
        status: couponStatus({ status: r.w_status, expires_at: r.w_expires }, now),
        expiresAt: r.w_expires,
        sentAt: r.w_created,
      };
    }
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      consent: !!r.marketing_consent,
      visits: r.visits,
      spent: r.spent,
      lastSeenAt: r.last_seen,
      daysSinceLastVisit: daysBetween(parseSqlDateTime(r.last_seen), now),
      offer,
    };
  });
}

/** Customers whose birthday is today or in the next `withinDays` days. */
export async function upcomingBirthdays(shop, now = new Date(), withinDays = 7) {
  const today = startOfDay(now);
  const rows = await all(
    `SELECT c.id, c.name, c.phone, c.birthday, c.marketing_consent,
            EXISTS (SELECT 1 FROM coupons k WHERE k.customer_id = c.id AND k.kind = 'birthday'
                      AND k.created_at >= :recent) AS coupon_sent
       FROM customers c WHERE c.shop_id = :shopId AND c.birthday IS NOT NULL`,
    { shopId: shop.id, recent: toSqlDateTime(addDays(today, -30)) }
  );
  return rows
    .map((r) => {
      const [mm, dd] = r.birthday.split('-').map(Number);
      let next = new Date(today.getFullYear(), mm - 1, dd);
      // 29 Feb in a normal year rolls to 1 Mar, which is fine for a greeting.
      if (next < today) next = new Date(today.getFullYear() + 1, mm - 1, dd);
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        birthday: r.birthday,
        consent: !!r.marketing_consent,
        inDays: daysBetween(today, next),
        couponSent: !!r.coupon_sent,
      };
    })
    .filter((r) => r.inDays <= withinDays)
    .sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name));
}
