'use strict';

/**
 * The database the browser tests reset and seed. A DB_DB that already names
 * an e2e database (CI sets event_planner_e2e) is used as is; otherwise the
 * suffix is added, so the everyday DB_DB from .env (event_planner) maps to
 * event_planner_e2e and the development database is never touched.
 */
function e2eDatabase(name = process.env.DB_DB) {
  if (!name) throw new Error('DB_DB is not set (see .env.example)');
  return /e2e/i.test(name) ? name : `${name}_e2e`;
}

module.exports = { e2eDatabase };
