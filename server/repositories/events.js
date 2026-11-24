'use strict';

const { query, transaction } = require('../db/pool');
const { conflict, notFound } = require('../lib/errors');

const parseIds = (value) => {
  if (value == null) return [];
  const arr = typeof value === 'string' ? JSON.parse(value) : value;
  return arr.map(Number);
};

// DATETIME columns are stored in UTC and returned as 'YYYY-MM-DD HH:MM:SS'.
const toIso = (value) => (value ? `${value.replace(' ', 'T')}Z` : null);

const BASE_SELECT = `
  SELECT e.event_id, e.event_name, e.event_description, e.event_location,
         e.event_date_start, e.event_date_end, e.event_max, e.event_cost,
         e.event_type, t.type_name, e.event_organizer, o.user_first AS organizer_first,
         o.user_last AS organizer_last, e.event_visibility,
         (SELECT COUNT(*) FROM registration r WHERE r.event_id = e.event_id) AS attendee_count,
         EXISTS (SELECT 1 FROM registration r WHERE r.event_id = e.event_id AND r.user_id = ?) AS is_registered,
         (SELECT JSON_ARRAYAGG(eg.group_id) FROM event_group eg WHERE eg.event_id = e.event_id) AS group_ids,
         (SELECT JSON_ARRAYAGG(ei.user_id) FROM event_invite ei WHERE ei.event_id = e.event_id) AS invite_ids
    FROM event e
    JOIN \`type\` t ON t.type_id = e.event_type
    JOIN \`user\` o ON o.user_id = e.event_organizer
   WHERE e.event_status = 1`;

/** Converts a database row into the domain object used by policy and routes. */
function toEvent(row) {
  return {
    id: row.event_id,
    name: row.event_name,
    description: row.event_description,
    location: row.event_location,
    start: toIso(row.event_date_start),
    end: toIso(row.event_date_end),
    capacity: row.event_max,
    cost: Number(row.event_cost),
    type: { id: row.event_type, name: row.type_name },
    organizerId: row.event_organizer,
    organizer: { id: row.event_organizer, name: `${row.organizer_first} ${row.organizer_last}` },
    visibility: row.event_visibility,
    attendeeCount: Number(row.attendee_count),
    isRegistered: Boolean(row.is_registered),
    groupIds: parseIds(row.group_ids),
    inviteIds: parseIds(row.invite_ids),
  };
}

async function writeAudience(conn, eventId, { visibility, groupIds, inviteIds }) {
  await conn.query('DELETE FROM event_group WHERE event_id = ?', [eventId]);
  await conn.query('DELETE FROM event_invite WHERE event_id = ?', [eventId]);
  // Audience rows only matter for restricted events; public events keep none.
  if (visibility !== 'restricted') return;
  if (groupIds.length) {
    await conn.query('INSERT INTO event_group (event_id, group_id) VALUES ?', [
      groupIds.map((g) => [eventId, g]),
    ]);
  }
  if (inviteIds.length) {
    await conn.query('INSERT INTO event_invite (event_id, user_id) VALUES ?', [
      inviteIds.map((u) => [eventId, u]),
    ]);
  }
}

const columnValues = (e) => [
  e.name,
  e.description || null,
  e.location,
  e.start,
  e.end,
  e.capacity,
  e.cost,
  e.typeId,
  e.visibility,
];

