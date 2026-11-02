// =====================================================================
//  Reward engine — the "brain" of Looply.
//
//  Everything in this file is a PURE function: it only looks at the
//  values passed in and never touches the database. That makes the rules
//  easy to explain and easy to test (see test/rewards.test.js).
//
//  Four ways a customer can save money:
//   1. Level discount   – grows with the number of visits (Starbucks style)
//   2. Comeback offer   – "come back within 30 days and get 10% off" (mall style)
//   3. Coupons          – one-time win-back / birthday / gift offers
//   4. Stamp card       – every Nth visit gets a free item (not a % discount)
//
//  Only ONE percentage discount is applied per bill: the best one. Offers
//  that are not used stay saved for a later visit. The stamp card reward is
//  given on top, because it is a free item and not a discount.
// =====================================================================
import { addDays, endOfDay } from './utils.js';

/** Default reward programs, so a new shop is ready in one click. */
export const TEMPLATES = {
  cafe: {
    label: 'Cafe / tea stall',
    tiers: [
      { name: 'Member', min_visits: 1, discount_percent: 0 },
      { name: 'Regular', min_visits: 2, discount_percent: 5 },
      { name: 'Gold', min_visits: 5, discount_percent: 10 },
      { name: 'Family', min_visits: 12, discount_percent: 15 },
    ],
    settings: {
      min_bill_for_visit: 50,
      stamp_enabled: 1, stamp_every: 7, stamp_reward: 'Free chai',
      comeback_enabled: 1, comeback_percent: 10, comeback_days: 15,
      winback_percent: 20, birthday_percent: 20, inactive_after_days: 21,
    },
  },
  salon: {
    label: 'Salon / beauty parlour',
    tiers: [
      { name: 'Member', min_visits: 1, discount_percent: 0 },
      { name: 'Silver', min_visits: 2, discount_percent: 5 },
      { name: 'Gold', min_visits: 3, discount_percent: 10 },
      { name: 'Platinum', min_visits: 6, discount_percent: 15 },
    ],
    settings: {
      min_bill_for_visit: 200,
      stamp_enabled: 1, stamp_every: 6, stamp_reward: 'Free head massage',
      comeback_enabled: 1, comeback_percent: 10, comeback_days: 45,
      winback_percent: 20, birthday_percent: 25, inactive_after_days: 60,
    },
  },
  kirana: {
    label: 'Kirana / general store',
    tiers: [
      { name: 'Member', min_visits: 1, discount_percent: 0 },
      { name: 'Regular', min_visits: 3, discount_percent: 2 },
      { name: 'Trusted', min_visits: 10, discount_percent: 3 },
      { name: 'Family', min_visits: 25, discount_percent: 5 },
    ],
    settings: {
      min_bill_for_visit: 200,
      stamp_enabled: 0, stamp_every: 10, stamp_reward: '1 kg sugar free',
      comeback_enabled: 1, comeback_percent: 3, comeback_days: 10,
      winback_percent: 5, birthday_percent: 5, inactive_after_days: 21,
    },
  },
  fashion: {
    label: 'Clothes / footwear',
    tiers: [
      { name: 'Member', min_visits: 1, discount_percent: 0 },
      { name: 'Silver', min_visits: 2, discount_percent: 5 },
      { name: 'Gold', min_visits: 3, discount_percent: 10 },
    ],
    settings: {
      min_bill_for_visit: 500,
      stamp_enabled: 0, stamp_every: 5, stamp_reward: 'Free alteration',
      comeback_enabled: 1, comeback_percent: 10, comeback_days: 30,
      winback_percent: 15, birthday_percent: 20, inactive_after_days: 90,
    },
  },
  other: {
    label: 'Any other shop',
    tiers: [
      { name: 'Member', min_visits: 1, discount_percent: 0 },
      { name: 'Silver', min_visits: 2, discount_percent: 5 },
      { name: 'Gold', min_visits: 3, discount_percent: 10 },
    ],
    settings: {
      min_bill_for_visit: 100,
      stamp_enabled: 0, stamp_every: 7, stamp_reward: 'Free gift',
      comeback_enabled: 1, comeback_percent: 10, comeback_days: 30,
      winback_percent: 15, birthday_percent: 20, inactive_after_days: 30,
    },
  },
};

export const sortTiers = (tiers) => [...tiers].sort((a, b) => a.min_visits - b.min_visits);

/**
 * Level for a given visit number (1 = first visit).
 * The last level whose starting visit is <= visitNumber wins.
 */
export function levelFor(tiers, visitNumber) {
  const sorted = sortTiers(tiers);
  let level = sorted[0];
  for (const tier of sorted) if (tier.min_visits <= visitNumber) level = tier;
  return level;
}

/**
 * What the customer can look forward to after `visits` counted visits.
 * Used on the digital card: "Your next visit: 5% off" and
 * "Gold from visit 5 — 3 visits to go".
 */
