// Numbers for the dashboard, the reports screen and CSV exports.
import { all, one } from '../db.js';
import { levelFor, sortTiers } from '../rewards.js';
import { getTiers } from './shops.js';
import { missingCustomers, upcomingBirthdays } from './offers.js';
import { recentBills } from './visits.js';
import { addDays, startOfDay, toSqlDate, toSqlDateTime } from '../utils.js';

async function totals(shopId, from, to) {
  const range = { shopId, from: toSqlDateTime(from), to: toSqlDateTime(to) };
  const [row, members] = await Promise.all([
    one(
      `SELECT COUNT(*)                                                             AS bills,
              COALESCE(SUM(counted), 0)                                            AS visits,
              COALESCE(SUM(bill_amount), 0)                                        AS gross,
              COALESCE(SUM(final_amount), 0)                                       AS sales,
              COALESCE(SUM(discount_amount), 0)                                    AS discount,
              COUNT(DISTINCT customer_id)                                          AS customers,
              COALESCE(SUM(CASE WHEN visit_number >= 2 THEN 1 END), 0)             AS repeat_visits,
              COALESCE(SUM(CASE WHEN visit_number >= 2 THEN final_amount END), 0)  AS repeat_sales,
              COALESCE(SUM(CASE WHEN free_reward IS NOT NULL THEN 1 END), 0)       AS free_rewards
         FROM visits
        WHERE shop_id = :shopId AND voided = 0 AND created_at >= :from AND created_at < :to`,
      range
    ),
    one(
      `SELECT COUNT(*) AS members FROM customers WHERE shop_id = :shopId AND created_at >= :from AND created_at < :to`,
      range
    ),
  ]);
  return {
    bills: row.bills,
    visits: row.visits,
    gross: row.gross,
    sales: row.sales,
    discount: row.discount,
    customers: row.customers,
    repeatVisits: row.repeat_visits,
    repeatSales: row.repeat_sales,
    freeRewards: row.free_rewards,
    newMembers: members.members,
    avgBill: row.bills ? Math.round(row.sales / row.bills / 100) * 100 : 0, // whole rupees
  };
}

async function dailySeries(shopId, from, to) {
  const rows = await all(
    `SELECT substr(created_at, 1, 10)                          AS day,
            SUM(final_amount)                                  AS sales,
            SUM(discount_amount)                               AS discount,
            SUM(counted)                                       AS visits,
            SUM(CASE WHEN visit_number >= 2 THEN 1 ELSE 0 END) AS repeat_visits
       FROM visits
      WHERE shop_id = :shopId AND voided = 0 AND created_at >= :from AND created_at < :to
      GROUP BY day`,
    { shopId, from: toSqlDateTime(from), to: toSqlDateTime(to) }
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = [];
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    const key = toSqlDate(d);
    const r = byDay.get(key);
    series.push({
      day: key,
      sales: r?.sales ?? 0,
      discount: r?.discount ?? 0,
      visits: r?.visits ?? 0,
      repeatVisits: r?.repeat_visits ?? 0,
    });
  }
  return series;
}

export async function dashboard(shop, now = new Date()) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [todayTotals, yesterday, month, last14, membersRow, missing, birthdays, recent] = await Promise.all([
    totals(shop.id, today, tomorrow),
    totals(shop.id, addDays(today, -1), today),
    totals(shop.id, monthStart, tomorrow),
    dailySeries(shop.id, addDays(today, -13), tomorrow),
    one(`SELECT COUNT(*) AS members FROM customers WHERE shop_id = :shopId`, { shopId: shop.id }),
    missingCustomers(shop, now),
    upcomingBirthdays(shop, now, 7),
    recentBills(shop, 8, now),
  ]);
  return {
    today: todayTotals,
    yesterday,
    month,
    last14,
    members: membersRow.members,
    missing: {
      count: missing.length,
      withConsent: missing.filter((m) => m.consent && !(m.offer && m.offer.status === 'active')).length,
      top: missing.slice(0, 3),
    },
    birthdays,
    recent,
  };
}

