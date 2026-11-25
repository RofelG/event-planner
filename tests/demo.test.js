'use strict';

/**
 * Demo mode (DEMO_MODE=true). Jest gives each test file its own module
 * registry, so setting the variables here before loading the app turns demo
 * mode on for this file only.
 */
process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'true';
process.env.DEMO_EVENT_TTL_HOURS = '48';

const http = require('http');
const request = require('supertest');
const app = require('../server/app');
const demo = require('../server/demo');
const { ensureShowcase, SHOWCASE_TARGET, BOT_COUNT } = require('../server/demo/showcase');
const { pool, query } = require('../server/db/pool');
const { applySchema } = require('../server/db/seed');
const { hashPassword } = require('../server/lib/passwords');

const PASSWORD = 'Test-password-1';
const ids = {};
let planner, member, admin;

async function createUser(first, role, email) {
  const r = await query(
    'INSERT INTO `user` (user_first, user_last, user_email, user_password, user_role) VALUES (?, ?, ?, ?, ?)',
    [first, 'Test', email, await hashPassword(PASSWORD), role]
  );
  return r.insertId;
}

async function signIn(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return agent;
}

/** A visitor who gives a name: returns { agent, user, cookie }. */
async function becomeGuest(name) {
  const agent = request.agent(app);
  const res = await agent.post('/api/demo/guest').send({ name }).expect(201);
  return { agent, user: res.body, cookie: res.headers['set-cookie'][0] };
}

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const eventBody = (over = {}) => ({
  name: 'Demo Test Event',
  location: 'Hall C',
  start: inDays(4),
  end: inDays(4.1),
  capacity: 10,
  cost: 0,
  typeId: ids.type,
  ...over,
});

beforeAll(async () => {
  await applySchema();
  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['registration', 'event_invite', 'event_group', 'event', 'user_group', '`group`', '`type`', '`user`']) {
    await query(`TRUNCATE TABLE ${t}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  ids.type = (await query("INSERT INTO `type` (type_name) VALUES ('Workshop')")).insertId;
  ids.group = (await query("INSERT INTO `group` (group_name) VALUES ('Staff')")).insertId;
  ids.planner = await createUser('Planner', 'planner', 'planner@demo.test');
  ids.member = await createUser('Member', 'user', 'member@demo.test');
  ids.admin = await createUser('Admin', 'admin', 'admin@demo.test');
  [planner, member, admin] = await Promise.all(['planner', 'member', 'admin'].map((n) => signIn(`${n}@demo.test`)));

  ids.public = (await planner.post('/api/events').send(eventBody({ name: 'Open Day' })).expect(201)).body.id;
  ids.hidden = (
    await planner.post('/api/events').send(eventBody({ name: 'Staff Only', visibility: 'restricted', groupIds: [ids.group] })).expect(201)
  ).body.id;
});

afterAll(() => pool.end());

describe('demo settings', () => {
  test('the client can read that demo mode is on', async () => {
    const { body } = await request(app).get('/api/demo').expect(200);
    expect(body).toEqual({ enabled: true, ttlHours: 48 });
  });
});

describe('visitors (no session)', () => {
  const visitor = () => request(app);

  test('see public events only', async () => {
    const { body } = await visitor().get('/api/events').expect(200);
    const names = body.map((e) => e.name);
    expect(names).toContain('Open Day');
    expect(names).not.toContain('Staff Only');
    await visitor().get(`/api/events/${ids.hidden}`).expect(404);
    await visitor().get(`/api/events/${ids.public}/attendees`).expect(200);
    await visitor().get('/api/types').expect(200);
  });

  test('see no edit controls, and may be offered Join', async () => {
    const { body } = await visitor().get(`/api/events/${ids.public}`).expect(200);
    expect(body.permissions).toEqual({ edit: false, delete: false, join: true, leave: false });
    expect(body).not.toHaveProperty('groupIds');
  });

  test('cannot change anything or read the user and group lists', async () => {
    await visitor().post(`/api/events/${ids.public}/registration`).expect(401);
    await visitor().post('/api/events').send(eventBody()).expect(401);
    await visitor().put(`/api/events/${ids.public}`).send(eventBody()).expect(401);
    await visitor().delete(`/api/events/${ids.public}`).expect(401);
    await visitor().get('/api/users').expect(401);
    await visitor().get('/api/groups').expect(401);
    await visitor().get('/api/auth/me').expect(401);
  });

  test('can open the live stream', async () => {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const status = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${server.address().port}/api/events/stream`, (res) => {
        resolve(res.statusCode);
        req.destroy();
      });
      req.on('error', (err) => (err.code === 'ECONNRESET' ? undefined : reject(err)));
    });
    require('../server/lib/live').closeAll();
    await new Promise((r) => server.close(r));
    expect(status).toBe(200);
  });
});

