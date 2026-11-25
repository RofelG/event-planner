'use strict';

process.env.NODE_ENV = 'test';
const request = require('supertest');
const app = require('../server/app');
const { pool, query } = require('../server/db/pool');
const { applySchema } = require('../server/db/seed');
const { hashPassword } = require('../server/lib/passwords');

const PASSWORD = 'Test-password-1';
const ids = {};
let admin, planner, otherPlanner, member, hider, bystander;

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

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const eventBody = (over = {}) => ({
  name: 'Privacy Event', location: 'Hall A', start: inDays(3), end: inDays(3.1),
  capacity: 10, cost: 0, typeId: ids.type, ...over,
});

beforeAll(async () => {
  await applySchema();
  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['waitlist', 'registration', 'event_invite', 'event_group', 'event', 'user_group', '`group`', '`type`', '`user`']) {
    await query(`TRUNCATE TABLE ${t}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  ids.type = (await query("INSERT INTO `type` (type_name) VALUES ('Workshop')")).insertId;
  ids.admin = await createUser('Admin', 'admin', 'admin@p.test');
  ids.planner = await createUser('Planner', 'planner', 'planner@p.test');
  ids.otherPlanner = await createUser('Other', 'planner', 'other@p.test');
  ids.member = await createUser('Member', 'user', 'member@p.test');
  ids.hider = await createUser('Hider', 'user', 'hider@p.test');
  ids.bystander = await createUser('Bystander', 'user', 'bystander@p.test');
  [admin, planner, otherPlanner, member, hider, bystander] = await Promise.all(
    ['admin', 'planner', 'other', 'member', 'hider', 'bystander'].map((n) => signIn(`${n}@p.test`))
  );

  ids.event = (await planner.post('/api/events').send(eventBody()).expect(201)).body.id;
  ids.event2 = (await planner.post('/api/events').send(eventBody({ name: 'Second' })).expect(201)).body.id;
  for (const agent of [member, hider]) {
    for (const id of [ids.event, ids.event2]) await agent.post(`/api/events/${id}/registration`).expect(201);
  }
  await hider.put('/api/auth/settings').send({ hideName: true }).expect(200);
});

afterAll(() => pool.end());

describe('account settings', () => {
  test('the setting round-trips through /me', async () => {
    expect((await hider.get('/api/auth/me').expect(200)).body.hideName).toBe(true);
    expect((await member.get('/api/auth/me').expect(200)).body.hideName).toBe(false);
    const saved = await member.put('/api/auth/settings').send({ hideName: true }).expect(200);
    expect(saved.body).toMatchObject({ id: ids.member, hideName: true });
    await member.put('/api/auth/settings').send({ hideName: false }).expect(200);
    expect((await member.get('/api/auth/me').expect(200)).body.hideName).toBe(false);
  });

  test('rejects a missing or non-boolean value and drops unknown fields', async () => {
    await member.put('/api/auth/settings').send({}).expect(400);
    await member.put('/api/auth/settings').send({ hideName: 'yes' }).expect(400);
    const res = await member.put('/api/auth/settings').send({ hideName: false, role: 'admin' }).expect(200);
    expect(res.body.role).toBe('user');
  });

  test('requires a session', async () => {
    await request(app).put('/api/auth/settings').send({ hideName: true }).expect(401);
  });
});

describe('attendee lists with a hidden name', () => {
  const list = async (agent, id = ids.event) => (await agent.get(`/api/events/${id}/attendees`).expect(200)).body;

  test('members see "Private attendee" and no real id', async () => {
    const people = await list(bystander);
    expect(people).toHaveLength(2);
    expect(people).toContainEqual({ id: ids.member, name: 'Member Test' });
    expect(people.find((p) => p.private)).toMatchObject({ name: 'Private attendee', private: true });
    expect(JSON.stringify(people)).not.toContain('Hider');
    expect(people.some((p) => p.id === ids.hider)).toBe(false);
  });

  test('the key is a position-based string, so it cannot link the person across events', async () => {
    const a = (await list(bystander, ids.event)).find((p) => p.private);
    const b = (await list(bystander, ids.event2)).find((p) => p.private);
    expect(typeof a.id).toBe('string');
    expect(a.id).toBe(b.id);
  });

  test.each([
    ['the organizer', () => planner],
    ['an admin', () => admin],
    ['the person themself', () => hider],
  ])('%s sees the real name', async (_label, who) => {
    const people = await list(who());
    expect(people).toContainEqual({ id: ids.hider, name: 'Hider Test' });
    expect(people.some((p) => p.private)).toBe(false);
  });

  test('a planner who does not manage the event sees it as private', async () => {
    expect((await list(otherPlanner)).some((p) => p.private)).toBe(true);
  });

  test('turning the setting off shows the name again', async () => {
    await hider.put('/api/auth/settings').send({ hideName: false }).expect(200);
    expect(await list(bystander)).toContainEqual({ id: ids.hider, name: 'Hider Test' });
  });
});
