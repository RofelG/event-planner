'use strict';

const express = require('express');
const users = require('../repositories/users');
const groups = require('../repositories/groups');
const events = require('../repositories/events');
const schemas = require('../schemas');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { notFound, conflict, badRequest } = require('../lib/errors');

const planner = requireRole('planner', 'admin');
const admin = requireRole('admin');
const parseIds = (v) => (v == null ? [] : (typeof v === 'string' ? JSON.parse(v) : v).map(Number));

/* ----------------------------- /api/types ----------------------------- */
const types = express.Router();

types.get('/', async (req, res) => {
  const rows = await events.types();
  res.json(rows.map((t) => ({ id: t.type_id, name: t.type_name })));
});

/* ----------------------------- /api/users ----------------------------- */
const usersRouter = express.Router();

// Planners get a name directory for choosing invitees; admins also get email,
// role, status and groups for the Users page.
usersRouter.get('/', planner, async (req, res) => {
  if (req.user.role !== 'admin') {
    const rows = await users.directory();
    return res.json(rows.map((u) => ({ id: u.user_id, name: `${u.user_first} ${u.user_last}` })));
  }
  const rows = await users.listWithGroups();
  res.json(
    rows.map((u) => ({
      id: u.user_id,
      name: `${u.user_first} ${u.user_last}`,
      email: u.user_email,
      role: u.user_role,
      active: u.user_status === 1,
      groupIds: parseIds(u.group_ids),
    }))
  );
});

// PUT /api/users/:id - admin changes role, active flag and group membership.
usersRouter.put('/:id', admin, validate(schemas.idParam, 'params'), validate(schemas.userUpdate), async (req, res) => {
  const id = req.valid.params.id;
  const body = req.valid.body;
  if (!(await users.exists(id))) throw notFound('User not found');
  // Prevent an admin from locking themselves (and possibly everyone) out.
  if (id === req.user.id && ((body.role && body.role !== 'admin') || body.active === false)) {
    throw badRequest('You cannot remove your own admin role or deactivate yourself.');
  }
  if (body.groupIds) {
    const known = await groups.existingIds(body.groupIds);
    if (known.length !== body.groupIds.length) {
      throw badRequest('Please correct the highlighted fields.', { groupIds: 'One or more groups do not exist' });
    }
  }
  await users.adminUpdate(id, body);
  res.status(204).end();
});

/* ----------------------------- /api/groups ---------------------------- */
const groupsRouter = express.Router();

const groupJson = (g) => ({ id: g.group_id, name: g.group_name, memberCount: Number(g.member_count ?? 0) });

groupsRouter.get('/', planner, async (req, res) => {
  res.json((await groups.list()).map(groupJson));
});

groupsRouter.post('/', admin, validate(schemas.group), async (req, res) => {
  if (await groups.findByName(req.valid.body.name)) throw conflict('A group with this name already exists.');
  const created = await groups.create(req.valid.body.name);
  res.status(201).location(`/api/groups/${created.group_id}`).json(groupJson(created));
});

groupsRouter.put('/:id', admin, validate(schemas.idParam, 'params'), validate(schemas.group), async (req, res) => {
  const { id } = req.valid.params;
  if (!(await groups.findById(id))) throw notFound('Group not found');
  const clash = await groups.findByName(req.valid.body.name);
  if (clash && clash.group_id !== id) throw conflict('A group with this name already exists.');
  res.json(groupJson(await groups.rename(id, req.valid.body.name)));
});

groupsRouter.delete('/:id', admin, validate(schemas.idParam, 'params'), async (req, res) => {
  if (!(await groups.remove(req.valid.params.id))) throw notFound('Group not found');
  res.status(204).end();
});

module.exports = { types, users: usersRouter, groups: groupsRouter };
