'use strict';

const { query } = require('../db/pool');

// Expiry is computed by the database clock so it agrees with NOW() in the
// checks below regardless of the app server's timezone.
module.exports = {
  /** Replaces any earlier unused tokens for the user with this one. */
  async issue(userId, tokenHash, ttlMinutes) {
    await query('DELETE FROM password_reset WHERE user_id = ? AND used_at IS NULL', [userId]);
    await query(
      'INSERT INTO password_reset (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
      [tokenHash, userId, ttlMinutes]
    );
    // Housekeeping: nothing needs tokens that expired long ago.
    await query('DELETE FROM password_reset WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)');
  },

  /**
   * Marks the token used and returns its user id, or null if it is unknown,
   * used or expired. A single conditional UPDATE makes this atomic, so two
   * concurrent requests cannot both redeem the same token.
   */
  async consume(tokenHash) {
    const result = await query(
      'UPDATE password_reset SET used_at = NOW() WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
      [tokenHash]
    );
    if (result.affectedRows !== 1) return null;
    const [row] = await query('SELECT user_id FROM password_reset WHERE token_hash = ?', [tokenHash]);
    return row ? row.user_id : null;
  },

  /** After a reset, every other token for the user is worthless. */
  async deleteOthers(userId, keepHash) {
    await query('DELETE FROM password_reset WHERE user_id = ? AND token_hash <> ?', [userId, keepHash]);
  },
};
