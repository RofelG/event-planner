'use strict';

const { query } = require('../db/pool');

module.exports = {
  async list() {
    return query(
      `SELECT g.group_id, g.group_name,
              (SELECT COUNT(*) FROM user_group ug WHERE ug.group_id = g.group_id) AS member_count
         FROM \`group\` g
        ORDER BY g.group_name`
    );
  },

  async findById(id) {
    const [row] = await query('SELECT group_id, group_name FROM `group` WHERE group_id = ?', [id]);
    return row;
  },

  async findByName(name) {
    const [row] = await query('SELECT group_id, group_name FROM `group` WHERE group_name = ?', [name]);
    return row;
  },

  /** Returns the subset of ids that exist, so callers can reject unknown ids. */
  async existingIds(ids) {
    if (!ids.length) return [];
    const rows = await query('SELECT group_id FROM `group` WHERE group_id IN (?)', [ids]);
    return rows.map((r) => r.group_id);
  },

  async create(name) {
    const result = await query('INSERT INTO `group` (group_name) VALUES (?)', [name]);
    return this.findById(result.insertId);
  },

  async rename(id, name) {
    await query('UPDATE `group` SET group_name = ? WHERE group_id = ?', [name, id]);
    return this.findById(id);
  },

  /** Membership and event sharing rows are removed by ON DELETE CASCADE. */
  async remove(id) {
    const result = await query('DELETE FROM `group` WHERE group_id = ?', [id]);
    return result.affectedRows > 0;
  },
};
