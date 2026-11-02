// Unit tests for the reward engine.  Run with:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comebackOffer, decideBill, journey, levelFor, stampStatus } from '../src/rewards.js';

const tiers = [
  { name: 'Member', min_visits: 1, discount_percent: 0 },
  { name: 'Silver', min_visits: 2, discount_percent: 5 },
  { name: 'Gold', min_visits: 3, discount_percent: 10 },
  { name: 'Platinum', min_visits: 6, discount_percent: 15 },
];

const program = {
  min_bill_for_visit: 100,
  one_visit_per_day: 1,
  max_discount_per_visit: null,
  stamp_enabled: 1,
  stamp_every: 5,
  stamp_reward: 'Free coffee',
  comeback_enabled: 1,
  comeback_percent: 8,
  comeback_days: 30,
};

const now = new Date(2026, 9, 23, 12, 0, 0); // 23 Oct 2026, noon
const daysAgo = (n) => new Date(2026, 9, 23 - n, 18, 0, 0);
const stats = (over = {}) => ({ countedVisits: 0, lastCountedAt: null, countedToday: false, stampsEarned: 0, ...over });

test('level depends on the visit number', () => {
  assert.equal(levelFor(tiers, 1).name, 'Member');
  assert.equal(levelFor(tiers, 2).name, 'Silver');
  assert.equal(levelFor(tiers, 5).name, 'Gold');
  assert.equal(levelFor(tiers, 6).name, 'Platinum');
  assert.equal(levelFor(tiers, 99).name, 'Platinum');
});

test('journey tells the customer what comes next', () => {
  const j = journey(tiers, 3);
  assert.equal(j.current.name, 'Gold');
  assert.equal(j.nextVisitPercent, 10);
  assert.equal(j.upcoming.name, 'Platinum');
  assert.equal(j.upcoming.visitsToGo, 3);
  assert.equal(journey(tiers, 7).upcoming, null);
});

test('first visit: no discount, counts as visit 1', () => {
  const d = decideBill({ program, tiers, stats: stats(), billPaise: 50000, now });
  assert.equal(d.counts, true);
  assert.equal(d.visitNumber, 1);
  assert.equal(d.discountPaise, 0);
  assert.equal(d.finalPaise, 50000);
});

test('third visit gets the Gold discount (best offer wins over comeback)', () => {
  const d = decideBill({
    program, tiers, billPaise: 50000, now,
    stats: stats({ countedVisits: 2, lastCountedAt: daysAgo(5), stampsEarned: 2 }),
  });
  assert.equal(d.visitNumber, 3);
  assert.equal(d.chosen.type, 'level');
  assert.equal(d.discountPercent, 10);
  assert.equal(d.discountPaise, 5000);
  assert.equal(d.finalPaise, 45000);
});

test('comeback offer beats the level when it is bigger, and only inside the time window', () => {
  const inside = decideBill({
    program, tiers, billPaise: 20000, now,
    stats: stats({ countedVisits: 1, lastCountedAt: daysAgo(30) }),
  });
  assert.equal(inside.chosen.type, 'comeback');
  assert.equal(inside.discountPercent, 8);

  const outside = decideBill({
    program, tiers, billPaise: 20000, now,
    stats: stats({ countedVisits: 1, lastCountedAt: daysAgo(31) }),
  });
  assert.equal(outside.chosen.type, 'level');
  assert.equal(outside.discountPercent, 5);
});

test('comeback offer expires at the end of the last day', () => {
  const offer = comebackOffer(program, new Date(2026, 9, 1, 9, 0), now);
  assert.equal(offer.expiresAt.getDate(), 31);
  assert.equal(offer.expiresAt.getHours(), 23);
  assert.equal(comebackOffer({ ...program, comeback_enabled: 0 }, daysAgo(1), now), null);
});

test('bill below the minimum: no visit, no discount', () => {
  const d = decideBill({
    program, tiers, billPaise: 5000, now,
    stats: stats({ countedVisits: 4, lastCountedAt: daysAgo(2) }),
  });
  assert.equal(d.counts, false);
  assert.equal(d.discountPaise, 0);
  assert.equal(d.notes.length, 1);
});

test('second bill on the same day is not a new visit but keeps the level discount', () => {
  const d = decideBill({
    program, tiers, billPaise: 30000, now,
    stats: stats({ countedVisits: 3, lastCountedAt: daysAgo(0), countedToday: true, stampsEarned: 3 }),
  });
  assert.equal(d.counts, false);
  assert.equal(d.visitNumber, null);
  assert.equal(d.chosen.type, 'level'); // comeback is not allowed on the same day
  assert.equal(d.discountPercent, 10);
  assert.equal(d.stampsAfter, 3); // no stamp either
});

test('coupon is used only when it is the best offer; ties keep the coupon for later', () => {
  const coupon = { id: 7, code: 'MISS-AB12', kind: 'winback', discount_percent: 10, expires_at: '2026-10-30 23:59:59' };
  const tie = decideBill({
    program, tiers, billPaise: 40000, now, coupons: [coupon],
    stats: stats({ countedVisits: 4, lastCountedAt: daysAgo(60) }),
  });
  assert.equal(tie.chosen.type, 'level');

  const better = decideBill({
    program, tiers, billPaise: 40000, now, coupons: [{ ...coupon, discount_percent: 20 }],
    stats: stats({ countedVisits: 4, lastCountedAt: daysAgo(60) }),
  });
  assert.equal(better.chosen.type, 'coupon');
  assert.equal(better.chosen.couponId, 7);
  assert.equal(better.discountPaise, 8000);
});

test('discount cap per bill', () => {
  const d = decideBill({
    program: { ...program, max_discount_per_visit: 50 }, tiers, billPaise: 200000, now,
    stats: stats({ countedVisits: 7, lastCountedAt: daysAgo(3) }),
  });
  assert.equal(d.discountPercent, 15);
  assert.equal(d.discountPaise, 5000); // ₹50, not ₹300
  assert.equal(d.capped, true);
});

test('stamp card gives a free reward on every 5th stamp', () => {
  const d = decideBill({
    program, tiers, billPaise: 20000, now,
    stats: stats({ countedVisits: 3, lastCountedAt: daysAgo(3), stampsEarned: 4 }),
  });
  assert.equal(d.freeReward, 'Free coffee');
  assert.equal(d.stampsAfter, 5);
  assert.deepEqual(stampStatus(program, 5), { every: 5, filled: 0, reward: 'Free coffee', rewardsEarned: 1 });
  assert.equal(stampStatus(program, 7).filled, 2);
});
