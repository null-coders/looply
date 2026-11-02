// Database connection + small query helpers. Looply uses PostgreSQL:
//
//  * Online (Netlify): set DATABASE_URL to your Supabase connection string.
//  * On your laptop and in tests: no setup needed. Without DATABASE_URL,
//    Looply uses PGlite, a real Postgres that runs inside Node and keeps its
//    data in the folder data/pglite.  DB_PATH=memory keeps it in memory only.
//
// SQL in this project uses named parameters like :shopId. They are turned
// into Postgres' $1, $2 ... here, so the rest of the code stays readable.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA } from './schema.js';

const transactionClient = new AsyncLocalStorage();

/**
 * Inside a transaction every query must use the same connection, one query
 * at a time. This wraps a connection so parallel calls wait their turn.
 */
function serialized(connection) {
  let queue = Promise.resolve();
  return {
    query(text, values) {
      const result = queue.then(() => connection.query(text, values));
      queue = result.catch(() => {});
      return result;
    },
  };
}
let databasePromise = null;

/** Postgres returns COUNT/SUM as text (they can be huge); our numbers fit, so read them as numbers. */
const toNumber = (value) => (value === null ? null : Number(value));
const BIGINT = 20;
const NUMERIC = 1700;

async function createSchema(query) {
  // Only the first start creates tables. The lock stops two servers starting
  // at the same moment from creating the same table twice.
  const { rows } = await query(`SELECT to_regclass('public.sessions') IS NOT NULL AS ready`);
  if (rows[0].ready) return;
  await query(`BEGIN; SELECT pg_advisory_xact_lock(7731); ${SCHEMA} COMMIT;`);
}

/**
 * Removes "sslmode" from the connection string: with it, node-postgres would
 * insist on checking Supabase's certificate and refuse to connect.
 */
function withoutSslMode(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}

async function connectPostgres(rawUrl) {
  const url = withoutSslMode(rawUrl);
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(BIGINT, toNumber);
  pg.types.setTypeParser(NUMERIC, toNumber);
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    // Supabase needs SSL. Its certificate is not in Node's default list, so we
    // encrypt without checking the certificate chain (the usual setup for Supabase).
    ssl: local ? false : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_SIZE) || 3, // serverless: keep few connections per instance
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('Database connection error:', err.message));
  await createSchema((text) => pool.query(text));
  return {
    kind: 'postgres',
    query: (text, values, tx) => (tx || pool).query(text, values),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await transactionClient.run(serialized(client), fn);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function connectPGlite() {
  // The package name is in a variable so the Netlify bundler does not pack
  // PGlite into the online function (online always uses DATABASE_URL).
  const pkg = '@electric-sql/pglite';
  let PGlite;
  try {
    ({ PGlite } = await import(pkg));
  } catch {
    throw new Error('DATABASE_URL is not set. Add your Supabase connection string as DATABASE_URL.');
  }
  const where = process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'pglite');
  let unlock = () => {};
  if (where !== 'memory') {
    fs.mkdirSync(where, { recursive: true });
    unlock = lockFolder(where);
  }
  const db = new PGlite(where === 'memory' ? undefined : where, {
    parsers: { [BIGINT]: toNumber, [NUMERIC]: toNumber },
  });
  await db.waitReady;
  await createSchema(async (text) => {
    if (text.includes(';')) {
      await db.exec(text);
      return { rows: [] };
    }
    return db.query(text);
  });
  return {
    kind: 'pglite',
    query: (text, values, tx) => (tx || db).query(text, values),
    transaction: (fn) => db.transaction((tx) => transactionClient.run(serialized(tx), fn)),
    close: async () => {
      await db.close();
      unlock();
    },
  };
}

/**
 * The local database folder may only be used by one program at a time
 * (for example not "npm start" and "npm run seed" together), or it can break.
 * A small lock file with our process id guards it.
 */
