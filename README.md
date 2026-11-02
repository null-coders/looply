# Looply: customer loyalty system for local shops

Looply keeps customers coming back in a loop. It lets any small shop run a
Starbucks-style loyalty program. Every customer gets a loyalty card on their phone
(and a printable card if they want one). Discounts grow with every visit, a mall-style
comeback offer pulls them back within a few days, and the shopkeeper can see who
stopped coming and send them an offer on WhatsApp in one tap.

* **Online:** pages on **Netlify**, data in **Supabase** (PostgreSQL). Free plans of both are enough.
* **On your laptop:** works with no setup and no internet, using a local Postgres (PGlite).

---

## 1. Run it on your Mac

1. Install **Node.js 22** or newer (the "LTS" version) from <https://nodejs.org>.
   Check it in Terminal: `node -v` should print v22.9 or higher.
2. Open Terminal in the project folder and install the libraries (needs internet once):
   ```bash
   cd ~/Downloads/looply
   npm install
   ```
3. Create the demo shop and start the app:
   ```bash
   npm run demo
   ```
4. Open <http://localhost:3000> and log in with **demo@looply.in / demo1234**
   (or press "Try the demo shop").

| Command | What it does |
|---|---|
| `npm start` | Start the app. Data is kept in `data/pglite` (or in Supabase if `.env` has `DATABASE_URL`) |
| `npm run seed` | Rebuild the demo shop with fresh demo data (other shops are not touched). Stop `npm start` first. |
| `npm run demo` | `seed` + `start` |
| `npm test` | Run the 28 automatic tests |
| `npm run reset-password -- email newpassword` | Set a new password for a shop that forgot it |
| `npm run dev` | Start and restart automatically when you change code |

Stop the app with **Ctrl+C**. To use another port: `PORT=4000 npm start`.

**From a phone on the same Wi-Fi:** Terminal prints a line like
`On phones (same Wi-Fi): http://192.168.1.5:3000`. Open that address on the phone (and on
the laptop, so QR codes point to an address phones can reach). On plain `http://` phones
block the camera, so type the mobile number or card code instead. Online (https) the
camera works everywhere.

---

## 2. Put it online (Netlify + Supabase)

You need free accounts on **GitHub**, **Supabase** and **Netlify**.

### Step A: Supabase (the database)

1. On <https://supabase.com> create a **New project**.
   * **Database password:** press *Generate a password* and save it somewhere.
     (If you type your own, use only letters and numbers; symbols like `@ # /` break the link.)
   * **Region:** choose **East US (Ohio)**. Netlify's free functions run in Ohio, so the
     app is fastest when the database is next to them. (Customer data is then stored in the US.)
2. When the project is ready, click **Connect** at the top, open **Transaction pooler**
   and copy the connection string. It looks like
   `postgresql://postgres.abcdxyz:[YOUR-PASSWORD]@aws-0-us-east-2.pooler.supabase.com:6543/postgres`.
   Replace `[YOUR-PASSWORD]` with your password. This is your **DATABASE_URL**.
   * Use *Transaction pooler* (port 6543), **not** *Direct connection*: Netlify cannot reach the direct one.
3. Nothing else to do in Supabase: Looply creates its tables by itself on the first start.

**Optional: put the demo shop online.** In the project folder, copy `.env.example` to
`.env`, paste your DATABASE_URL into it (remove the `#`), then run `npm run seed`.
It builds the demo on your laptop and copies it to Supabase in a few seconds.

### Step B: GitHub (the code)

Create an empty repository on GitHub (for example `looply`), then in the project folder:

```bash
git init
git add .
git commit -m "Looply"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/looply.git
git push -u origin main
```

`.env`, `data/` and `node_modules/` are not uploaded (see `.gitignore`), so your
password and local data stay on your laptop.

### Step C: Netlify (the website)

1. On <https://app.netlify.com> choose **Add new site → Import an existing project →
   GitHub** and pick your `looply` repository.
2. Leave the build settings as they are. Netlify reads them from `netlify.toml`:
   build command `npm run build`, publish folder `public`, functions folder `netlify/functions`.
3. Add an **environment variable**: key `DATABASE_URL`, value = your Supabase string.
   (You can also add it later under **Site configuration → Environment variables**,
   then redeploy with **Deploys → Trigger deploy**.)
4. Deploy. Open `https://your-site.netlify.app`, create your shop or log in to the demo.
5. Optional: give it a nicer address under **Site configuration → Change site name**.

### If something goes wrong

| What you see | What to do |
|---|---|
| "Cannot reach the database right now" | `DATABASE_URL` is missing or the password in it is wrong, or the Supabase project is paused. Check **Netlify → Logs → Functions → api** for the exact error. After changing the variable, redeploy. |
| It worked, then stopped after a week of no use | Free Supabase projects pause after 7 days of low activity. Open the Supabase dashboard and press **Resume project**. |
| "password authentication failed" in the logs | The password in DATABASE_URL is wrong, or has symbols. Reset it in Supabase (Database settings) to letters and numbers only. |
| "Tenant or user not found" | You copied a different connection string. Use **Transaction pooler**. |
| A shopkeeper forgot their password | On your laptop, with DATABASE_URL in `.env`: `npm run reset-password -- their@email.com NewPassword123`. It also logs them out everywhere. |

