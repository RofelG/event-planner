'use strict';

/**
 * Integration tests: real Express app + the isolated <DB_DB>_test MySQL
 * database (created by docker compose). Run `npm run db:up` first.
 */
process.env.NODE_ENV = 'test';
const request = require('supertest');
const app = require('../server/app');
const { pool, query } = require('../server/db/pool');
const { applySchema } = require('../server/db/seed');
const { hashPassword } = require('../server/lib/passwords');

const PASSWORD = 'Test-password-1';
const ids = {};

async function createUser(first, role, email) {
  const r = await query(
    'INSERT INTO `user` (user_first, user_last, user_email, user_password, user_role) VALUES (?, ?, ?, ?, ?)',
    [first, 'Test', email, await hashPassword(PASSWORD), role]
  );
  return r.insertId;
}

/** Returns a supertest agent that keeps the session cookie between requests. */
async function signIn(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return agent;
}

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const eventBody = (over = {}) => ({
  name: 'Test Event',
  location: 'Hall A',
  start: inDays(3),
  end: inDays(3.1),
  capacity: 2,
  cost: 12.5,
  typeId: ids.type,
  ...over,
});

let admin, planner, otherPlanner, member, outsider;

beforeAll(async () => {
  await applySchema();
  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['registration', 'event_invite', 'event_group', 'event', 'user_group', '`group`', '`type`', '`user`']) {
    await query(`TRUNCATE TABLE ${t}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  ids.type = (await query("INSERT INTO `type` (type_name) VALUES ('Workshop')")).insertId;
  ids.group = (await query("INSERT INTO `group` (group_name) VALUES ('Staff')")).insertId;
  ids.admin = await createUser('Admin', 'admin', 'admin@t.test');
  ids.planner = await createUser('Planner', 'planner', 'planner@t.test');
  ids.otherPlanner = await createUser('Other', 'planner', 'other@t.test');
  ids.member = await createUser('Member', 'user', 'member@t.test');
  ids.outsider = await createUser('Outsider', 'user', 'outsider@t.test');
  await query('INSERT INTO user_group (user_id, group_id) VALUES (?, ?)', [ids.member, ids.group]);

  [admin, planner, otherPlanner, member, outsider] = await Promise.all(
    ['admin', 'planner', 'other', 'member', 'outsider'].map((n) => signIn(`${n}@t.test`))
  );
});

afterAll(() => pool.end());

describe('authentication', () => {
  test('register hashes the password, defaults to role user and sets an httpOnly cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ first: 'New', last: 'Person', email: 'NEW@t.test', password: 'Another-pass-9' })
      .expect(201);
    expect(res.body).toMatchObject({ email: 'new@t.test', role: 'user' });
    expect(res.body).not.toHaveProperty('user_password');
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const [row] = await query('SELECT user_password FROM `user` WHERE user_email = ?', ['new@t.test']);
    expect(row.user_password).toMatch(/^\$2[aby]\$/); // bcrypt hash, never plain text
    expect(row.user_password).not.toContain('Another-pass-9');
  });

  test('register cannot self-assign a role (mass assignment)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ first: 'Sneaky', last: 'Person', email: 'sneaky@t.test', password: 'Another-pass-9', role: 'admin' })
      .expect(201);
    expect(res.body.role).toBe('user');
  });

  test('register rejects weak passwords and duplicate emails', async () => {
    const weak = await request(app).post('/api/auth/register').send({ first: 'A', last: 'B', email: 'weak@t.test', password: 'short' }).expect(400);
    expect(weak.body.fields.password).toBeDefined();
    await request(app).post('/api/auth/register').send({ first: 'A', last: 'B', email: 'member@t.test', password: 'Another-pass-9' }).expect(409);
  });

  test('login with a wrong password or unknown email gives the same 401', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'member@t.test', password: 'nope' }).expect(401);
    const b = await request(app).post('/api/auth/login').send({ email: 'ghost@t.test', password: 'nope' }).expect(401);
    expect(a.body.error).toBe(b.body.error);
  });

  test('protected routes require a session', async () => {
    await request(app).get('/api/events').expect(401);
    await request(app).get('/api/auth/me').expect(401);
  });

  test('a forged token is rejected', async () => {
    await request(app).get('/api/events').set('Cookie', 'token=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.').expect(401);
  });

  test('changing the password signs out other sessions', async () => {
    const id = await createUser('Changer', 'user', 'changer@t.test');
    const first = await signIn('changer@t.test');
    const second = await signIn('changer@t.test');
    await first.put('/api/auth/password').send({ current: PASSWORD, password: 'Brand-new-pass-1', confirm: 'Brand-new-pass-1' }).expect(204);
    await first.get('/api/auth/me').expect(200); // this session was re-issued a token
    await second.get('/api/auth/me').expect(401); // the other session is revoked
    expect(id).toBeGreaterThan(0);
  });

  test('non-JSON writes are refused (CSRF defense)', async () => {
    await member.post('/api/events/1/registration').type('form').send('a=b').expect(415);
  });
});

describe('event CRUD and role checks', () => {
  test('regular users cannot create events', async () => {
    await member.post('/api/events').send(eventBody()).expect(403);
  });

  test('planners can create, read, update and delete their events', async () => {
    const created = await planner.post('/api/events').send(eventBody()).expect(201);
    expect(created.headers.location).toBe(`/api/events/${created.body.id}`);
    expect(created.body.permissions).toMatchObject({ edit: true, delete: true });

    const id = created.body.id;
    await planner.get(`/api/events/${id}`).expect(200);
    const updated = await planner.put(`/api/events/${id}`).send(eventBody({ name: 'Renamed' })).expect(200);
    expect(updated.body.name).toBe('Renamed');
    await planner.delete(`/api/events/${id}`).expect(204);
    await planner.get(`/api/events/${id}`).expect(404);

    const [row] = await query('SELECT event_status FROM event WHERE event_id = ?', [id]);
    expect(row.event_status).toBe(-1); // soft delete keeps the row for auditing
  });

  test('validation rejects bad dates, capacity and cost', async () => {
    const res = await planner
      .post('/api/events')
      .send(eventBody({ start: inDays(3), end: inDays(2), capacity: 0, cost: -1 }))
      .expect(400);
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(['capacity', 'cost']));
    const dates = await planner.post('/api/events').send(eventBody({ start: inDays(3), end: inDays(2) })).expect(400);
    expect(dates.body.fields.end).toBeDefined();
  });

  test('organizer cannot be spoofed through the request body', async () => {
    const res = await planner.post('/api/events').send({ ...eventBody(), organizerId: ids.otherPlanner, event_organizer: ids.otherPlanner }).expect(201);
    const [row] = await query('SELECT event_organizer FROM event WHERE event_id = ?', [res.body.id]);
    expect(row.event_organizer).toBe(ids.planner);
  });

  test('members see no edit/delete permission and get 403 on edit/delete', async () => {
    const { body } = await planner.post('/api/events').send(eventBody()).expect(201);
    const seen = await member.get(`/api/events/${body.id}`).expect(200);
    expect(seen.body.permissions).toMatchObject({ edit: false, delete: false, join: true });
    expect(seen.body).not.toHaveProperty('inviteIds');
    await member.put(`/api/events/${body.id}`).send(eventBody()).expect(403);
    await member.delete(`/api/events/${body.id}`).expect(403);
  });

  test('another planner cannot edit or delete an event they do not organize; an admin can', async () => {
    const { body } = await planner.post('/api/events').send(eventBody()).expect(201);
    await otherPlanner.put(`/api/events/${body.id}`).send(eventBody()).expect(403);
    await otherPlanner.delete(`/api/events/${body.id}`).expect(403);
    await admin.put(`/api/events/${body.id}`).send(eventBody({ name: 'Admin edit' })).expect(200);
    await admin.delete(`/api/events/${body.id}`).expect(204);
  });
});

describe('group co-management', () => {
  let volleyball, teammate, teamEvent;

  beforeAll(async () => {
    volleyball = (await admin.post('/api/groups').send({ name: 'Volleyball' }).expect(201)).body.id;
    const teammateId = await createUser('Teammate', 'planner', 'teammate@t.test');
    await admin.put(`/api/users/${ids.planner}`).send({ groupIds: [volleyball] }).expect(204);
    await admin.put(`/api/users/${teammateId}`).send({ groupIds: [volleyball] }).expect(204);
    teammate = await signIn('teammate@t.test');
    teamEvent = (await planner.post('/api/events').send(eventBody({ name: 'Volleyball Night', visibility: 'restricted', groupIds: [volleyball] })).expect(201)).body;
  });

  afterAll(async () => {
    await admin.put(`/api/users/${ids.planner}`).send({ groupIds: [] }).expect(204);
  });

  test('a planner in the event group can edit and sees the manage controls', async () => {
    const seen = await teammate.get(`/api/events/${teamEvent.id}`).expect(200);
    expect(seen.body.permissions).toMatchObject({ edit: true, delete: true });
    const manageable = await teammate.get('/api/events?manageable=true').expect(200);
    expect(manageable.body.map((e) => e.name)).toContain('Volleyball Night');
    await teammate.put(`/api/events/${teamEvent.id}`).send(eventBody({ name: 'Volleyball Night II', visibility: 'restricted', groupIds: [volleyball] })).expect(200);
  });

  test('a planner outside the group cannot edit or delete it', async () => {
    await otherPlanner.put(`/api/events/${teamEvent.id}`).send(eventBody()).expect(404);
    await otherPlanner.delete(`/api/events/${teamEvent.id}`).expect(404);
  });

  test('a regular member of the group can see it but not manage it', async () => {
    await admin.put(`/api/users/${ids.outsider}`).send({ groupIds: [volleyball] }).expect(204);
    const seen = await outsider.get(`/api/events/${teamEvent.id}`).expect(200);
    expect(seen.body.permissions).toMatchObject({ edit: false, delete: false });
    await outsider.delete(`/api/events/${teamEvent.id}`).expect(403);
    await admin.put(`/api/users/${ids.outsider}`).send({ groupIds: [] }).expect(204);
  });

  test('a group teammate can delete it', async () => {
    await teammate.delete(`/api/events/${teamEvent.id}`).expect(204);
  });
});

describe('restricted event visibility', () => {
  let groupEvent, inviteEvent;

  beforeAll(async () => {
    groupEvent = (await planner.post('/api/events').send(eventBody({ name: 'Group only', visibility: 'restricted', groupIds: [ids.group] })).expect(201)).body;
    inviteEvent = (await planner.post('/api/events').send(eventBody({ name: 'Invite only', visibility: 'restricted', inviteIds: [ids.outsider] })).expect(201)).body;
  });

  const names = async (agent) => (await agent.get('/api/events').expect(200)).body.map((e) => e.name);

  test('group members see group events; others do not', async () => {
    expect(await names(member)).toContain('Group only');
    expect(await names(outsider)).not.toContain('Group only');
  });

  test('invited users see invite-only events; others do not', async () => {
    expect(await names(outsider)).toContain('Invite only');
    expect(await names(member)).not.toContain('Invite only');
  });

  test('hidden events return 404 for every sub-resource, so their existence is not leaked', async () => {
    await outsider.get(`/api/events/${groupEvent.id}`).expect(404);
    await outsider.get(`/api/events/${groupEvent.id}/attendees`).expect(404);
    await outsider.post(`/api/events/${groupEvent.id}/registration`).expect(404);
  });

  test('a planner outside the audience cannot see it, the organizer and admin can', async () => {
    expect(await names(otherPlanner)).not.toContain('Invite only');
    expect(await names(planner)).toContain('Invite only');
    expect(await names(admin)).toEqual(expect.arrayContaining(['Group only', 'Invite only']));
  });

  test('removing a user from the group revokes access immediately', async () => {
    await admin.put(`/api/users/${ids.member}`).send({ groupIds: [] }).expect(204);
    await member.get(`/api/events/${groupEvent.id}`).expect(404);
    await admin.put(`/api/users/${ids.member}`).send({ groupIds: [ids.group] }).expect(204);
    await member.get(`/api/events/${groupEvent.id}`).expect(200);
  });

  test('restricted audience details are only shown to managers', async () => {
    const asOrganizer = await planner.get(`/api/events/${inviteEvent.id}`).expect(200);
    expect(asOrganizer.body.inviteIds).toEqual([ids.outsider]);
    const asInvitee = await outsider.get(`/api/events/${inviteEvent.id}`).expect(200);
    expect(asInvitee.body).not.toHaveProperty('inviteIds');
  });
});

describe('registration', () => {
  let event;
  beforeAll(async () => {
    event = (await planner.post('/api/events').send(eventBody({ name: 'Two seats', capacity: 2 })).expect(201)).body;
  });

  test('join, list attendees (names only), and block duplicates', async () => {
    const joined = await member.post(`/api/events/${event.id}/registration`).expect(201);
    expect(joined.body).toMatchObject({ isRegistered: true, attendeeCount: 1, permissions: { join: false, leave: true } });
    await member.post(`/api/events/${event.id}/registration`).expect(409);

    const attendees = await outsider.get(`/api/events/${event.id}/attendees`).expect(200);
    expect(attendees.body).toEqual([{ id: ids.member, name: 'Member Test' }]);
  });

  test('capacity is enforced even under concurrent sign-ups', async () => {
    const results = await Promise.all([
      outsider.post(`/api/events/${event.id}/registration`),
      otherPlanner.post(`/api/events/${event.id}/registration`),
      admin.post(`/api/events/${event.id}/registration`),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM registration WHERE event_id = ?', [event.id]);
    expect(n).toBe(2);
  });

  test('capacity cannot be reduced below current registrations', async () => {
    await planner.put(`/api/events/${event.id}`).send(eventBody({ name: 'Two seats', capacity: 1 })).expect(409);
  });

  test('leave frees the seat', async () => {
    const left = await member.delete(`/api/events/${event.id}/registration`).expect(200);
    expect(left.body).toMatchObject({ isRegistered: false, attendeeCount: 1 });
    await member.delete(`/api/events/${event.id}/registration`).expect(404);
  });
});

describe('admin: users and groups', () => {
  test('only admins can list full user details or change roles', async () => {
    await member.get('/api/users').expect(403);
    const dir = await planner.get('/api/users').expect(200);
    expect(dir.body[0]).not.toHaveProperty('email'); // planners get names only
    const full = await admin.get('/api/users').expect(200);
    expect(full.body[0]).toHaveProperty('email');
    await planner.put(`/api/users/${ids.member}`).send({ role: 'planner' }).expect(403);
  });

  test('promoting a user to planner grants access on the next request', async () => {
    await member.post('/api/events').send(eventBody()).expect(403);
    await admin.put(`/api/users/${ids.member}`).send({ role: 'planner' }).expect(204);
    await member.post('/api/events').send(eventBody()).expect(201);
    await admin.put(`/api/users/${ids.member}`).send({ role: 'user' }).expect(204);
    await member.post('/api/events').send(eventBody()).expect(403);
  });

  test('an admin cannot demote or deactivate themselves', async () => {
    await admin.put(`/api/users/${ids.admin}`).send({ role: 'user' }).expect(400);
    await admin.put(`/api/users/${ids.admin}`).send({ active: false }).expect(400);
  });

  test('deactivating a user ends their session', async () => {
    const id = await createUser('Leaving', 'user', 'leaving@t.test');
    const agent = await signIn('leaving@t.test');
    await admin.put(`/api/users/${id}`).send({ active: false }).expect(204);
    await agent.get('/api/events').expect(401);
  });

  test('group CRUD is admin-only', async () => {
    await planner.post('/api/groups').send({ name: 'Nope' }).expect(403);
    const g = await admin.post('/api/groups').send({ name: 'Volunteers' }).expect(201);
    await admin.post('/api/groups').send({ name: 'Volunteers' }).expect(409);
    await admin.put(`/api/groups/${g.body.id}`).send({ name: 'Helpers' }).expect(200);
    await admin.delete(`/api/groups/${g.body.id}`).expect(204);
    await admin.delete(`/api/groups/${g.body.id}`).expect(404);
  });
});

describe('catalogue pagination', () => {
  beforeAll(async () => {
    // A mix of visible and hidden events, several sharing one start time so
    // the (start, id) tie-break is exercised.
    const sameStart = inDays(9);
    for (let i = 0; i < 4; i += 1) {
      await planner.post('/api/events').send(eventBody({ name: `Paged ${i}`, start: sameStart, end: inDays(9.1) })).expect(201);
    }
    for (let i = 0; i < 3; i += 1) {
      await planner
        .post('/api/events')
        .send(eventBody({ name: `Paged hidden ${i}`, start: sameStart, end: inDays(9.1), visibility: 'restricted', groupIds: [ids.group] }))
        .expect(201);
    }
  });

  /** Follows nextCursor until the end and returns every id, in order. */
  async function readAll(agent, query = '') {
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 50; page += 1) {
      const url = `/api/events?limit=2${query}${cursor ? `&cursor=${cursor}` : ''}`;
      const { body } = await agent.get(url).expect(200);
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(...body.items.map((e) => e.id));
      if (!body.nextCursor) return seen;
      cursor = body.nextCursor;
    }
    throw new Error('Pagination did not finish');
  }

  test('pages cover exactly the unpaged list, in order, with no repeats', async () => {
    for (const agent of [outsider, member, admin]) {
      const all = (await agent.get('/api/events').expect(200)).body.map((e) => e.id);
      expect(await readAll(agent)).toEqual(all);
    }
  });

  test('hidden events never appear on any page', async () => {
    const ids_ = await readAll(outsider);
    const { body } = await admin.get('/api/events').expect(200);
    const hidden = body.filter((e) => e.name.startsWith('Paged hidden')).map((e) => e.id);
    expect(hidden.length).toBe(3);
    expect(ids_.some((id) => hidden.includes(id))).toBe(false);
  });

  test('filters apply to pages, including mine=true', async () => {
    const all = (await member.get('/api/events?q=Paged').expect(200)).body.map((e) => e.id);
    expect(await readAll(member, '&q=Paged')).toEqual(all);

    const target = all[0];
    await member.post(`/api/events/${target}/registration`).expect(201);
    expect(await readAll(member, '&mine=true')).toContain(target);
    const mine = (await member.get('/api/events?limit=50&mine=true').expect(200)).body.items;
    expect(mine.every((e) => e.isRegistered)).toBe(true);
  });

  test('a malformed cursor is rejected', async () => {
    await member.get('/api/events?limit=2&cursor=not-a-cursor').expect(400);
  });

  test('demo endpoints report demo mode off and refuse guests', async () => {
    const { body } = await request(app).get('/api/demo').expect(200);
    expect(body).toEqual({ enabled: false, ttlHours: null });
    await request(app).post('/api/demo/guest').send({ name: 'Visitor' }).expect(404);
    // Without demo mode the catalogue still requires a session.
    await request(app).get('/api/events').expect(401);
  });
});
