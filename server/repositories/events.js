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
         o.user_last AS organizer_last, e.event_visibility, e.event_hidden_at,
         (SELECT COUNT(*) FROM registration r WHERE r.event_id = e.event_id) AS attendee_count,
         EXISTS (SELECT 1 FROM registration r WHERE r.event_id = e.event_id AND r.user_id = ?) AS is_registered,
         (SELECT COUNT(*) FROM waitlist w WHERE w.event_id = e.event_id) AS waitlist_count,
         -- 1-based place in line (created_at, then user_id on ties); NULL when not waiting.
         (SELECT NULLIF(COUNT(*), 0) FROM waitlist w
            JOIN waitlist me ON me.event_id = w.event_id AND me.user_id = ?
           WHERE w.event_id = e.event_id
             AND (w.created_at < me.created_at OR (w.created_at = me.created_at AND w.user_id <= me.user_id))
         ) AS waitlist_position,
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
    organizer: { id: row.event_organizer, name: `${row.organizer_first} ${row.organizer_last}`.trim() },
    visibility: row.event_visibility,
    hiddenAt: toIso(row.event_hidden_at),
    attendeeCount: Number(row.attendee_count),
    isRegistered: Boolean(row.is_registered),
    waitlistCount: Number(row.waitlist_count),
    waitlistPosition: row.waitlist_position == null ? null : Number(row.waitlist_position),
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

/**
 * Fills free seats from the waitlist, first come first served. Call inside a
 * transaction that already holds the event row lock (SELECT ... FOR UPDATE).
 * Does nothing for ended events. Returns the promoted user ids.
 */
async function promoteFromWaitlist(conn, eventId) {
  const [[event]] = await conn.query(
    'SELECT event_max, event_date_end <= UTC_TIMESTAMP() AS ended FROM event WHERE event_id = ? AND event_status = 1',
    [eventId]
  );
  if (!event || event.ended) return [];
  const [[{ taken }]] = await conn.query('SELECT COUNT(*) AS taken FROM registration WHERE event_id = ?', [eventId]);
  const free = event.event_max - taken;
  if (free <= 0) return [];
  const [next] = await conn.query(
    // Deactivated accounts keep their waitlist rows but are skipped, so a freed
    // seat never goes to someone who can no longer use it.
    `SELECT w.user_id FROM waitlist w JOIN \`user\` u ON u.user_id = w.user_id AND u.user_status = 1
      WHERE w.event_id = ? ORDER BY w.created_at ASC, w.user_id ASC LIMIT ?`,
    [eventId, free]
  );
  if (!next.length) return [];
  const userIds = next.map((r) => r.user_id);
  await conn.query('INSERT INTO registration (event_id, user_id) VALUES ?', [userIds.map((u) => [eventId, u])]);
  await conn.query('DELETE FROM waitlist WHERE event_id = ? AND user_id IN (?)', [eventId, userIds]);
  return userIds;
}

/** Locks the event row; returns it, or undefined when missing or deleted. */
async function lockEvent(conn, eventId) {
  const [[event]] = await conn.query(
    `SELECT event_max, event_date_end <= UTC_TIMESTAMP() AS ended
       FROM event WHERE event_id = ? AND event_status = 1 FOR UPDATE`,
    [eventId]
  );
  return event;
}

