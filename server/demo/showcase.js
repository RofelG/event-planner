'use strict';

/**
 * Demo showcase data: a host account, simulated attendees ("bots") and a
 * rolling set of public events. Everything is idempotent and only adds rows:
 * it never changes or removes real users or events.
 */
const { query } = require('../db/pool');
const { HOST_EMAIL, botEmail, guestPasswordHash } = require('./accounts');

const TYPES = ['Conference', 'Workshop', 'Social', 'Sports', 'Networking', 'Training'];

// How many upcoming showcase events to keep, and how many simulated attendees.
const SHOWCASE_TARGET = 48;
const BOT_COUNT = 160;

const FIRST = ['Ava', 'Ben', 'Chloe', 'Daniel', 'Elena', 'Felix', 'Grace', 'Hugo', 'Isla', 'Jonah',
  'Kira', 'Liam', 'Maya', 'Noah', 'Olivia', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tara'];
const LAST = ['Adams', 'Brooks', 'Chen', 'Diaz', 'Evans', 'Fischer', 'Garcia', 'Hughes'];

// [name, type, location, description, capacity, cost]
const TEMPLATES = [
  ['Product Design Summit', 'Conference', 'Grand Hall', 'Talks from design leads on research, systems and accessibility.', 200, 49],
  ['Cloud Infrastructure Day', 'Conference', 'Auditorium A', 'Case studies on scaling, cost and reliability.', 150, 39],
  ['Future of Work Forum', 'Conference', 'Civic Center', 'Panels on hybrid teams and the four-day week.', 120, 25],
  ['Data and AI Conference', 'Conference', 'Convention Center', 'Practical sessions on models, data quality and evaluation.', 180, 59],
  ['Intro to Watercolor', 'Workshop', 'Studio 3', 'All materials provided. No experience needed.', 16, 30],
  ['Public Speaking Lab', 'Workshop', 'Room 204', 'Short talks, kind feedback, real progress.', 20, 15],
  ['Sourdough Basics', 'Workshop', 'Community Kitchen', 'Mix, fold and bake your first loaf.', 12, 25],
  ['Accessible Web Forms', 'Workshop', 'Lab 1', 'Hands-on session on labels, errors and keyboard use.', 24, 0],
  ['Pottery Wheel Night', 'Workshop', 'Clay Studio', 'Throw a bowl and glaze it next week.', 10, 40],
  ['Rooftop Summer Social', 'Social', 'Rooftop Terrace', 'Music, snacks and city views.', 80, 0],
  ['Board Game Evening', 'Social', 'The Common Room', 'Bring a game or learn a new one.', 40, 0],
  ['Trivia Night', 'Social', 'Corner Pub', 'Teams of up to six. Prizes for the top three.', 60, 5],
  ['Film Club: Classics', 'Social', 'Screening Room', 'Screening followed by a short discussion.', 45, 0],
  ['Neighborhood Picnic', 'Social', 'Riverside Park', 'Bring a blanket; we bring the lemonade.', 100, 0],
  ['5K Fun Run', 'Sports', 'Lakeside Trail', 'All paces welcome. Water stations on the route.', 150, 10],
  ['Beach Volleyball Open', 'Sports', 'North Beach Courts', 'Mixed teams of four.', 48, 12],
  ['Sunrise Yoga', 'Sports', 'Harbor Lawn', 'Gentle flow for every level. Bring a mat.', 30, 0],
  ['Climbing Gym Intro', 'Sports', 'Boulder Hub', 'Shoes and coaching included.', 18, 20],
  ['Five-a-side Football', 'Sports', 'Field 2', 'Round robin, then finals.', 40, 6],
  ['Founders Breakfast', 'Networking', 'Cafe Aurora', 'Coffee and introductions for early-stage founders.', 30, 15],
  ['Women in Tech Mixer', 'Networking', 'Skyline Lounge', 'An evening of conversation and mentoring.', 70, 0],
  ['Freelancers Meetup', 'Networking', 'Co-work Space', 'Share leads, rates and lessons learned.', 50, 0],
  ['Career Switchers Night', 'Networking', 'Library Hall', 'Stories and advice from people who changed fields.', 60, 0],
  ['First Aid Certification', 'Training', 'Training Room B', 'Accredited one-day course with a certificate.', 20, 65],
  ['Leadership Essentials', 'Training', 'Board Room', 'Feedback, delegation and running good meetings.', 24, 45],
  ['Excel for Analysts', 'Training', 'Lab 2', 'Pivot tables, lookups and clean charts.', 28, 35],
  ['Event Safety Briefing', 'Training', 'Main Hall', 'Required for volunteers working the summer events.', 90, 0],
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function ensureUser(email, first, last, role) {
  const [existing] = await query('SELECT user_id FROM `user` WHERE user_email = ?', [email]);
  if (existing) return existing.user_id;
  const result = await query(
    'INSERT INTO `user` (user_first, user_last, user_email, user_password, user_role) VALUES (?, ?, ?, ?, ?)',
    [first, last, email, await guestPasswordHash(), role]
  );
  return result.insertId;
}

/** Ids of the simulated attendees, creating any that are missing. */
async function ensureBots() {
  const rows = await query("SELECT user_id FROM `user` WHERE user_email LIKE 'bot-%@demo.invalid' AND user_status = 1");
  if (rows.length >= BOT_COUNT) return rows.map((r) => r.user_id);
  const hash = await guestPasswordHash();
  const values = [];
  for (let n = 1; n <= BOT_COUNT; n += 1) {
    const first = FIRST[(n - 1) % FIRST.length];
    const last = LAST[Math.floor((n - 1) / FIRST.length) % LAST.length];
    values.push([first, last, botEmail(n), hash, 'user']);
  }
  await query('INSERT IGNORE INTO `user` (user_first, user_last, user_email, user_password, user_role) VALUES ?', [values]);
  const all = await query("SELECT user_id FROM `user` WHERE user_email LIKE 'bot-%@demo.invalid' AND user_status = 1");
  return all.map((r) => r.user_id);
}

/** Starts between 2 hours and 30 days from now, on the hour. */
function randomStart() {
  const d = new Date(Date.now() + (2 + Math.random() * 718) * 3600 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/**
 * Tops the showcase back up to SHOWCASE_TARGET upcoming events (events end and
 * drop out over time), with some attendees already registered. Returns the ids
 * of events it created.
 */
async function topUpEvents(hostId, botIds) {
  const [{ n }] = await query(
    'SELECT COUNT(*) AS n FROM event WHERE event_organizer = ? AND event_status = 1 AND event_date_end > UTC_TIMESTAMP()',
    [hostId]
  );
  const missing = SHOWCASE_TARGET - Number(n);
  if (missing <= 0) return [];

  const typeRows = await query('SELECT type_id, type_name FROM `type`');
  const typeId = Object.fromEntries(typeRows.map((t) => [t.type_name, t.type_id]));
  const created = [];
  for (let i = 0; i < missing; i += 1) {
    const [name, type, location, description, capacity, cost] = pick(TEMPLATES);
    const start = randomStart();
    const end = new Date(start.getTime() + (2 + Math.floor(Math.random() * 4)) * 3600 * 1000);
    const result = await query(
      `INSERT INTO event (event_name, event_description, event_location, event_date_start, event_date_end,
                          event_max, event_cost, event_type, event_visibility, event_organizer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?)`,
      [name, description, location, start, end, capacity, cost, typeId[type], hostId]
    );
    // Start somewhere between empty and nearly full, so some events look busy.
    const seats = Math.min(capacity, botIds.length);
    const taken = Math.floor(seats * Math.random() * 0.85);
    const attendees = [...botIds].sort(() => Math.random() - 0.5).slice(0, taken);
    if (attendees.length) {
      await query('INSERT IGNORE INTO registration (event_id, user_id) VALUES ?', [attendees.map((u) => [result.insertId, u])]);
    }
    created.push(result.insertId);
  }
  return created;
}

/** Makes sure every piece of demo data exists. Returns { hostId, botIds, created }. */
async function ensureShowcase() {
  for (const name of TYPES) await query('INSERT IGNORE INTO `type` (type_name) VALUES (?)', [name]);
  const hostId = await ensureUser(HOST_EMAIL, 'Demo', 'Host', 'planner');
  const botIds = await ensureBots();
  const created = await topUpEvents(hostId, botIds);
  return { hostId, botIds, created };
}

module.exports = { ensureShowcase, SHOWCASE_TARGET, BOT_COUNT };
