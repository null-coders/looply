// Shops and their reward program settings.
import { all, insert, one, run, transaction } from '../db.js';
import { hashPassword } from '../auth.js';
import { TEMPLATES, sortTiers } from '../rewards.js';
import { cleanText, fail, intInRange, normalizePhone, randomCode, slugify, toSqlDateTime } from '../utils.js';

export const CATEGORIES = Object.keys(TEMPLATES);

// Columns of the shops table that belong to the reward program.
export const PROGRAM_FIELDS = [
  'min_bill_for_visit', 'one_visit_per_day', 'max_discount_per_visit',
  'stamp_enabled', 'stamp_every', 'stamp_reward', 'welcome_stamp',
  'comeback_enabled', 'comeback_percent', 'comeback_days',
  'winback_percent', 'winback_days', 'birthday_percent', 'inactive_after_days',
];

export function getTiers(shopId) {
  return all(
    `SELECT id, name, min_visits, discount_percent FROM tiers WHERE shop_id = :shopId ORDER BY min_visits`,
    { shopId }
  );
}

export const getShop = (id) => one(`SELECT * FROM shops WHERE id = :id`, { id });

export async function getProgram(shop) {
  const settings = {};
  for (const field of PROGRAM_FIELDS) settings[field] = shop[field];
  return { settings, tiers: await getTiers(shop.id) };
}

/** Shop fields that are safe to send to the browser (no password hash). */
export function shopProfile(shop) {
  return {
    id: shop.id,
    name: shop.name,
    ownerName: shop.owner_name,
    email: shop.email,
    phone: shop.phone,
    category: shop.category,
    address: shop.address,
    slug: shop.slug,
    createdAt: shop.created_at,
  };
}

async function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base;
  while (await one(`SELECT 1 FROM shops WHERE slug = :slug`, { slug })) {
    slug = `${base}-${randomCode(4).toLowerCase()}`;
  }
  return slug;
}

export async function createShop(input) {
  const name = cleanText(input.shopName, 60);
  const ownerName = cleanText(input.ownerName, 60);
  const email = cleanText(input.email, 120).toLowerCase();
  const password = String(input.password ?? '');
  const category = CATEGORIES.includes(input.category) ? input.category : 'other';
  const phone = input.phone ? normalizePhone(input.phone) : null;

  if (name.length < 2) fail(400, 'Enter your shop name.');
  if (ownerName.length < 2) fail(400, 'Enter the owner name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters.');
  if (password.length > 200) fail(400, 'Password is too long.');
  if (input.phone && !phone) fail(400, 'Enter a valid 10-digit mobile number.');
  if (await one(`SELECT 1 FROM shops WHERE email = :email`, { email })) {
    fail(409, 'A shop with this email already exists. Log in instead.');
  }

  const template = TEMPLATES[category];
  const hash = await hashPassword(password);
  const slug = await uniqueSlug(name);
  try {
    return await transaction(async () => {
      const shopId = await insert(
        `INSERT INTO shops (name, owner_name, email, phone, password_hash, category, address, slug, created_at)
         VALUES (:name, :ownerName, :email, :phone, :hash, :category, :address, :slug, :createdAt)`,
        {
          name, ownerName, email, phone, category, hash, slug,
          address: cleanText(input.address, 160) || null,
          createdAt: toSqlDateTime(input.now || new Date()),
        }
      );
      await applyProgram(shopId, { ...template.settings, tiers: template.tiers });
      return getShop(shopId);
    });
  } catch (err) {
    // Two sign-ups with the same email at the same moment
    if (err.code === '23505') fail(409, 'A shop with this email already exists. Log in instead.');
    throw err;
  }
}

export async function updateShopProfile(shop, input) {
  const name = cleanText(input.name, 60);
  const ownerName = cleanText(input.ownerName, 60);
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (name.length < 2) fail(400, 'Enter your shop name.');
  if (ownerName.length < 2) fail(400, 'Enter the owner name.');
  if (input.phone && !phone) fail(400, 'Enter a valid 10-digit mobile number.');
  await run(
    `UPDATE shops SET name = :name, owner_name = :ownerName, phone = :phone,
       address = :address, category = :category WHERE id = :id`,
    {
      id: shop.id, name, ownerName, phone,
      address: cleanText(input.address, 160) || null,
      category: CATEGORIES.includes(input.category) ? input.category : shop.category,
    }
  );
}

