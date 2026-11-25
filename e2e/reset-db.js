'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mysql = require('mysql2/promise');

// Wipes every table in the e2e database and reseeds it, so each run starts
// from the same known data. Seeding goes through the CLI entry point so it
// keeps working however the schema is applied.
//
// Run as part of the API's webServer command (see playwright.config.js), not
// as Playwright globalSetup: Playwright starts webServers before globalSetup,
// so a reset there would drop tables under an API that is already running.
async function resetDatabase() {
  const database = process.env.DB_DB;
  // This drops tables, so refuse anything that is not clearly a throwaway
  // database. playwright.config.js always passes an e2e name (see database.js).
  if (!/e2e/i.test(database || '')) {
    throw new Error(`Refusing to reset database "${database}": its name must contain "e2e".`);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database,
  });
  try {
    const [tables] = await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of tables) await connection.query(`DROP TABLE IF EXISTS \`${Object.values(row)[0]}\``);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await connection.end();
  }

  const root = path.join(__dirname, '..');
  const seed = spawnSync(process.execPath, [path.join(root, 'server', 'db', 'seed.js')], {
    cwd: root,
    env: { ...process.env, DB_DB: database, NODE_ENV: 'development' },
    encoding: 'utf8',
  });
  if (seed.status !== 0) throw new Error(`Seeding failed:\n${seed.stdout}\n${seed.stderr}`);
}

resetDatabase().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
