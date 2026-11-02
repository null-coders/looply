// Bills recorded at the counter ("visits").
import { all, insert, one, run, transaction } from '../db.js';
import { decideBill } from '../rewards.js';
import { getTiers } from './shops.js';
import { activeCoupons, customerState, customerStats, getCustomer } from './customers.js';
import { receiptMessage } from './messages.js';
import { fail, parseSqlDateTime, rupeesToPaise, toSqlDateTime } from '../utils.js';

export const UNDO_MINUTES = 10;

async function decide(shop, customer, billPaise, now) {
  const [tiers, stats, coupons] = await Promise.all([
    getTiers(shop.id),
    customerStats(customer, now),
    activeCoupons(customer.id, now),
  ]);
  return decideBill({ program: shop, tiers, stats, coupons, billPaise, now });
}

/** Turns Date objects into 'YYYY-MM-DD HH:MM:SS' text so the browser gets one date format. */
function forJson(decision) {
  const fix = (o) => o && { ...o, expiresAt: o.expiresAt instanceof Date ? toSqlDateTime(o.expiresAt) : o.expiresAt };
  return {
    ...decision,
    level: { name: decision.level.name, percent: decision.level.discount_percent },
    options: decision.options.map(fix),
    chosen: fix(decision.chosen),
  };
}

function readBill(input) {
  const billPaise = rupeesToPaise(input.bill);
  if (!billPaise) fail(400, 'Enter the bill amount in rupees (up to ₹1 crore).');
  return billPaise;
}

/** Shows what will happen before the shopkeeper confirms (live preview). */
export async function previewBill(shop, input, now = new Date()) {
  const customer = await getCustomer(shop.id, input.customerId);
  return forJson(await decide(shop, customer, readBill(input), now));
}

/** Saves a bill. Everything happens in one transaction. */
export async function recordBill(shop, input, { now = new Date(), baseUrl = '' } = {}) {
  const billPaise = readBill(input);
  const customer = await getCustomer(shop.id, input.customerId);

  const { visitId, decision } = await transaction(async () => {
    // Lock this customer's row, so two bills saved at the same moment
    // (double click, two counters) are counted one after the other.
    await one(`SELECT id FROM customers WHERE id = :id FOR UPDATE`, { id: customer.id });
    const decision = await decide(shop, customer, billPaise, now);
    const chosen = decision.chosen;
    if (chosen?.couponId) {
      const used = await run(
        `UPDATE coupons SET status = 'used', used_at = :now WHERE id = :id AND status = 'active'`,
        { id: chosen.couponId, now: toSqlDateTime(now) }
      );
      if (!used.changes) fail(409, 'That coupon was just used on another bill. Please check the bill again.');
    }
    const visitId = await insert(
      `INSERT INTO visits (shop_id, customer_id, counted, visit_number, bill_amount, discount_percent,
                           discount_amount, final_amount, discount_type, discount_label, coupon_id,
                           free_reward, created_at)
       VALUES (:shopId, :customerId, :counted, :visitNumber, :bill, :percent, :discount, :final,
               :type, :label, :couponId, :freeReward, :createdAt)`,
      {
        shopId: shop.id,
        customerId: customer.id,
        counted: decision.counts ? 1 : 0,
        visitNumber: decision.visitNumber,
        bill: billPaise,
        percent: decision.discountPercent,
        discount: decision.discountPaise,
        final: decision.finalPaise,
        type: chosen?.type,
        label: chosen?.label,
        couponId: chosen?.couponId,
        freeReward: decision.freeReward,
        createdAt: toSqlDateTime(now),
      }
    );
    return { visitId, decision };
  });

  const [visit, state] = await Promise.all([
    one(`SELECT * FROM visits WHERE id = :visitId`, { visitId }),
    customerState(shop, customer, { now }),
  ]);
  return {
    visit,
    decision: forJson(decision),
    customer: state,
    whatsappUrl: receiptMessage({ shop, customer, visit, state, baseUrl }),
  };
}

/** Cancels a bill entered by mistake (only shortly after it was saved). */
export async function undoBill(shop, visitId, now = new Date()) {
  await transaction(async () => {
    const visit = await one(`SELECT * FROM visits WHERE id = :visitId AND shop_id = :shopId FOR UPDATE`, {
      visitId,
      shopId: shop.id,
    });
    if (!visit) fail(404, 'Bill not found.');
    if (visit.voided) fail(400, 'This bill was already undone.');
    const ageMinutes = (now - parseSqlDateTime(visit.created_at)) / 60_000;
    if (ageMinutes > UNDO_MINUTES) fail(400, `Bills can only be undone within ${UNDO_MINUTES} minutes.`);
    const later = await one(
      `SELECT 1 FROM visits WHERE customer_id = :customerId AND voided = 0 AND id > :visitId LIMIT 1`,
      { customerId: visit.customer_id, visitId }
    );
    if (later) fail(400, 'A newer bill of this customer was saved after this one. Undo that one first.');

    await run(`UPDATE visits SET voided = 1, voided_at = :now WHERE id = :visitId`, { visitId, now: toSqlDateTime(now) });
    if (visit.coupon_id) {
      await run(`UPDATE coupons SET status = 'active', used_at = NULL WHERE id = :id`, { id: visit.coupon_id });
    }
  });
}

/** Latest bills for the dashboard. */
export async function recentBills(shop, limit = 8, now = new Date()) {
  const rows = await all(
    `SELECT v.id, v.created_at, v.counted, v.visit_number, v.bill_amount, v.discount_amount,
            v.final_amount, v.discount_label, v.free_reward, v.customer_id, c.name AS customer_name
       FROM visits v LEFT JOIN customers c ON c.id = v.customer_id
      WHERE v.shop_id = :shopId AND v.voided = 0
      ORDER BY v.created_at DESC, v.id DESC LIMIT :limit`,
    { shopId: shop.id, limit }
  );
  return rows.map((v) => ({
    ...v,
    canUndo: (now - parseSqlDateTime(v.created_at)) / 60_000 <= UNDO_MINUTES,
  }));
}