/** Checks every program setting and returns clean values (or throws a 400 error). */
export function validateProgram(input) {
  // A missing switch keeps its default (on), so templates don't need to list every switch.
  const bool = (v, missing = 1) => (v === undefined || v === null ? missing : v === true || v === 1 || v === '1' ? 1 : 0);
  const s = {
    min_bill_for_visit: intInRange(input.min_bill_for_visit ?? 0, 0, 100000, 'Smallest bill that counts as a visit'),
    one_visit_per_day: bool(input.one_visit_per_day),
    max_discount_per_visit:
      input.max_discount_per_visit === null || input.max_discount_per_visit === '' || input.max_discount_per_visit === undefined
        ? null
        : intInRange(input.max_discount_per_visit, 1, 100000, 'Biggest discount on one bill'),
    stamp_enabled: bool(input.stamp_enabled),
    stamp_every: intInRange(input.stamp_every ?? 7, 2, 50, 'Stamps for a reward'),
    stamp_reward: cleanText(input.stamp_reward, 40) || null,
    welcome_stamp: bool(input.welcome_stamp),
    comeback_enabled: bool(input.comeback_enabled),
    comeback_percent: intInRange(input.comeback_percent ?? 10, 1, 90, 'Comeback discount'),
    comeback_days: intInRange(input.comeback_days ?? 30, 1, 365, 'Comeback days'),
    winback_percent: intInRange(input.winback_percent ?? 15, 1, 90, 'Win-back discount'),
    winback_days: intInRange(input.winback_days ?? 7, 1, 90, 'Win-back coupon validity'),
    birthday_percent: intInRange(input.birthday_percent ?? 20, 1, 90, 'Birthday discount'),
    inactive_after_days: intInRange(input.inactive_after_days ?? 30, 7, 365, 'Days after which a customer has stopped coming'),
  };
  if (s.stamp_enabled && !s.stamp_reward) fail(400, 'Write the free reward for a full stamp card, e.g. "Free chai".');

  const rawTiers = Array.isArray(input.tiers) ? input.tiers : [];
  if (rawTiers.length < 1 || rawTiers.length > 8) fail(400, 'Add between 1 and 8 levels.');
  const tiers = sortTiers(
    rawTiers.map((t, i) => ({
      name: cleanText(t?.name, 24) || fail(400, `Level ${i + 1} needs a name.`),
      min_visits: intInRange(t?.min_visits, 1, 1000, `Starting visit of level ${i + 1}`),
      discount_percent: intInRange(t?.discount_percent, 0, 90, `Discount of level ${i + 1}`),
    }))
  );
  if (tiers[0].min_visits !== 1) fail(400, 'The first level must start at visit 1.');
  const names = new Set();
  for (let i = 0; i < tiers.length; i++) {
    const key = tiers[i].name.toLowerCase();
    if (names.has(key)) fail(400, `Two levels are called "${tiers[i].name}". Give each level its own name.`);
    names.add(key);
    if (i === 0) continue;
    if (tiers[i].min_visits === tiers[i - 1].min_visits) fail(400, 'Two levels cannot start at the same visit.');
    if (tiers[i].discount_percent < tiers[i - 1].discount_percent) {
      fail(400, `${tiers[i].name} must give at least as much discount as ${tiers[i - 1].name}.`);
    }
  }
  return { settings: s, tiers };
}

async function applyProgram(shopId, input) {
  const { settings, tiers } = validateProgram(input);
  const sets = PROGRAM_FIELDS.map((f) => `${f} = :${f}`).join(', ');
  await run(`UPDATE shops SET ${sets} WHERE id = :shopId`, { ...settings, shopId });
  await run(`DELETE FROM tiers WHERE shop_id = :shopId`, { shopId });
  for (const tier of tiers) {
    await run(
      `INSERT INTO tiers (shop_id, name, min_visits, discount_percent)
       VALUES (:shopId, :name, :min_visits, :discount_percent)`,
      { shopId, ...tier }
    );
  }
}

export function updateProgram(shop, input) {
  return transaction(() => applyProgram(shop.id, input));
}
