'use strict';

const express = require('express');
const events = require('../repositories/events');
const groups = require('../repositories/groups');
const users = require('../repositories/users');
const schemas = require('../schemas');
const policy = require('../lib/policy');
const live = require('../lib/live');
const { serializeEvent: serialize } = require('../lib/serialize');
const { validate } = require('../middleware/validate');
const { requireUser } = require('../middleware/auth');
const ical = require('../lib/ical');
const { encodeCursor, positionOf } = require('../lib/cursor');
const config = require('../config');
const { notFound, forbidden, badRequest, HttpError } = require('../lib/errors');

const router = express.Router();

// Demo mode: how many events a non-planner may create per hour.
const DEMO_CREATE_PER_HOUR = 5;

/** Non-planners (demo guests) may only create public events. */
function checkAudience(user, data) {
  if (policy.canRestrictEvent(user)) return;
  if (data.visibility !== 'public' || data.groupIds.length || data.inviteIds.length) {
    throw badRequest('Please correct the highlighted fields.', { visibility: 'Only planners can restrict who sees an event' });
  }
}

/** Loads an event the user may see, or responds 404 (never 403, to avoid leaking existence). */
async function loadVisible(req) {
  const event = await events.findById(req.user.id, req.valid.params.id);
  if (!event || !policy.canViewEvent(req.user, event)) throw notFound('Event not found');
  return event;
}

async function checkReferences(data) {
  const fields = {};
  if (!(await events.typeExists(data.typeId))) fields.typeId = 'Choose a valid event type';
  const knownGroups = await groups.existingIds(data.groupIds);
  if (knownGroups.length !== data.groupIds.length) fields.groupIds = 'One or more groups do not exist';
  for (const uid of data.inviteIds) {
    if (!(await users.exists(uid))) {
      fields.inviteIds = 'One or more invited users do not exist';
      break;
    }
  }
  if (Object.keys(fields).length) throw badRequest('Please correct the highlighted fields.', fields);
}

// GET /api/events - catalogue, filtered to events the caller may see.
// Without `limit`: every matching event, as an array.
// With `limit` (and `cursor` from the previous page): { items, nextCursor }.
router.get('/', validate(schemas.eventQuery, 'query'), async (req, res) => {
  const { type, q, past, manageable, mine, limit, cursor } = req.valid.query;
  const filters = { includePast: past, typeId: type, search: q, mine };
  const allowed = (e) => policy.canViewEvent(req.user, e) && (!manageable || policy.canManageEvent(req.user, e));

  if (!limit) {
    const all = await events.list(req.user.id, filters);
    return res.json(all.filter(allowed).map((e) => serialize(req.user, e)));
  }

  // Access rules run in JavaScript (policy.js), so a database batch can contain
  // events this user cannot see. Keep reading batches until the page is full or
  // the rows run out. `after` is the position of the last row read (visible or
  // not), so the next page continues right after it and never repeats a row.
  const items = [];
  const batchSize = limit * 2;
  let after = cursor;
  let rowsLeft = true;
  while (items.length < limit && rowsLeft) {
    const batch = await events.list(req.user.id, { ...filters, after, limit: batchSize });
    let read = 0;
    for (const event of batch) {
      read += 1;
      after = positionOf(event);
      if (allowed(event)) items.push(event);
      if (items.length === limit) break;
    }
    // Rows remain if the batch was full, or if the page filled before the batch ended.
    rowsLeft = batch.length === batchSize || read < batch.length;
  }
  res.json({
    items: items.map((e) => serialize(req.user, e)),
    nextCursor: rowsLeft ? encodeCursor(after) : null,
  });
});

// GET /api/events/:id
router.get('/:id', validate(schemas.idParam, 'params'), async (req, res) => {
  res.json(serialize(req.user, await loadVisible(req)));
});

// GET /api/events/:id/calendar.ics - single-event iCalendar download.
router.get('/:id/calendar.ics', validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  res
    .type('text/calendar; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${ical.safeFilename(event.name)}"`)
    .send(ical.buildEventCalendar(event));
});

// POST /api/events - planners and admins; in demo mode, any signed-in user.
router.post('/', requireUser, validate(schemas.event), async (req, res) => {
  if (!policy.canCreateEvent(req.user)) throw forbidden();
  const data = req.valid.body;
  if (data.end <= new Date()) throw badRequest('Please correct the highlighted fields.', { end: 'End must be in the future' });
  checkAudience(req.user, data);
  if (config.demo.enabled && !policy.isPlanner(req.user)) {
    if ((await events.countCreatedSince(req.user.id, 1)) >= DEMO_CREATE_PER_HOUR) {
      throw new HttpError(429, `You can create up to ${DEMO_CREATE_PER_HOUR} events an hour in the demo.`);
    }
  }
  await checkReferences(data);
  const created = await events.create(req.user.id, data);
  live.eventChanged(created.id);
  res.status(201).location(`/api/events/${created.id}`).json(serialize(req.user, created));
});

// PUT /api/events/:id - full replacement; see policy.canManageEvent.
router.put('/:id', requireUser, validate(schemas.idParam, 'params'), validate(schemas.event), async (req, res) => {
  const event = await loadVisible(req);
  if (!policy.canManageEvent(req.user, event)) throw forbidden('Only the organizer, a planner in a group it is shared with, or an admin can edit this event.');
  checkAudience(req.user, req.valid.body);
  await checkReferences(req.valid.body);
  const updated = await events.update(event.id, req.user.id, req.valid.body);
  live.eventChanged(event.id, event);
  res.json(serialize(req.user, updated));
});

// DELETE /api/events/:id - soft delete; see policy.canManageEvent.
router.delete('/:id', requireUser, validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  if (!policy.canManageEvent(req.user, event)) throw forbidden('Only the organizer, a planner in a group it is shared with, or an admin can delete this event.');
  await events.softDelete(event.id);
  live.eventChanged(event.id, event);
  res.status(204).end();
});

// GET /api/events/:id/attendees - names of registered users (no emails).
router.get('/:id/attendees', validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  const rows = await events.attendees(event.id);
  // Demo guests have a single name, so trim the empty last name.
  res.json(rows.map((r) => ({ id: r.user_id, name: `${r.user_first} ${r.user_last}`.trim() })));
});

// POST /api/events/:id/registration - join the event.
router.post('/:id/registration', requireUser, validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  await events.register(event.id, req.user.id);
  live.eventChanged(event.id, event);
  res.status(201).json(serialize(req.user, await events.findById(req.user.id, event.id)));
});

// DELETE /api/events/:id/registration - leave the event.
router.delete('/:id/registration', requireUser, validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  if (!(await events.unregister(event.id, req.user.id))) throw notFound('You are not registered for this event.');
  live.eventChanged(event.id, event);
  res.json(serialize(req.user, await events.findById(req.user.id, event.id)));
});

module.exports = router;
