'use strict';

/**
 * Demo mode runtime (DEMO_MODE=true), started by server/index.js:
 *   - showcase:   dozens of public events, topped up as they end
 *   - simulation: simulated attendees join and leave showcase events every
 *                 second or so (2-3 changes a second), pushed over the live stream
 *   - cleanup:    guest events, guests and their sign-ups are removed after
 *                 DEMO_EVENT_TTL_HOURS
 */
const config = require('../config');
const live = require('../lib/live');
const logger = require('../lib/logger');
const events = require('../repositories/events');
const { query } = require('../db/pool');
const { ensureShowcase } = require('./showcase');

const TICK_MIN_MS = 600;
const TICK_MAX_MS = 1400;
const MAINTENANCE_MS = 10 * 60 * 1000;
// A few "hot" events get extra attention so they visibly sell out.
const HOT_COUNT = 5;

let state = { hostId: null, botIds: [], botSet: new Set(), eventIds: [], hot: [] };
let tickTimer = null;
let maintenanceTimer = null;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function refreshEvents() {
  const rows = await query(
    'SELECT event_id FROM event WHERE event_organizer = ? AND event_status = 1 AND event_date_end > UTC_TIMESTAMP()',
    [state.hostId]
  );
  state.eventIds = rows.map((r) => r.event_id);
  state.hot = [...state.eventIds].sort(() => Math.random() - 0.5).slice(0, HOT_COUNT);
}

/** One simulated sign-up or cancellation on one showcase event. */
async function simulateOne() {
  const eventId = Math.random() < 0.35 && state.hot.length ? pick(state.hot) : pick(state.eventIds);
  if (!eventId) return;
  const [event] = await query(
    'SELECT event_max, (SELECT COUNT(*) FROM registration r WHERE r.event_id = ?) AS taken FROM event WHERE event_id = ? AND event_status = 1',
    [eventId, eventId]
  );
  if (!event) return;
  const registered = (await query('SELECT user_id FROM registration WHERE event_id = ?', [eventId]))
    .map((r) => r.user_id)
    .filter((id) => state.botSet.has(id));
  const fill = Number(event.taken) / event.event_max;
  const hot = state.hot.includes(eventId);
  // Mostly joins while there is room (more so for hot events); mostly leaves when full.
  const joinChance = fill >= 1 ? 0.1 : hot ? 0.9 : 0.65;

  if (Math.random() < joinChance) {
    const taken = new Set(registered);
    const free = state.botIds.filter((id) => !taken.has(id));
    if (!free.length) return;
    try {
      await events.register(eventId, pick(free));
    } catch {
      return; // full or ended in the meantime: skip this tick
    }
  } else {
    if (!registered.length) return;
    await events.unregister(eventId, pick(registered));
  }
  await live.eventChanged(eventId);
}

async function tick() {
  try {
    const actions = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < actions; i += 1) await simulateOne();
  } catch (err) {
    logger.error({ err }, 'Demo simulation failed');
  }
  tickTimer = setTimeout(tick, TICK_MIN_MS + Math.random() * (TICK_MAX_MS - TICK_MIN_MS));
}

/**
 * Removes guest events older than the TTL, then the guests themselves and
 * their sign-ups, telling open catalogues about each change.
 */
async function cleanup() {
  const { ttlHours } = config.demo;
  for (const event of await events.expireGuestEvents(ttlHours)) {
    await live.eventChanged(event.id, event);
  }

  const guests = await query(
    `SELECT user_id FROM \`user\`
      WHERE user_email LIKE 'guest-%@demo.invalid' AND user_status = 1
        AND created_at < NOW() - INTERVAL ? HOUR`,
    [ttlHours]
  );
  if (!guests.length) return;
  const ids = guests.map((g) => g.user_id);
  const affected = await query('SELECT DISTINCT event_id FROM registration WHERE user_id IN (?)', [ids]);
  await query('DELETE FROM registration WHERE user_id IN (?)', [ids]);
  // Deactivating (and bumping token_version) ends any session they still hold.
  await query('UPDATE `user` SET user_status = 0, token_version = token_version + 1 WHERE user_id IN (?)', [ids]);
  for (const { event_id: eventId } of affected) await live.eventChanged(eventId);
}

async function maintain() {
  try {
    await cleanup();
    const { created } = await ensureShowcase();
    for (const id of created) await live.eventChanged(id);
    await refreshEvents();
  } catch (err) {
    logger.error({ err }, 'Demo maintenance failed');
  }
}

async function start() {
  const showcase = await ensureShowcase();
  state = { ...state, hostId: showcase.hostId, botIds: showcase.botIds, botSet: new Set(showcase.botIds) };
  await refreshEvents();
  await cleanup();
  maintenanceTimer = setInterval(maintain, MAINTENANCE_MS);
  if (config.demo.simulate) tick();
  logger.info(
    {
      showcaseEvents: state.eventIds.length,
      simulatedAttendees: state.botIds.length,
      simulate: config.demo.simulate,
      ttlHours: config.demo.ttlHours,
    },
    'Demo mode started'
  );
}

function stop() {
  clearTimeout(tickTimer);
  clearInterval(maintenanceTimer);
}

module.exports = { start, stop, cleanup, maintain };
