'use strict';

const { query, transaction } = require('../db/pool');
const { isGuestEmail } = require('../demo/accounts');

// Simulated demo attendees are not people: keep them out of user lists.
const NOT_BOT = "user_email NOT LIKE 'bot-%@demo.invalid'";

const PUBLIC_COLUMNS = 'user_id, user_first, user_last, user_email, user_role, user_status, user_hide_name, token_version';

module.exports = {
  /** Includes the password hash; only used by the login and password routes. */
  async findByEmailWithHash(email) {
    const [row] = await query(
      `SELECT ${PUBLIC_COLUMNS}, user_password FROM \`user\` WHERE user_email = ? AND user_status = 1 LIMIT 1`,
      [email]
    );
    return row;
  },

  async findActiveById(id) {
    const [row] = await query(
      `SELECT ${PUBLIC_COLUMNS} FROM \`user\` WHERE user_id = ? AND user_status = 1 LIMIT 1`,
      [id]
    );
    return row;
  },

  async findHashById(id) {
    const [row] = await query('SELECT user_password FROM `user` WHERE user_id = ? LIMIT 1', [id]);
    return row?.user_password;
  },

  async emailExists(email) {
    const [row] = await query('SELECT 1 AS found FROM `user` WHERE user_email = ? LIMIT 1', [email]);
    return Boolean(row);
  },

  async create({ first, last, email, passwordHash, role = 'user' }) {
    const result = await query(
      'INSERT INTO `user` (user_first, user_last, user_email, user_password, user_role) VALUES (?, ?, ?, ?, ?)',
      [first, last, email, passwordHash, role]
    );
    return this.findActiveById(result.insertId);
  },

  /** Stores the new hash and bumps token_version so other sessions are signed out. */
  async updatePassword(id, passwordHash) {
    await query(
      'UPDATE `user` SET user_password = ?, token_version = token_version + 1 WHERE user_id = ?',
      [passwordHash, id]
    );
    return this.findActiveById(id);
  },

  async updateSettings(id, { hideName }) {
    await query('UPDATE `user` SET user_hide_name = ? WHERE user_id = ?', [hideName ? 1 : 0, id]);
    return this.findActiveById(id);
  },

  /** Demo mode: a visitor who gave their name to join or create an event. */
  async createGuest({ name, email, passwordHash }) {
    const result = await query(
      "INSERT INTO `user` (user_first, user_last, user_email, user_password, user_role) VALUES (?, '', ?, ?, 'user')",
      [name, email, passwordHash]
    );
    return this.findActiveById(result.insertId);
  },

  async groupIdsFor(userId) {
    const rows = await query('SELECT group_id FROM user_group WHERE user_id = ?', [userId]);
    return rows.map((r) => r.group_id);
  },

  /** Names only: what planners need to pick invitees. */
  async directory() {
    return query(
      `SELECT user_id, user_first, user_last FROM \`user\` WHERE user_status = 1 AND ${NOT_BOT} ORDER BY user_last, user_first`
    );
  },

  /** Full listing for the admin Users page. */
  async listWithGroups() {
    return query(
      `SELECT u.user_id, u.user_first, u.user_last, u.user_email, u.user_role, u.user_status,
              (SELECT JSON_ARRAYAGG(ug.group_id) FROM user_group ug WHERE ug.user_id = u.user_id) AS group_ids
         FROM \`user\` u
        WHERE u.${NOT_BOT}
        ORDER BY u.user_last, u.user_first`
    );
  },

  async exists(id) {
    const [row] = await query('SELECT 1 AS found FROM `user` WHERE user_id = ? LIMIT 1', [id]);
    return Boolean(row);
  },

  /** Admin update of role, active flag and group membership. Undefined fields are left as-is. */
  async adminUpdate(id, { role, active, groupIds }) {
    await transaction(async (conn) => {
      if (role !== undefined) {
        await conn.query('UPDATE `user` SET user_role = ? WHERE user_id = ?', [role, id]);
      }
      if (active !== undefined) {
        // Deactivating also bumps token_version so the user is signed out at once.
        await conn.query(
          'UPDATE `user` SET user_status = ?, token_version = token_version + ? WHERE user_id = ?',
          [active ? 1 : 0, active ? 0 : 1, id]
        );
      }
      if (groupIds !== undefined) {
        await conn.query('DELETE FROM user_group WHERE user_id = ?', [id]);
        if (groupIds.length) {
          await conn.query('INSERT INTO user_group (user_id, group_id) VALUES ?', [
            groupIds.map((g) => [id, g]),
          ]);
        }
      }
    });
  },

  /** The shape of req.user. */
  toPrincipal(row) {
    return {
      id: row.user_id,
      first: row.user_first,
      last: row.user_last,
      email: row.user_email,
      role: row.user_role,
      // Demo visitors who gave a name; they have no password to manage.
      isGuest: isGuestEmail(row.user_email),
      hideName: Boolean(row.user_hide_name),
    };
  },
};
