'use strict';

/**
 * Development seed: event types, groups, an admin, a planner, a regular user
 * and sample events covering each visibility mode. Safe to run repeatedly.
 * Credentials come from the SEED_* variables in .env (see .env.example).
 */
const config = require('../config');
const { pool, query } = require('./pool');
const { migrate } = require('./migrate');
const { hashPassword } = require('../lib/passwords');

const TYPES = ['Conference', 'Workshop', 'Social', 'Sports', 'Networking', 'Training'];
const GROUPS = ['Staff', 'Volunteers', 'VIP'];

async function applySchema() {
  await migrate();
}

async function upsertUser({ first, last, email, password, role }) {
  if (!email || !password) throw new Error(`Missing SEED credentials for ${role}. See .env.example.`);
  const [existing] = await query('SELECT user_id FROM `user` WHERE user_email = ?', [email]);
  if (existing) return existing.user_id;
  const result = await query(
    'INSERT INTO `user` (user_first, user_last, user_email, user_password, user_role) VALUES (?, ?, ?, ?, ?)',
    [first, last, email.toLowerCase(), await hashPassword(password), role]
  );
  return result.insertId;
}

const daysFromNow = (days, hour) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

async function seed() {
  await applySchema();

  for (const name of TYPES) await query('INSERT IGNORE INTO `type` (type_name) VALUES (?)', [name]);
  for (const name of GROUPS) await query('INSERT IGNORE INTO `group` (group_name) VALUES (?)', [name]);

  const env = process.env;
  const adminId = await upsertUser({ first: 'Avery', last: 'Admin', email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, role: 'admin' });
  const plannerId = await upsertUser({ first: 'Parker', last: 'Planner', email: env.SEED_PLANNER_EMAIL, password: env.SEED_PLANNER_PASSWORD, role: 'planner' });
  const userId = await upsertUser({ first: 'Jordan', last: 'Member', email: env.SEED_USER_EMAIL, password: env.SEED_USER_PASSWORD, role: 'user' });

  const [{ group_id: staffId }] = await query('SELECT group_id FROM `group` WHERE group_name = ?', ['Staff']);
  await query('INSERT IGNORE INTO user_group (user_id, group_id) VALUES (?, ?), (?, ?)', [adminId, staffId, plannerId, staffId]);

  const [{ n }] = await query('SELECT COUNT(*) AS n FROM event');
  if (n === 0) {
    const typeId = async (name) => (await query('SELECT type_id FROM `type` WHERE type_name = ?', [name]))[0].type_id;
    const insert = async (e) => {
      const result = await query(
        `INSERT INTO event (event_name, event_description, event_location, event_date_start, event_date_end,
                            event_max, event_cost, event_type, event_organizer, event_visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.name, e.description, e.location, e.start, e.end, e.capacity, e.cost, await typeId(e.type), plannerId, e.visibility]
      );
      return result.insertId;
    };

    await insert({ name: 'Annual Community Meetup', description: 'An evening of talks and conversation open to everyone.', location: 'Main Hall', start: daysFromNow(7, 23), end: daysFromNow(8, 2), capacity: 120, cost: 0, type: 'Social', visibility: 'public' });
    await insert({ name: 'Intro to Event Logistics', description: 'Hands-on workshop covering venues, vendors and timelines.', location: 'Room 204', start: daysFromNow(10, 16), end: daysFromNow(10, 19), capacity: 25, cost: 15, type: 'Workshop', visibility: 'public' });
    await insert({ name: 'Charity Volleyball Tournament', description: 'Teams of six. Proceeds go to the local food bank.', location: 'Riverside Courts', start: daysFromNow(14, 15), end: daysFromNow(14, 22), capacity: 48, cost: 10, type: 'Sports', visibility: 'public' });
    const staffEvent = await insert({ name: 'Staff Planning Session', description: 'Quarterly planning. Visible to the Staff group only.', location: 'Board Room', start: daysFromNow(5, 17), end: daysFromNow(5, 19), capacity: 15, cost: 0, type: 'Training', visibility: 'restricted' });
    await query('INSERT INTO event_group (event_id, group_id) VALUES (?, ?)', [staffEvent, staffId]);
    const inviteEvent = await insert({ name: 'Sponsor Dinner', description: 'Invitation only.', location: 'Harbor Restaurant', start: daysFromNow(20, 0), end: daysFromNow(20, 3), capacity: 12, cost: 0, type: 'Networking', visibility: 'restricted' });
    await query('INSERT INTO event_invite (event_id, user_id) VALUES (?, ?)', [inviteEvent, userId]);
  }

  console.log(`Seeded database "${config.db.database}". Sign in with the SEED_* accounts from .env.`);
}

if (require.main === module) {
  seed()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { applySchema };
