// Sets a new password for a shop (for when a shopkeeper forgets it).
//   npm run reset-password -- shop@example.com NewPassword123
// Works on the local database, or on Supabase when .env has DATABASE_URL.
import '../src/timezone.js';
import { closeDatabase, one, run } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const [email, password] = process.argv.slice(2);
try {
  if (!email || !password) throw new Error('Use: npm run reset-password -- shop@example.com NewPassword123');
  if (password.length < 8) throw new Error('The new password must be at least 8 characters.');
  const shop = await one(`SELECT id, name FROM shops WHERE email = :email`, { email: email.trim().toLowerCase() });
  if (!shop) throw new Error(`No shop uses the email ${email}.`);
  await run(`UPDATE shops SET password_hash = :hash WHERE id = :id`, { hash: await hashPassword(password), id: shop.id });
  await run(`DELETE FROM sessions WHERE shop_id = :id`, { id: shop.id }); // log out everywhere
  console.log(`\n  New password set for ${shop.name}. All devices were logged out.\n`);
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