export function journey(tiers, visits) {
  const sorted = sortTiers(tiers);
  const current = levelFor(sorted, Math.max(visits, 1));
  const nextVisit = levelFor(sorted, visits + 1);
  const upcoming = sorted.find((t) => t.min_visits > Math.max(visits, 1)) || null;
  return {
    current,
    nextVisitPercent: nextVisit.discount_percent,
    nextVisitLevel: nextVisit,
    upcoming: upcoming && {
      ...upcoming,
      visitsToGo: upcoming.min_visits - visits,
    },
  };
}

/**
 * Comeback offer: after every counted visit the customer gets
 * comeback_percent off if they return within comeback_days.
 * Returns null when there is no running offer.
 */
export function comebackOffer(program, lastCountedAt, now) {
  if (!program.comeback_enabled || !lastCountedAt || program.comeback_percent <= 0) return null;
  const expiresAt = endOfDay(addDays(lastCountedAt, program.comeback_days));
  if (now > expiresAt) return null;
  return { percent: program.comeback_percent, expiresAt };
}

/** Stamp card status: how many of the N boxes are filled right now. */
export function stampStatus(program, stampsEarned) {
  if (!program.stamp_enabled) return null;
  const every = program.stamp_every;
  return {
    every,
    filled: stampsEarned % every,
    reward: program.stamp_reward,
    rewardsEarned: Math.floor(stampsEarned / every),
  };
}

const PREFERENCE = { level: 0, comeback: 1, coupon: 2 };

/**
 * Decides everything about one bill at the counter.
 *
 * @param program   shop settings row
 * @param tiers     reward levels of the shop
 * @param stats     { countedVisits, lastCountedAt: Date|null, countedToday: bool, stampsEarned }
 * @param coupons   active, not-expired coupons of the customer
 * @param billPaise bill amount before discount, in paise
 * @param now       Date of the bill
 */
export function decideBill({ program, tiers, stats, coupons = [], billPaise, now }) {
  const minBill = (program.min_bill_for_visit || 0) * 100;
  const notes = [];
  let counts = true;
  let options = [];
  let levelVisit;

  if (billPaise < minBill) {
    // Rule 1: very small bills earn nothing (stops "₹5 toffee" visits).
    counts = false;
    notes.push(`Bills under ₹${program.min_bill_for_visit} do not count as a visit and get no discount.`);
  } else {
    if (program.one_visit_per_day && stats.countedToday) {
      // Rule 2: only one visit per day, so one bill can't be split into many visits.
      counts = false;
      notes.push('A visit was already counted today, so this bill is not a new visit. The level discount still applies.');
    }
    levelVisit = counts ? stats.countedVisits + 1 : Math.max(stats.countedVisits, 1);
    const level = levelFor(tiers, levelVisit);
    options.push({
      type: 'level',
      percent: level.discount_percent,
      label: `${level.name} level`,
    });

    const comeback = comebackOffer(program, stats.lastCountedAt, now);
    if (comeback && counts) {
      options.push({
        type: 'comeback',
        percent: comeback.percent,
        label: 'Comeback offer',
        expiresAt: comeback.expiresAt,
      });
    }

    for (const coupon of coupons) {
      options.push({
        type: 'coupon',
        percent: coupon.discount_percent,
        label: `${COUPON_KIND_LABEL[coupon.kind] || 'Coupon'} ${coupon.code}`,
        couponId: coupon.id,
        expiresAt: coupon.expires_at,
      });
    }
    options = options.filter((o) => o.percent > 0);
  }

  // Best offer wins. On a tie, prefer the one that does not use up a coupon.
  const chosen =
    [...options].sort(
      (a, b) =>
        b.percent - a.percent ||
        PREFERENCE[a.type] - PREFERENCE[b.type] ||
        String(a.expiresAt).localeCompare(String(b.expiresAt))
    )[0] || null;

  const discountPercent = chosen ? chosen.percent : 0;
  let discountPaise = Math.round((billPaise * discountPercent) / 100);
  let capped = false;
  if (program.max_discount_per_visit && discountPaise > program.max_discount_per_visit * 100) {
    discountPaise = program.max_discount_per_visit * 100;
    capped = true;
    notes.push(`Discount is capped at ₹${program.max_discount_per_visit} per bill.`);
  }

  let freeReward = null;
  let stampsAfter = stats.stampsEarned;
  if (counts && program.stamp_enabled) {
    stampsAfter += 1;
    if (stampsAfter % program.stamp_every === 0) freeReward = program.stamp_reward;
  }

  return {
    counts,
    visitNumber: counts ? stats.countedVisits + 1 : null,
    level: levelFor(tiers, levelVisit ?? Math.max(stats.countedVisits, 1)),
    options,
    chosen,
    discountPercent,
    discountPaise,
    finalPaise: billPaise - discountPaise,
    capped,
    freeReward,
    stampsAfter,
    notes,
  };
}

export const COUPON_KIND_LABEL = {
  winback: 'Win-back coupon',
  birthday: 'Birthday coupon',
  gift: 'Gift coupon',
};