module.exports = {
  toEvent,

  /**
   * Active events, unfiltered by ACL. Callers MUST pass the result through
   * policy.canViewEvent before returning anything to a client.
   */
  async list(viewerId, { includePast = false, typeId, search } = {}) {
    let sql = BASE_SELECT;
    const params = [viewerId];
    if (!includePast) sql += ' AND e.event_date_end > UTC_TIMESTAMP()';
    if (typeId) {
      sql += ' AND e.event_type = ?';
      params.push(typeId);
    }
    if (search) {
      sql += ' AND (e.event_name LIKE ? OR e.event_location LIKE ? OR e.event_description LIKE ?)';
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY e.event_date_start ASC';
    const rows = await query(sql, params);
    return rows.map(toEvent);
  },

  /** A single active event, unfiltered by ACL (see list). */
  async findById(viewerId, eventId) {
    const [row] = await query(`${BASE_SELECT} AND e.event_id = ?`, [viewerId, eventId]);
    return row ? toEvent(row) : undefined;
  },

  async create(organizerId, data) {
    const id = await transaction(async (conn) => {
      const [result] = await conn.query(
        `INSERT INTO event (event_name, event_description, event_location, event_date_start,
                            event_date_end, event_max, event_cost, event_type, event_visibility,
                            event_organizer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...columnValues(data), organizerId]
      );
      await writeAudience(conn, result.insertId, data);
      return result.insertId;
    });
    return this.findById(organizerId, id);
  },

  async update(eventId, viewerId, data) {
    await transaction(async (conn) => {
      // Lock the event so a concurrent sign-up cannot slip past the capacity check.
      const [[locked]] = await conn.query(
        'SELECT event_id FROM event WHERE event_id = ? AND event_status = 1 FOR UPDATE',
        [eventId]
      );
      if (!locked) throw notFound('Event not found');
      const [[{ taken }]] = await conn.query(
        'SELECT COUNT(*) AS taken FROM registration WHERE event_id = ?',
        [eventId]
      );
      if (data.capacity < taken) {
        throw conflict(`Capacity cannot be lower than the ${taken} people already registered.`);
      }
      await conn.query(
        `UPDATE event SET event_name = ?, event_description = ?, event_location = ?,
                          event_date_start = ?, event_date_end = ?, event_max = ?, event_cost = ?,
                          event_type = ?, event_visibility = ?
          WHERE event_id = ?`,
        [...columnValues(data), eventId]
      );
      await writeAudience(conn, eventId, data);
    });
    return this.findById(viewerId, eventId);
  },

  /** Soft delete: the row is kept for auditing but hidden everywhere. */
  async softDelete(eventId) {
    const result = await query('UPDATE event SET event_status = -1 WHERE event_id = ? AND event_status = 1', [
      eventId,
    ]);
    return result.affectedRows > 0;
  },

  async register(eventId, userId) {
    await transaction(async (conn) => {
      // FOR UPDATE serializes concurrent sign-ups for the same event, so two
      // people cannot both take the last seat.
      const [[event]] = await conn.query(
        `SELECT event_max, event_date_end <= UTC_TIMESTAMP() AS ended
           FROM event WHERE event_id = ? AND event_status = 1 FOR UPDATE`,
        [eventId]
      );
      if (!event) throw notFound('Event not found');
      if (event.ended) throw conflict('This event has already ended.');
      const [[{ taken }]] = await conn.query(
        'SELECT COUNT(*) AS taken FROM registration WHERE event_id = ?',
        [eventId]
      );
      if (taken >= event.event_max) throw conflict('This event is full.');
      try {
        await conn.query('INSERT INTO registration (event_id, user_id) VALUES (?, ?)', [eventId, userId]);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') throw conflict('You are already registered for this event.');
        throw err;
      }
    });
  },

  async unregister(eventId, userId) {
    const result = await query('DELETE FROM registration WHERE event_id = ? AND user_id = ?', [eventId, userId]);
    return result.affectedRows > 0;
  },

  async attendees(eventId) {
    return query(
      `SELECT u.user_id, u.user_first, u.user_last
         FROM registration r JOIN \`user\` u ON u.user_id = r.user_id
        WHERE r.event_id = ?
        ORDER BY r.created_at ASC`,
      [eventId]
    );
  },

  async types() {
    return query('SELECT type_id, type_name FROM `type` WHERE type_status = 1 ORDER BY type_name');
  },

  async typeExists(id) {
    const [row] = await query('SELECT 1 AS found FROM `type` WHERE type_id = ? AND type_status = 1', [id]);
    return Boolean(row);
  },
};