describe('guests (a visitor who gave a name)', () => {
  test('names are validated', async () => {
    await request(app).post('/api/demo/guest').send({ name: '' }).expect(400);
    await request(app).post('/api/demo/guest').send({ name: '<script>' }).expect(400);
    await request(app).post('/api/demo/guest').send({ name: 'x'.repeat(61) }).expect(400);
  });

  test('get a session that lasts as long as the guest, with no password to manage', async () => {
    const { agent, user, cookie } = await becomeGuest("Zoë O'Neil");
    expect(user).toMatchObject({ first: "Zoë O'Neil", role: 'user', isGuest: true });
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Max-Age=172800/);
    const me = (await agent.get('/api/auth/me').expect(200)).body;
    expect(me.isGuest).toBe(true);
    // Guests cannot sign in with a password: their email and secret are random.
    expect(user.email).toMatch(/^guest-[0-9a-f]+@demo\.invalid$/);
  });

  test('can join and leave, and appear by name in the attendee list', async () => {
    const { agent } = await becomeGuest('Robin Lake');
    await agent.post(`/api/events/${ids.public}/registration`).expect(201);
    const names = (await request(app).get(`/api/events/${ids.public}/attendees`).expect(200)).body.map((a) => a.name);
    expect(names).toContain('Robin Lake');
    await agent.delete(`/api/events/${ids.public}/registration`).expect(200);
  });

  test('can create public events and manage only their own', async () => {
    const { agent } = await becomeGuest('Casey');
    const mine = (await agent.post('/api/events').send(eventBody({ name: 'Casey Party' })).expect(201)).body;
    expect(mine.permissions).toMatchObject({ edit: true, delete: true });
    expect(mine.organizer.name).toBe('Casey');
    await agent.put(`/api/events/${mine.id}`).send(eventBody({ name: 'Casey Party 2' })).expect(200);

    // Someone else's event: visible, not editable.
    await agent.put(`/api/events/${ids.public}`).send(eventBody()).expect(403);
    const other = await becomeGuest('Drew');
    await other.agent.delete(`/api/events/${mine.id}`).expect(403);

    await agent.delete(`/api/events/${mine.id}`).expect(204);
  });

  test('cannot restrict an event to groups or invitees', async () => {
    const { agent } = await becomeGuest('Avery');
    const res = await agent
      .post('/api/events')
      .send(eventBody({ visibility: 'restricted', groupIds: [ids.group] }))
      .expect(400);
    expect(res.body.fields).toHaveProperty('visibility');
    await agent.post('/api/events').send(eventBody({ inviteIds: [ids.member] })).expect(400);
  });

  test('are limited to 5 new events an hour', async () => {
    const { agent } = await becomeGuest('Busy Bee');
    for (let i = 0; i < 5; i += 1) await agent.post('/api/events').send(eventBody({ name: `Burst ${i}` })).expect(201);
    await agent.post('/api/events').send(eventBody({ name: 'One too many' })).expect(429);
  });

  test('regular members can create in demo mode too; planners keep restricted events', async () => {
    await member.post('/api/events').send(eventBody({ name: 'Member Meetup' })).expect(201);
    await planner.post('/api/events').send(eventBody({ visibility: 'restricted', groupIds: [ids.group] })).expect(201);
  });
});

