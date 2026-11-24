'use strict';

const express = require('express');
const events = require('../repositories/events');
const groups = require('../repositories/groups');
const users = require('../repositories/users');
const schemas = require('../schemas');
const policy = require('../lib/policy');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { notFound, forbidden, badRequest } = require('../lib/errors');

const router = express.Router();
const planner = requireRole('planner', 'admin');

/** Client-facing shape. Audience details are only shown to people who manage the event. */
function serialize(user, event) {
  const permissions = policy.eventPermissions(user, event);
  const { organizerId, groupIds, inviteIds, ...rest } = event;
  return {
    ...rest,
    isFull: event.attendeeCount >= event.capacity,
    ...(permissions.edit ? { groupIds, inviteIds } : {}),
    permissions,
  };
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
router.get('/', validate(schemas.eventQuery, 'query'), async (req, res) => {
  const { type, q, past, manageable } = req.valid.query;
  const all = await events.list(req.user.id, { includePast: past, typeId: type, search: q });
  let visible = all.filter((e) => policy.canViewEvent(req.user, e));
  if (manageable) visible = visible.filter((e) => policy.canManageEvent(req.user, e));
  res.json(visible.map((e) => serialize(req.user, e)));
});

// GET /api/events/:id
router.get('/:id', validate(schemas.idParam, 'params'), async (req, res) => {
  res.json(serialize(req.user, await loadVisible(req)));
});

// POST /api/events - planners and admins only.
router.post('/', planner, validate(schemas.event), async (req, res) => {
  const data = req.valid.body;
  if (data.end <= new Date()) throw badRequest('Please correct the highlighted fields.', { end: 'End must be in the future' });
  await checkReferences(data);
  const created = await events.create(req.user.id, data);
  res.status(201).location(`/api/events/${created.id}`).json(serialize(req.user, created));
});

// PUT /api/events/:id - full replacement; organizer (planner) or admin only.
router.put('/:id', planner, validate(schemas.idParam, 'params'), validate(schemas.event), async (req, res) => {
  const event = await loadVisible(req);
  if (!policy.canManageEvent(req.user, event)) throw forbidden('Only the organizer, a planner in a group it is shared with, or an admin can edit this event.');
  await checkReferences(req.valid.body);
  const updated = await events.update(event.id, req.user.id, req.valid.body);
  res.json(serialize(req.user, updated));
});

// DELETE /api/events/:id - soft delete; organizer (planner) or admin only.
router.delete('/:id', planner, validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  if (!policy.canManageEvent(req.user, event)) throw forbidden('Only the organizer, a planner in a group it is shared with, or an admin can delete this event.');
  await events.softDelete(event.id);
  res.status(204).end();
});

// GET /api/events/:id/attendees - names of registered users (no emails).
router.get('/:id/attendees', validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  const rows = await events.attendees(event.id);
  res.json(rows.map((r) => ({ id: r.user_id, name: `${r.user_first} ${r.user_last}` })));
});

// POST /api/events/:id/registration - join the event.
router.post('/:id/registration', validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  await events.register(event.id, req.user.id);
  res.status(201).json(serialize(req.user, await events.findById(req.user.id, event.id)));
});

// DELETE /api/events/:id/registration - leave the event.
router.delete('/:id/registration', validate(schemas.idParam, 'params'), async (req, res) => {
  const event = await loadVisible(req);
  if (!(await events.unregister(event.id, req.user.id))) throw notFound('You are not registered for this event.');
  res.json(serialize(req.user, await events.findById(req.user.id, event.id)));
});

module.exports = router;