function lockFolder(folder) {
  const lockFile = `${folder}.lock`;
  try {
    const pid = Number(fs.readFileSync(lockFile, 'utf8'));
    if (pid && pid !== process.pid) {
      process.kill(pid, 0); // throws if that program is no longer running
      throw new Error(
        'Looply is already running in another Terminal window (or "npm run seed" is). Stop it with Ctrl+C first.'
      );
    }
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ESRCH') throw err;
  }
  fs.writeFileSync(lockFile, String(process.pid));
  const unlock = () => {
    try {
      if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.unlinkSync(lockFile);
    } catch {
      // already gone
    }
  };
  process.once('exit', unlock);
  return unlock;
}

function database() {
  if (!databasePromise) {
    databasePromise = (process.env.DATABASE_URL ? connectPostgres(process.env.DATABASE_URL) : connectPGlite()).catch(
      (err) => {
        databasePromise = null; // try again on the next request
        throw err;
      }
    );
  }
  return databasePromise;
}

/** ':shopId' style SQL -> '$1' style SQL + values array. '::int' casts are left alone. */
function toPositional(sql, params) {
  const names = [];
  const text = sql.replace(/(?<!:):([A-Za-z_]\w*)/g, (_, name) => {
    let index = names.indexOf(name);
    if (index === -1) index = names.push(name) - 1;
    return `$${index + 1}`;
  });
  const values = names.map((name) => {
    const value = params[name];
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
  return { text, values };
}

async function execute(sql, params) {
  const db = await database();
  const { text, values } = toPositional(sql, params);
  const result = await db.query(text, values, transactionClient.getStore());
  return { rows: result.rows, changes: result.rowCount ?? result.affectedRows ?? 0 };
}

/** All matching rows */
export const all = async (sql, params = {}) => (await execute(sql, params)).rows;
/** First matching row, or undefined */
export const one = async (sql, params = {}) => (await execute(sql, params)).rows[0];
/** UPDATE / DELETE -> { changes } */
export const run = async (sql, params = {}) => ({ changes: (await execute(sql, params)).changes });
/** INSERT a row and return its new id */
export const insert = async (sql, params = {}) => (await execute(`${sql} RETURNING id`, params)).rows[0].id;

/**
 * Runs fn() inside a transaction: either every change is saved or none is.
 * Queries made inside fn() automatically use the transaction.
 */
export async function transaction(fn) {
  if (transactionClient.getStore()) return fn(); // already inside one
  const db = await database();
  return db.transaction(fn);
}

/**
 * Turns a database connection error into a plain next step for the site owner.
 * Never includes the connection string or password. Returns null for other errors.
 */
export function explainDatabaseError(err) {
  const text = `${err?.code || ''} ${err?.message || ''}`;
  if (/DATABASE_URL is not set/.test(text)) {
    return 'DATABASE_URL is not set on Netlify. Add it under Project configuration > Environment variables, then deploy again.';
  }
  if (/password authentication failed/i.test(text)) {
    return 'The password inside DATABASE_URL is wrong. Reset the database password in Supabase (letters and numbers only), update DATABASE_URL and deploy again.';
  }
  if (/Tenant or user not found/i.test(text)) {
    return 'Use the "Transaction pooler" connection string from Supabase > Connect (its user looks like postgres.xxxx).';
  }
  if (/ENOTFOUND|EAI_AGAIN|Invalid URL|getaddrinfo/i.test(text)) {
    return 'The address in DATABASE_URL is wrong. Copy it again from Supabase > Connect > Transaction pooler.';
  }
  if (/ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ETIMEDOUT|timeout/i.test(text)) {
    return 'Cannot reach the database. Use the "Transaction pooler" string (port 6543), not "Direct connection". If it was working before, the free Supabase project may be paused: open Supabase and press Resume project.';
  }
  if (/Cannot find (package|module) 'pg'/i.test(text)) {
    return 'The database library is missing from the deploy. Deploy from GitHub (or run npm install before dragging the folder) so Netlify includes node_modules.';
  }
  return null;
}

/** Which database is in use: 'postgres' (Supabase) or 'pglite' (local) */
export async function databaseKind() {
  return (await database()).kind;
}

/** Closes the connection (used by scripts and tests). */
export async function closeDatabase() {
  if (!databasePromise) return;
  const db = await databasePromise;
  databasePromise = null;
  await db.close();
}