describe('expiry', () => {
  test('guest events, guests and their sign-ups are removed after the TTL; nothing else is', async () => {
    const { agent, user } = await becomeGuest('Old Guest');
    const guestEvent = (await agent.post('/api/events').send(eventBody({ name: 'Old Guest Event' })).expect(201)).body;
    await agent.post(`/api/events/${ids.public}/registration`).expect(201);
    const fresh = await becomeGuest('New Guest');
    const freshEvent = (await fresh.agent.post('/api/events').send(eventBody({ name: 'New Guest Event' })).expect(201)).body;
    const plannerEvent = (await planner.post('/api/events').send(eventBody({ name: 'Planner Old Event' })).expect(201)).body;

    // Age the old guest, their event and the planner's event past the TTL.
    await query('UPDATE event SET created_at = NOW() - INTERVAL 49 HOUR WHERE event_id IN (?)', [[guestEvent.id, plannerEvent.id]]);
    await query('UPDATE `user` SET created_at = NOW() - INTERVAL 49 HOUR WHERE user_id = ?', [user.id]);
    const before = (await planner.get(`/api/events/${ids.public}`).expect(200)).body.attendeeCount;

    await demo.cleanup();

    await planner.get(`/api/events/${guestEvent.id}`).expect(404);
    await planner.get(`/api/events/${freshEvent.id}`).expect(200);
    await planner.get(`/api/events/${plannerEvent.id}`).expect(200);
    // The expired guest is signed out and their seat is released.
    await agent.get('/api/auth/me').expect(401);
    const after = (await planner.get(`/api/events/${ids.public}`).expect(200)).body.attendeeCount;
    expect(after).toBe(before - 1);
  });
});

describe('showcase', () => {
  test('creates dozens of public events and simulated attendees, idempotently', async () => {
    const first = await ensureShowcase();
    expect(first.created.length).toBe(SHOWCASE_TARGET);
    expect(first.botIds.length).toBe(BOT_COUNT);

    const second = await ensureShowcase();
    expect(second.created).toEqual([]);
    expect(second.botIds.sort()).toEqual(first.botIds.sort());

    const { body } = await request(app).get('/api/events?limit=50').expect(200);
    expect(body.items.length).toBe(50);
    expect(body.nextCursor).not.toBeNull();
  });

  test('simulated attendees stay out of the admin and invitee user lists', async () => {
    const all = (await admin.get('/api/users').expect(200)).body;
    expect(all.some((u) => /^bot-/.test(u.email))).toBe(false);
    const directory = (await planner.get('/api/users').expect(200)).body;
    expect(directory.length).toBeLessThan(BOT_COUNT);
  });
});

describe('hidden names in demo mode', () => {
  test('visitors see "Private attendee"; guests may set the flag, visitors may not', async () => {
    const { agent } = await becomeGuest('Shy Guest');
    await agent.post(`/api/events/${ids.public}/registration`).expect(201);
    const saved = await agent.put('/api/auth/settings').send({ hideName: true }).expect(200);
    expect(saved.body.hideName).toBe(true);

    const visitor = request(app);
    const people = (await visitor.get(`/api/events/${ids.public}/attendees`).expect(200)).body;
    expect(JSON.stringify(people)).not.toContain('Shy Guest');
    expect(people.find((p) => p.private)).toMatchObject({ name: 'Private attendee' });
    const own = (await agent.get(`/api/events/${ids.public}/attendees`).expect(200)).body;
    expect(own.some((p) => p.name === 'Shy Guest')).toBe(true);

    await visitor.put('/api/auth/settings').send({ hideName: true }).expect(401);
  });
});

describe('word filter', () => {
  test('rejects a guest name with a neutral message', async () => {
    const res = await request(app).post('/api/demo/guest').send({ name: 'Fuck Face' }).expect(400);
    expect(res.body.fields.name).toBe('Please choose a different name');
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('fuck');
    await request(app).post('/api/demo/guest').send({ name: 'F u c k' }).expect(400);
    await becomeGuest('Scunthorpe Sussex');
  });

  test('rejects abusive name, location and description from a guest, on create and edit', async () => {
    const { agent } = await becomeGuest('Morgan');
    const res = await agent
      .post('/api/events')
      .send(eventBody({ name: 'Shit party', location: 'The b1tch bar', description: 'f.u.c.k off' }))
      .expect(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['description', 'location', 'name']);
    expect(res.body.fields.name).toBe('Please remove inappropriate language');

    const ok = (await agent.post('/api/events').send(eventBody({ name: 'Classic therapy session' })).expect(201)).body;
    await agent.put(`/api/events/${ok.id}`).send(eventBody({ description: 'nigga' })).expect(400);
    await agent.put(`/api/events/${ok.id}`).send(eventBody({ description: 'Assessment day' })).expect(200);
  });

  test('does not filter planners or admins', async () => {
    await planner.post('/api/events').send(eventBody({ name: 'Nazi history talk' })).expect(201);
    await admin.post('/api/events').send(eventBody({ name: 'Bastard Operator lecture' })).expect(201);
  });
});