---

## 3. What it does

### For the shopkeeper

| Screen | What you can do |
|---|---|
| **Counter** | Find a customer by mobile number, card code, name, or by scanning their QR card. New number? Create a card in a few seconds. Type the bill: the best discount is worked out live on a bill slip. Press Record bill, send the receipt on WhatsApp, or undo it within 10 minutes. |
| **Home** | Today's sales, bills, discount given and new cards; 14-day sales chart; latest bills; customers who stopped coming; birthdays this week; this month's numbers. |
| **Customers** | Search, filter (joined this month, stopped coming, birthday this month, gets WhatsApp offers, by level), sort, and download the list as CSV. |
| **Customer page** | Level journey, offers they have, stamp card, every bill, coupons, QR card, print card, give a coupon, edit, delete. |
| **Bring back** | Customers who stopped coming (biggest spenders first) with a one-tap win-back offer on WhatsApp, upcoming birthdays with a birthday offer, and a tracker of every offer sent and who came back. |
| **Rewards** | Design the program: levels, comeback offer, stamp card, win-back and birthday offers, and anti-misuse rules. A live preview shows what a customer gets on each visit. Templates for cafe, salon, kirana, clothes and other shops. |
| **Reports** | Sales (with discount shown separately), repeat-visit rate, which offers were used, coupon success rate, members by level, busy and quiet days, top customers. 7 days to 1 year. |
| **Shop settings** | Shop details, counter poster with a "join" QR code, data download, password. |
| **Print card / poster** | A credit-card sized loyalty card (front and back) and an A5 counter poster. |

### For the customer (no app, no login)

* **Digital card** (`/card/<secret>`): level, next discount, comeback deadline, coupons,
  stamp card, QR code to show at the counter, visit history and money saved.
* **Join by themselves** (`/join/<shop>`): scan the counter poster, type name and number, get the card.
* **Privacy controls**: turn WhatsApp offers off or on, or delete their card and data.

WhatsApp messages open WhatsApp with the text already typed; the shopkeeper presses Send.
This is free (no WhatsApp Business API). In the **demo shop** the customers' numbers are
made up and could belong to real people, so demo messages open WhatsApp without a number.

---

## 4. How the discount is decided

All rules live in one file, `src/rewards.js`, written as pure functions so they are easy
to explain and test.

A customer can have four kinds of reward:

1. **Level discount** (Starbucks idea). The level depends on the visit number.
   Example cafe program: visit 1 Member 0%, visit 2 Regular 5%, visit 5 Gold 10%, visit 12 Family 15%.
2. **Comeback offer** (mall coupon idea). After every visit: "come back within 15 days and get 10% off".
3. **Coupons**. One-time win-back, birthday or gift coupons with an expiry date.
4. **Stamp card**. One stamp per visit; a full card gives a free item (like "Free chai").

For every bill:

```
if bill < minimum bill            -> not a visit, no discount
else if a visit was already counted today (one-visit-per-day rule)
                                  -> not a new visit; level discount and coupons still apply
else                              -> visit number = visits so far + 1

discount = the BEST ONE of: level %, comeback % (only on a new visit, inside the window),
           any unused coupon %
           (on a tie the level wins, so coupons are kept for later)
discount is capped at "biggest discount on one bill", if set
stamp card: a free reward when the stamps reach a multiple of N
```

Offers never stack, so the shop always knows the most it can lose on one bill.
The comeback offer matters most for new customers (it beats their small level discount
and builds the habit). For regulars, the level discount takes over.

---

## 5. How it is built

| Part | Technology | Why |
|---|---|---|
| Pages | Plain HTML, CSS and JavaScript modules | No build step; each screen is one HTML file + one JS file |
| API | Node.js + Express 5 | Small and popular. Online it runs as one Netlify Function (`serverless-http`) |
| Database | PostgreSQL: Supabase online, PGlite on the laptop and in tests | Same SQL everywhere; nothing to install locally |
| QR codes | `qrcode` (make) and `jsQR` (scan with camera) | Free, open source |
| Fonts | Baloo 2 and Mukta by Ek Type (an Indian type foundry), served from the site | Work without internet |

```
server.js                 runs the app on your computer
netlify.toml              Netlify settings (build, function, redirects, security headers)
netlify/functions/api.js  the API as a Netlify Function
src/
  app.js                  Express app: security headers, API, pages, error messages
  routes.js               all API endpoints
  rewards.js              the reward engine (pure functions)  <- main logic
  schema.js               database tables
  db.js                   database connection (Supabase or PGlite) + query helpers
  auth.js                 passwords, login sessions, rate limiting
  timezone.js             keeps all dates in India time, even on servers set to UTC
  utils.js                dates, money, phone numbers, random codes
  services/               shops, customers, visits (bills), offers, reports, messages
scripts/
  seed.js                 demo shop: replays 120 days of bills through the real rules
  copy-assets.js          copies fonts and the QR scanner into public/
public/                   pages, styles and browser code
test/                     rewards.test.js (rules) and api.test.js (whole app over HTTP)
```

