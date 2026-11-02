// =====================================================================
//  Looply database schema (PostgreSQL)
//
//  shops ──< tiers            one shop has many reward levels
//  shops ──< customers        one shop has many loyalty-card holders
//  customers ──< visits       every purchase at the counter is a visit
//  customers ──< coupons      one-time offers (win-back, birthday, gift)
//  shops ──< sessions         logged-in browser sessions of the shopkeeper
//
//  Conventions
//  * Money is stored in PAISE as integers (Rs 149.50 -> 14950) so we never
//    get rounding errors.
//  * Date-times are stored as text 'YYYY-MM-DD HH:MM:SS' in the shop's time
//    zone (India). COLLATE "C" makes text comparison byte-by-byte, so
//    '2026-10-23 09:00:00' < '2026-10-23 18:30:00' works like dates do.
//  * Switches are stored as 0 / 1.
//  * Row Level Security is switched on with no policies. Looply talks to the
//    database directly as its owner, so it is not affected, but Supabase's
//    public REST API cannot read these tables.
//
//  The same file works on Supabase (production) and on PGlite (Postgres
//  running inside Node, used on your laptop and in tests).
// =====================================================================
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS shops (
  id                     SERIAL PRIMARY KEY,
  name                   TEXT    NOT NULL,
  owner_name             TEXT    NOT NULL,
  email                  TEXT    NOT NULL UNIQUE,
  phone                  TEXT,
  password_hash          TEXT    NOT NULL,           -- scrypt hash + salt, never the real password
  category               TEXT    NOT NULL DEFAULT 'other', -- cafe | salon | kirana | fashion | other
  address                TEXT,
  slug                   TEXT    NOT NULL UNIQUE,    -- used in the public join link /join/<slug>

  -- Reward program rules (edited on the Rewards screen)
  min_bill_for_visit     INTEGER NOT NULL DEFAULT 0, -- rupees; smaller bills earn no visit and no discount
  one_visit_per_day      INTEGER NOT NULL DEFAULT 1, -- 1 = only the first bill of the day counts as a visit
  max_discount_per_visit INTEGER,                    -- rupees; NULL = no cap
  stamp_enabled          INTEGER NOT NULL DEFAULT 0, -- stamp card: every Nth stamp gets a free reward
  stamp_every            INTEGER NOT NULL DEFAULT 7,
  stamp_reward           TEXT,
  welcome_stamp          INTEGER NOT NULL DEFAULT 1, -- 1 = new members start with one free stamp
  comeback_enabled       INTEGER NOT NULL DEFAULT 1, -- "come back within N days and get X% off"
  comeback_percent       INTEGER NOT NULL DEFAULT 10,
  comeback_days          INTEGER NOT NULL DEFAULT 30,
  winback_percent        INTEGER NOT NULL DEFAULT 15, -- coupon sent to customers who stopped coming
  winback_days           INTEGER NOT NULL DEFAULT 7,  -- how long that coupon stays valid
  birthday_percent       INTEGER NOT NULL DEFAULT 20,
  inactive_after_days    INTEGER NOT NULL DEFAULT 30, -- no visit for this many days = "stopped coming"

  created_at             TEXT COLLATE "C" NOT NULL
);

-- Reward levels. A customer's level depends on how many visits they have made.
-- Example: Member from visit 1 (0%), Silver from visit 2 (5%), Gold from visit 3 (10%)
CREATE TABLE IF NOT EXISTS tiers (
  id               SERIAL PRIMARY KEY,
  shop_id          INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  min_visits       INTEGER NOT NULL,   -- level starts at this visit number (first level is always 1)
  discount_percent INTEGER NOT NULL,
  UNIQUE (shop_id, min_visits)
);

CREATE TABLE IF NOT EXISTS customers (
  id                SERIAL PRIMARY KEY,
  shop_id           INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,
  phone             TEXT    NOT NULL,          -- 10-digit Indian mobile number
  birthday          TEXT,                      -- 'MM-DD' (the year is not needed)
  card_token        TEXT    NOT NULL UNIQUE,   -- long random secret used in the card link and QR code
  card_code         TEXT    NOT NULL,          -- short code printed on the card, typed at the counter
  bonus_stamps      INTEGER NOT NULL DEFAULT 0,
  marketing_consent INTEGER NOT NULL DEFAULT 0, -- 1 = agreed to receive offers on WhatsApp
  consent_at        TEXT COLLATE "C",
  joined_via        TEXT    NOT NULL DEFAULT 'counter', -- counter | qr
  notes             TEXT,
  created_at        TEXT COLLATE "C" NOT NULL,
  UNIQUE (shop_id, phone),
  UNIQUE (shop_id, card_code)
);

-- One-time offers. The comeback offer is NOT stored here: it is worked out
-- from the date of the customer's last visit (see src/rewards.js).
CREATE TABLE IF NOT EXISTS coupons (
  id               SERIAL PRIMARY KEY,
  shop_id          INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id      INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  code             TEXT    NOT NULL,
  kind             TEXT    NOT NULL,          -- winback | birthday | gift
  discount_percent INTEGER NOT NULL,
  expires_at       TEXT COLLATE "C" NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'active', -- active | used | cancelled (expired is worked out)
  used_at          TEXT COLLATE "C",
  created_at       TEXT COLLATE "C" NOT NULL,
  UNIQUE (shop_id, code)
);

-- Every bill recorded at the counter.
CREATE TABLE IF NOT EXISTS visits (
  id               SERIAL PRIMARY KEY,
  shop_id          INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id      INTEGER REFERENCES customers(id) ON DELETE SET NULL, -- kept for reports if a customer deletes their data
  counted          INTEGER NOT NULL DEFAULT 1, -- 0 = bill recorded but it did not count as a visit (rules)
  visit_number     INTEGER,                    -- 1st, 2nd, 3rd ... counted visit of this customer
  bill_amount      INTEGER NOT NULL,           -- paise, before discount
  discount_percent INTEGER NOT NULL DEFAULT 0,
  discount_amount  INTEGER NOT NULL DEFAULT 0, -- paise
  final_amount     INTEGER NOT NULL,           -- paise, what the customer paid
  discount_type    TEXT,                       -- level | comeback | coupon | NULL
  discount_label   TEXT,                       -- e.g. 'Gold level' or 'Win-back coupon MISS-7Q2K'
  coupon_id        INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  free_reward      TEXT,                       -- stamp-card reward given on this visit
  voided           INTEGER NOT NULL DEFAULT 0, -- 1 = undone by the shopkeeper (ignored everywhere)
  voided_at        TEXT COLLATE "C",
  created_at       TEXT COLLATE "C" NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  shop_id    INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL,
  expires_at TEXT COLLATE "C" NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tiers_shop        ON tiers (shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_shop    ON customers (shop_id);
CREATE INDEX IF NOT EXISTS idx_visits_shop_time  ON visits (shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_visits_customer   ON visits (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_visits_coupon     ON visits (coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupons_customer  ON coupons (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_coupons_shop_time ON coupons (shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_shop     ON sessions (shop_id);

ALTER TABLE shops     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons   ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions  ENABLE ROW LEVEL SECURITY;
`;
