'use strict';

const mysql = require('mysql2/promise');
const config = require('../config');

// A pool (rather than the single connection the EJS app used) survives dropped
// connections and lets transactions hold their own connection.
const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  timezone: 'Z',
});

/** Run a parameterized query and return the rows. Never interpolate user input. */
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Run fn(conn) inside a transaction; commits on success, rolls back on throw. */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, transaction };
