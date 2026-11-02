// Runs Looply on your computer.
//   npm start          -> http://localhost:3000
//   PORT=4000 npm start
import './src/timezone.js';
import { createApp } from './src/app.js';
import { closeDatabase, databaseKind, explainDatabaseError } from './src/db.js';
import { lanUrls } from './src/routes.js';

const port = Number(process.env.PORT) || 3000;

try {
  const kind = await databaseKind(); // connect (and create tables) before taking requests
  const server = createApp().listen(port, () => {
    console.log('\n  Looply is running');
    console.log(`  Database: ${kind === 'postgres' ? 'Supabase / Postgres (DATABASE_URL)' : 'local (data/pglite)'}`);
    console.log(`  On this computer:  http://localhost:${port}`);
    for (const url of lanUrls(port)) console.log(`  On phones (same Wi-Fi): ${url}`);
    console.log('\n  Demo login: demo@looply.in / demo1234  (run "npm run seed" first)\n');
  });
  server.on('error', (err) => {
    console.error(
      err.code === 'EADDRINUSE'
        ? `\n  Port ${port} is already in use. Is Looply already running? Or start it on another port: PORT=4000 npm start\n`
        : `\n  Looply could not start: ${err.message}\n`
    );
    process.exit(1);
  });
} catch (err) {
  const hint = explainDatabaseError(err);
  console.error(`\n  Looply could not start: ${err.message}${hint ? `\n  What to do: ${hint}` : ''}\n`);
  process.exit(1);
}

// Ctrl+C: close the database properly before quitting, so no data is lost.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.log('\n  Stopping Looply...');
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
}
