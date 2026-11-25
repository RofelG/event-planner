'use strict';

/**
 * One-time setup for the browser tests: creates the <DB_DB>_e2e database and
 * lets the app's database user use it. Connects as MySQL root with
 * DB_ROOT_PASS from .env, so nothing has to be typed or quoted in a shell.
 * Fresh docker volumes get this database from server/db/test-db.sh already.
 *
 * Usage: npm run db:e2e
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mysql = require('mysql2/promise');
const { e2eDatabase } = require('./database');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_ROOT_PASS } = process.env;
  if (!DB_ROOT_PASS || !DB_USER) throw new Error('DB_ROOT_PASS and DB_USER must be set in .env');
  const database = e2eDatabase();

  const connection = await mysql.createConnection({
    host: DB_HOST || '127.0.0.1',
    port: Number(DB_PORT || 3306),
    user: 'root',
    password: DB_ROOT_PASS,
  });
  try {
    // Identifiers cannot be bound as parameters; mysql.escapeId quotes them safely.
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(database)}`);
    await connection.query(`GRANT ALL PRIVILEGES ON ${mysql.escapeId(database)}.* TO ?@'%'`, [DB_USER]);
    console.log(`Database ${database} is ready for ${DB_USER}.`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