### Database tables

| Table | Holds | Key columns |
|---|---|---|
| `shops` | each shop and its reward settings | email, password_hash, slug, min_bill_for_visit, comeback_percent, stamp_every ... |
| `tiers` | levels of a shop | shop_id, name, min_visits, discount_percent |
| `customers` | loyalty card holders | shop_id, name, phone, birthday, card_token, card_code, marketing_consent |
| `visits` | every bill | customer_id, counted, visit_number, bill_amount, discount_amount, final_amount, discount_type, coupon_id, free_reward, voided |
| `coupons` | one-time offers | customer_id, code, kind, discount_percent, expires_at, status |
| `sessions` | logged-in browsers | token, shop_id, expires_at |

A shop has many tiers, customers, visits and coupons; a customer has many visits and
coupons. Money is stored in paise (whole numbers) to avoid rounding errors.

### API (all JSON)

| Method and path | Purpose |
|---|---|
| `POST /api/auth/register`, `/login`, `/logout` | Shop account |
| `GET /api/me` | Logged-in shop, its program, useful links |
| `PUT /api/shop`, `PUT /api/shop/password` | Shop details, password |
| `GET/PUT /api/program` | Reward program (settings + levels) |
| `GET /api/customers` | List with `q`, `filter`, `level`, `sort`, `limit`, `offset` |
| `GET /api/customers/lookup?q=` | Find by card link/QR, mobile, card code or name |
| `POST /api/customers`, `GET/PUT/DELETE /api/customers/:id` | Customer CRUD |
| `POST /api/customers/:id/coupons` | Win-back, birthday or gift coupon (+ WhatsApp link) |
| `POST /api/visits/preview` | What this bill will get, before saving |
| `POST /api/visits`, `POST /api/visits/:id/undo` | Record a bill, undo it |
| `GET /api/offers/missing`, `/api/offers/birthdays`, `/api/coupons` | Bring back screen |
| `GET /api/dashboard`, `GET /api/reports?days=30` | Numbers |
| `GET /api/export/customers.csv`, `/api/export/visits.csv` | Downloads |
| `GET /api/public/cards/:token` (+ `/qr.svg`, `/consent`, `/delete`) | Customer card |
| `GET/POST /api/public/shops/:slug(/join)` | Self sign-up |

---

## 6. Security, privacy and reliability

* Passwords are hashed with **scrypt** and a random salt. Login takes the same time
  whether or not the email exists, so nobody can test which emails have shops.
* Login uses a random session token in an **httpOnly, Secure (online), SameSite** cookie.
  Changing the password logs out all other devices.
* **Every query is limited to the logged-in shop** (`shop_id`); a test checks that one
  shop can never see another shop's customers.
* Card links use a **128-bit random secret**. The public card shows only the last 4 digits
  of the phone and never the shop's private notes.
* Requests that change data must be JSON (blocks fake form posts from other sites, CSRF).
  Login, sign-up and card actions are **rate limited**.
* A strict **Content Security Policy** lets only the site's own scripts run, and all text
  is **escaped** before it is shown, so a customer named `<script>` cannot run code.
* **Row Level Security** is on for every table, so Supabase's public REST API cannot read
  the data. Looply connects as the database owner.
* Bills are saved in **transactions** with a row lock on the customer, so a double click
  or two counters cannot count a visit twice or use one coupon twice. The page also
  ignores a second click while saving.
* CSV downloads escape cells starting with `= + - @`, so Excel never runs them as formulas.
* **Consent** follows India's DPDP Rules 2025: the WhatsApp-offers box is never pre-ticked,
  offers go only to customers who agreed, and customers can switch offers off and delete
  their own data from their card. Deleting keeps old bills without a name so sales totals stay right.
* The local database refuses to open twice (for example `npm start` and `npm run seed`
  at the same time) and is closed cleanly on Ctrl+C.

---

## 7. Tests

`npm test` runs **28 tests** (11 for the reward rules, 17 for the whole app over HTTP)
on a fresh in-memory Postgres. They cover login, duplicate numbers, every bill rule,
undo, shop isolation, card privacy, consent, safe self sign-up, CSV injection, CSRF,
customer self-delete, two bills at the same moment, level validation, password change
and login timing.

To run them against a real, **empty** Postgres server:
`TEST_DATABASE_URL=postgres://... npm test` (its tables are deleted first, so never use
your real database for this).

---

## 8. Limits and future scope

* WhatsApp messages are sent by the shopkeeper with one tap. The paid WhatsApp Business
  API could send them automatically.
* Self sign-up does not check the mobile number with an OTP (SMS costs money and needs DLT
  registration in India).
* No "forgot password" email yet (the owner of the site can reset a password with
  `npm run reset-password`), and one login per shop. Email reset and staff accounts
  (only Counter) are good next steps.
* Rate limits are counted per server instance; a shared store (like Redis) would make them exact.
* A shared "bazaar" program where shops in one market earn and spend points together.
* UPI payment integration, so bills are recorded automatically.
* Hindi and other Indian languages for the screens.
