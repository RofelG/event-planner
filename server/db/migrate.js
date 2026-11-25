'use strict';

/**
 * Minimal migration runner. Applies server/db/migrations/NNNN_name.sql files in
 * name order and records each applied version in schema_migrations.
 *
 * MySQL DDL auto-commits, so a migration cannot be rolled back. If one fails
 * halfway, its earlier statements stay applied and the version is not recorded;
 * clean up by hand before re-running. Keep migrations small (ideally one change
 * each) and idempotent where practical.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const DEFAULT_DIR = path.join(__dirname, 'migrations');
const LOCK_NAME = 'event_planner_migrations';
const LOCK_TIMEOUT_SECONDS = 60;
// Silent under tests (every test file migrates in beforeAll).
const logger = require('../lib/logger');

// Same splitting as the old applySchema: drop comment lines, split on ';' at line end.
function splitStatements(sql) {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

async function migrate({ dir = DEFAULT_DIR } = {}) {
  // The lock is per connection, so hold one connection for the whole run.
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
    if (lock.got !== 1) throw new Error('Could not acquire the migration lock');
    locked = true;

    await conn.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)'
    );
    const [rows] = await conn.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map((r) => r.version));

    const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const applied = [];
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (done.has(version)) continue;
      try {
        for (const statement of splitStatements(fs.readFileSync(path.join(dir, file), 'utf8'))) {
          await conn.query(statement);
        }
        await conn.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP())', [version]);
      } catch (err) {
        err.message = `Migration ${version} failed: ${err.message}`;
        throw err;
      }
      applied.push(version);
      logger.info({ version }, 'Applied migration');
    }
    if (!applied.length) logger.info('Database schema is up to date');
    return applied;
  } finally {
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {});
    conn.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      pool.end().finally(() => process.exit(1));
    });
}