module.exports = {
  toEvent,

  /**
   * Active events, unfiltered by ACL. Callers MUST pass the result through
   * policy.canViewEvent before returning anything to a client.
   */
  async list(viewerId, { includePast = false, typeId, search, mine = false, after, limit } = {}) {
    let sql = BASE_SELECT;
    const params = [viewerId, viewerId];
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
    if (mine) {
      sql += ' AND EXISTS (SELECT 1 FROM registration rm WHERE rm.event_id = e.event_id AND rm.user_id = ?)';
      params.push(viewerId);
    }
    // Keyset pagination: rows strictly after the last one the client has, in
    // (start, id) order. Stable while rows are added or removed, unlike OFFSET.
    if (after) {
      sql += ' AND (e.event_date_start > ? OR (e.event_date_start = ? AND e.event_id > ?))';
      params.push(after.start, after.start, after.id);
    }
    sql += ' ORDER BY e.event_date_start ASC, e.event_id ASC';
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    const rows = await query(sql, params);
    return rows.map(toEvent);
  },

  /**
   * Demo mode: soft-deletes events organized by guests that are older than
   * ttlHours, and returns them as they were (for live `remove` messages).
   */
  async expireGuestEvents(ttlHours) {
    const rows = await query(
      `${BASE_SELECT}
         AND o.user_email LIKE 'guest-%@demo.invalid'
         AND e.created_at < NOW() - INTERVAL ? HOUR`,
      [0, 0, ttlHours]
    );
    const expired = rows.map(toEvent);
    if (expired.length) {
      await query('UPDATE event SET event_status = -1 WHERE event_id IN (?)', [expired.map((e) => e.id)]);
    }
    return expired;
  },

  /** How many events the user created in the last `hours` (demo rate limit). */
  async countCreatedSince(organizerId, hours) {
    const [row] = await query(
      'SELECT COUNT(*) AS n FROM event WHERE event_organizer = ? AND created_at > NOW() - INTERVAL ? HOUR',
      [organizerId, hours]
    );
    return Number(row.n);
  },

  /** A single active event, unfiltered by ACL (see list). */
  async findById(viewerId, eventId) {
    const [row] = await query(`${BASE_SELECT} AND e.event_id = ?`, [viewerId, viewerId, eventId]);
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
      // A higher capacity (or a later end date) may have opened seats.
      await promoteFromWaitlist(conn, eventId);
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

  /** Moderation: hides (adminId) or restores (null) an event. Keeps the first hide time. */
  async setHidden(eventId, adminId) {
    const sql = adminId
      ? `UPDATE event SET event_hidden_at = COALESCE(event_hidden_at, UTC_TIMESTAMP()),
                          event_hidden_by = COALESCE(event_hidden_by, ?)
          WHERE event_id = ? AND event_status = 1`
      : 'UPDATE event SET event_hidden_at = NULL, event_hidden_by = NULL WHERE event_id = ? AND event_status = 1';
    await query(sql, adminId ? [adminId, eventId] : [eventId]);
  },

  async register(eventId, userId) {
    await transaction(async (conn) => {
      // FOR UPDATE serializes concurrent sign-ups for the same event, so two
      // people cannot both take the last seat.
      const event = await lockEvent(conn, eventId);
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
      await conn.query('DELETE FROM waitlist WHERE event_id = ? AND user_id = ?', [eventId, userId]);
    });
  },

  /** Frees the user's seat and gives it to the first person waiting. */
  async unregister(eventId, userId) {
    return transaction(async (conn) => {
      await lockEvent(conn, eventId);
      const [result] = await conn.query('DELETE FROM registration WHERE event_id = ? AND user_id = ?', [eventId, userId]);
      if (result.affectedRows === 0) return false;
      await promoteFromWaitlist(conn, eventId);
      return true;
    });
  },

  /**
   * Removes users from every seat and waitlist (demo guest cleanup), promoting
   * waiting people into the seats freed. Returns the affected event ids.
   */
  async removeUsers(userIds) {
    const rows = await query(
      `SELECT event_id FROM registration WHERE user_id IN (?)
       UNION SELECT event_id FROM waitlist WHERE user_id IN (?)`,
      [userIds, userIds]
    );
    for (const { event_id: eventId } of rows) {
      await transaction(async (conn) => {
        await lockEvent(conn, eventId);
        await conn.query('DELETE FROM waitlist WHERE event_id = ? AND user_id IN (?)', [eventId, userIds]);
        await conn.query('DELETE FROM registration WHERE event_id = ? AND user_id IN (?)', [eventId, userIds]);
        await promoteFromWaitlist(conn, eventId);
      });
    }
    return rows.map((r) => r.event_id);
  },

  /** Joins the waitlist of a full event; 409 when seats are free, ended, registered or already waiting. */
  async joinWaitlist(eventId, userId) {
    await transaction(async (conn) => {
      const event = await lockEvent(conn, eventId);
      if (!event) throw notFound('Event not found');
      if (event.ended) throw conflict('This event has already ended.');
      const [[{ taken }]] = await conn.query('SELECT COUNT(*) AS taken FROM registration WHERE event_id = ?', [eventId]);
      if (taken < event.event_max) throw conflict('This event has free seats. Join the event instead.');
      const [[registered]] = await conn.query('SELECT 1 AS found FROM registration WHERE event_id = ? AND user_id = ?', [eventId, userId]);
      if (registered) throw conflict('You are already registered for this event.');
      try {
        await conn.query('INSERT INTO waitlist (event_id, user_id) VALUES (?, ?)', [eventId, userId]);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') throw conflict('You are already on the waitlist.');
        throw err;
      }
    });
  },

  async leaveWaitlist(eventId, userId) {
    const result = await query('DELETE FROM waitlist WHERE event_id = ? AND user_id = ?', [eventId, userId]);
    return result.affectedRows > 0;
  },

  /** User ids waiting for the event, first in line first. */
  async waitlistUserIds(eventId) {
    const rows = await query('SELECT user_id FROM waitlist WHERE event_id = ? ORDER BY created_at ASC, user_id ASC', [eventId]);
    return rows.map((r) => r.user_id);
  },

  async attendees(eventId) {
    return query(
      `SELECT u.user_id, u.user_first, u.user_last, u.user_hide_name
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
