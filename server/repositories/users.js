'use strict';

const { query, transaction } = require('../db/pool');
const { isGuestEmail } = require('../demo/accounts');

// Simulated demo attendees are not people: keep them out of user lists.
const NOT_BOT = "user_email NOT LIKE 'bot-%@demo.invalid'";
// Deleted accounts are anonymized in place (past events still reference them).
const NOT_DELETED = "user_email NOT LIKE 'deleted-%@deleted.invalid'";

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

  /** No password hash: for flows that only need to know the account exists. */
  async findActiveByEmail(email) {
    const [row] = await query(
      `SELECT ${PUBLIC_COLUMNS} FROM \`user\` WHERE user_email = ? AND user_status = 1 LIMIT 1`,
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
      `SELECT user_id, user_first, user_last FROM \`user\` WHERE user_status = 1 AND ${NOT_BOT} AND ${NOT_DELETED} ORDER BY user_last, user_first`
    );
  },

  /** Full listing for the admin Users page. */
  async listWithGroups() {
    return query(
      `SELECT u.user_id, u.user_first, u.user_last, u.user_email, u.user_role, u.user_status,
              (SELECT JSON_ARRAYAGG(ug.group_id) FROM user_group ug WHERE ug.user_id = u.user_id) AS group_ids
         FROM \`user\` u
        WHERE u.${NOT_BOT} AND u.${NOT_DELETED}
        ORDER BY u.user_last, u.user_first`
    );
  },

  /** Lowest-id active admin other than the given user: who inherits their upcoming events. */
  async otherAdminId(userId) {
    const [row] = await query(
      "SELECT user_id FROM `user` WHERE user_role = 'admin' AND user_status = 1 AND user_id <> ? ORDER BY user_id ASC LIMIT 1",
      [userId]
    );
    return row?.user_id;
  },

  /** Ids of upcoming (not ended, not deleted) events the user organizes. */
  async upcomingOrganizedIds(userId) {
    const rows = await query(
      'SELECT event_id FROM event WHERE event_organizer = ? AND event_status = 1 AND event_date_end > UTC_TIMESTAMP()',
      [userId]
    );
    return rows.map((r) => r.event_id);
  },

  /**
   * Account deletion, in one transaction: hands upcoming events to the admin,
   * drops groups, invites and reset tokens, and anonymizes the row. The row is
   * kept because past events reference it. Seats and waitlist places are
   * handled before this by events.removeUsers. Returns the affected event ids.
   */
  async anonymize(id, { adminId, passwordHash }) {
    return transaction(async (conn) => {
      const [moved] = await conn.query(
        'SELECT event_id FROM event WHERE event_organizer = ? AND event_status = 1 AND event_date_end > UTC_TIMESTAMP() FOR UPDATE',
        [id]
      );
      const eventIds = moved.map((r) => r.event_id);
      if (eventIds.length) {
        await conn.query('UPDATE event SET event_organizer = ? WHERE event_id IN (?)', [adminId, eventIds]);
      }
      const [invited] = await conn.query('SELECT event_id FROM event_invite WHERE user_id = ?', [id]);
      await conn.query('DELETE FROM event_invite WHERE user_id = ?', [id]);
      await conn.query('DELETE FROM user_group WHERE user_id = ?', [id]);
      await conn.query('DELETE FROM password_reset WHERE user_id = ?', [id]);
      await conn.query(
        `UPDATE \`user\` SET user_first = 'Deleted user', user_last = '', user_email = ?, user_password = ?,
                user_status = 0, user_hide_name = 1, token_version = token_version + 1
          WHERE user_id = ?`,
        [`deleted-${id}@deleted.invalid`, passwordHash, id]
      );
      return [...new Set([...eventIds, ...invited.map((r) => r.event_id)])];
    });
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