export async function report(shop, days, now = new Date()) {
  const end = addDays(startOfDay(now), 1);
  const start = addDays(end, -days);
  const prevStart = addDays(start, -days);
  const range = { shopId: shop.id, from: toSqlDateTime(start), to: toSqlDateTime(end) };

  const [current, previous, daily, tierRows, counts, byType, coupons, weekdays, topCustomers] = await Promise.all([
    totals(shop.id, start, end),
    totals(shop.id, prevStart, start),
    dailySeries(shop.id, start, end),
    getTiers(shop.id),
    // visits of every member, to count members per level
    all(
      `SELECT COALESCE(SUM(v.counted), 0) AS visits
         FROM customers c LEFT JOIN visits v ON v.customer_id = c.id AND v.voided = 0
        WHERE c.shop_id = :shopId GROUP BY c.id`,
      { shopId: shop.id }
    ),
    // which offers were used, and how much they cost
    all(
      `SELECT discount_type AS type, COUNT(*) AS uses, SUM(discount_amount) AS discount, SUM(final_amount) AS sales
         FROM visits
        WHERE shop_id = :shopId AND voided = 0 AND created_at >= :from AND created_at < :to
          AND discount_type IS NOT NULL
        GROUP BY discount_type`,
      range
    ),
    // coupons sent in this period and how many came back to use them
    all(
      `SELECT kind, COUNT(*) AS sent, SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used
         FROM coupons
        WHERE shop_id = :shopId AND status != 'cancelled' AND created_at >= :from AND created_at < :to
        GROUP BY kind`,
      range
    ),
    all(
      `SELECT EXTRACT(DOW FROM created_at::timestamp)::int AS weekday, COUNT(*) AS bills, SUM(final_amount) AS sales
         FROM visits
        WHERE shop_id = :shopId AND voided = 0 AND created_at >= :from AND created_at < :to
        GROUP BY 1`,
      range
    ),
    all(
      `SELECT c.id, c.name, COUNT(*) AS bills, SUM(v.final_amount) AS spent, SUM(v.discount_amount) AS saved
         FROM visits v JOIN customers c ON c.id = v.customer_id
        WHERE v.shop_id = :shopId AND v.voided = 0 AND v.created_at >= :from AND v.created_at < :to
        GROUP BY c.id, c.name ORDER BY spent DESC, c.id LIMIT 8`,
      range
    ),
  ]);

  const tiers = sortTiers(tierRows);
  const levels = tiers.map((t) => ({ name: t.name, percent: t.discount_percent, atVisit: t.min_visits, members: 0 }));
  for (const { visits } of counts) {
    levels[tiers.indexOf(levelFor(tiers, Math.max(visits, 1)))].members += 1;
  }

  return {
    days,
    from: toSqlDate(start),
    to: toSqlDate(addDays(end, -1)),
    current,
    previous,
    daily,
    levels,
    byType,
    coupons,
    weekdays: [0, 1, 2, 3, 4, 5, 6].map((w) => {
      const r = weekdays.find((x) => x.weekday === w);
      return { weekday: w, bills: r?.bills ?? 0, sales: r?.sales ?? 0 };
    }),
    topCustomers,
  };
}

// ------------------------------------------------------------------ CSV export

/** One CSV cell. Cells starting with = + - @ get a ' in front so Excel never runs them as formulas. */
function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const money = (paise) => (paise / 100).toFixed(2);

export async function customersCsv(shop) {
  const [tiers, rows] = await Promise.all([
    getTiers(shop.id),
    all(
      `SELECT c.*, COALESCE(SUM(v.counted), 0) AS visits, COALESCE(SUM(v.final_amount), 0) AS spent,
              COALESCE(SUM(v.discount_amount), 0) AS saved, MAX(v.created_at) AS last_seen
         FROM customers c LEFT JOIN visits v ON v.customer_id = c.id AND v.voided = 0
        WHERE c.shop_id = :shopId GROUP BY c.id ORDER BY lower(c.name), c.id`,
      { shopId: shop.id }
    ),
  ]);
  return toCsv(
    ['Name', 'Mobile', 'Card code', 'Level', 'Visits', 'Total paid (Rs)', 'Total saved (Rs)', 'Last visit',
      'Joined', 'Birthday (MM-DD)', 'WhatsApp offers', 'Notes'],
    rows.map((r) => [
      r.name, r.phone, r.card_code, levelFor(tiers, Math.max(r.visits, 1)).name, r.visits,
      money(r.spent), money(r.saved), r.last_seen, r.created_at, r.birthday,
      r.marketing_consent ? 'Yes' : 'No', r.notes,
    ])
  );
}

export async function visitsCsv(shop) {
  const rows = await all(
    `SELECT v.*, c.name, c.phone FROM visits v LEFT JOIN customers c ON c.id = v.customer_id
      WHERE v.shop_id = :shopId AND v.voided = 0 ORDER BY v.created_at DESC, v.id DESC`,
    { shopId: shop.id }
  );
  return toCsv(
    ['Date and time', 'Customer', 'Mobile', 'Visit number', 'Bill (Rs)', 'Discount %', 'Discount (Rs)',
      'Paid (Rs)', 'Offer used', 'Free reward'],
    rows.map((r) => [
      r.created_at, r.name ?? '(deleted customer)', r.phone, r.counted ? r.visit_number : 'not counted',
      money(r.bill_amount), r.discount_percent, money(r.discount_amount), money(r.final_amount),
      r.discount_label, r.free_reward,
    ])
  );
}
