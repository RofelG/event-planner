'use strict';

process.env.NODE_ENV = 'test';
const request = require('supertest');
const app = require('../server/app');
const config = require('../server/config');
const { pool, query } = require('../server/db/pool');
const { applySchema } = require('../server/db/seed');
const { hashPassword } = require('../server/lib/passwords');

const PASSWORD = 'Test-password-1';
const ids = {};
let admin, planner, planner2, a, b, member;

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
  name: 'Deletion Event', location: 'Hall A', start: inDays(3), end: inDays(3.1),
  capacity: 5, cost: 0, typeId: ids.type, ...over,
});
const organizerOf = async (eventId) => (await query('SELECT event_organizer FROM event WHERE event_id = ?', [eventId]))[0].event_organizer;
const userRow = async (id) => (await query('SELECT * FROM `user` WHERE user_id = ?', [id]))[0];

beforeAll(async () => {
  await applySchema();
  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['password_reset', 'waitlist', 'registration', 'event_invite', 'event_group', 'event', 'user_group', '`group`', '`type`', '`user`']) {
    await query(`TRUNCATE TABLE ${t}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  ids.type = (await query("INSERT INTO `type` (type_name) VALUES ('Workshop')")).insertId;
  ids.group = (await query("INSERT INTO `group` (group_name) VALUES ('Staff')")).insertId;
  ids.admin = await createUser('Admin', 'admin', 'admin@del.test');
  ids.admin2 = await createUser('Admin2', 'admin', 'admin2@del.test');
  ids.planner = await createUser('Leaving', 'planner', 'planner@del.test');
  ids.planner2 = await createUser('Staying', 'planner', 'planner2@del.test');
  ids.a = await createUser('Alice', 'user', 'a@del.test');
  ids.b = await createUser('Bob', 'user', 'b@del.test');
  ids.member = await createUser('Member', 'user', 'member@del.test');
  admin = await signIn('admin@del.test');
  planner = await signIn('planner@del.test');
  planner2 = await signIn('planner2@del.test');
  a = await signIn('a@del.test');
  b = await signIn('b@del.test');
  member = await signIn('member@del.test');

  await query('INSERT INTO user_group (user_id, group_id) VALUES (?, ?)', [ids.planner, ids.group]);
  await query("INSERT INTO password_reset (token_hash, user_id, expires_at) VALUES (REPEAT('a', 64), ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))", [ids.planner]);

  // Upcoming and past events organized by the leaver.
  ids.upcoming = (await planner.post('/api/events').send(eventBody({ name: 'Upcoming' })).expect(201)).body.id;
  ids.past = (await planner.post('/api/events').send(eventBody({ name: 'Past' })).expect(201)).body.id;
  await query(
    'UPDATE event SET event_date_start = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 DAY), event_date_end = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY) WHERE event_id = ?',
    [ids.past]
  );
  // A restricted event by someone else, inviting the leaver.
  ids.invite = (
    await planner2.post('/api/events').send(eventBody({ name: 'Invite only', visibility: 'restricted', inviteIds: [ids.planner] })).expect(201)
  ).body.id;
  // A one-seat event the leaver holds, with two people waiting.
  ids.full = (await planner2.post('/api/events').send(eventBody({ name: 'One seat', capacity: 1 })).expect(201)).body.id;
  await planner.post(`/api/events/${ids.full}/registration`).expect(201);
  await a.post(`/api/events/${ids.full}/waitlist`).expect(201);
  await b.post(`/api/events/${ids.full}/waitlist`).expect(201);
});

afterAll(() => pool.end());

describe('DELETE /api/auth/account', () => {
  test('requires a session', async () => {
    await request(app).delete('/api/auth/account').send({ password: PASSWORD }).expect(401);
  });

  test('a missing or wrong password is a field error and deletes nothing', async () => {
    const wrong = await planner.delete('/api/auth/account').send({ password: 'Wrong-password-1' }).expect(400);
    expect(wrong.body.fields.password).toBeDefined();
    const missing = await planner.delete('/api/auth/account').send({}).expect(400);
    expect(missing.body.fields.password).toBeDefined();
    await planner.delete('/api/auth/account').send({ confirm: true }).expect(400);
    expect((await userRow(ids.planner)).user_status).toBe(1);
    await planner.get('/api/auth/me').expect(200);
  });

  test('hands upcoming events to the lowest-id other admin, frees the seat, removes memberships', async () => {
    const other = await signIn('planner@del.test'); // a second session
    const res = await planner.delete('/api/auth/account').send({ password: PASSWORD }).expect(204);
    expect(res.headers['set-cookie'].join(';')).toMatch(/=;|Expires=Thu, 01 Jan 1970/);

    // Events: upcoming moves to the admin; the past one keeps its organizer.
    expect(await organizerOf(ids.upcoming)).toBe(ids.admin);
    expect(await organizerOf(ids.past)).toBe(ids.planner);

    // The freed seat went to the first person waiting; the other moved up.
    const seat = await query('SELECT user_id FROM registration WHERE event_id = ?', [ids.full]);
    expect(seat.map((r) => r.user_id)).toEqual([ids.a]);
    const view = (await b.get(`/api/events/${ids.full}`).expect(200)).body;
    expect(view).toMatchObject({ waitlistPosition: 1, waitlistCount: 1 });
    expect((await a.get(`/api/events/${ids.full}`).expect(200)).body.isRegistered).toBe(true);

    // Groups, invites and reset tokens are gone.
    expect(await query('SELECT 1 FROM user_group WHERE user_id = ?', [ids.planner])).toHaveLength(0);
    expect(await query('SELECT 1 FROM event_invite WHERE user_id = ?', [ids.planner])).toHaveLength(0);
    expect(await query('SELECT 1 FROM password_reset WHERE user_id = ?', [ids.planner])).toHaveLength(0);
    expect(await query('SELECT 1 FROM registration WHERE user_id = ?', [ids.planner])).toHaveLength(0);

    // The row is anonymized and cannot sign in; every session is revoked.
    const row = await userRow(ids.planner);
    expect(row).toMatchObject({
      user_first: 'Deleted user',
      user_last: '',
      user_email: `deleted-${ids.planner}@deleted.invalid`,
      user_status: 0,
      user_hide_name: 1,
    });
    await request(app).post('/api/auth/login').send({ email: 'planner@del.test', password: PASSWORD }).expect(401);
    await request(app).post('/api/auth/login').send({ email: row.user_email, password: PASSWORD }).expect(401);
    await planner.get('/api/auth/me').expect(401);
    await other.get('/api/auth/me').expect(401);
  });

  test('the original email can register again', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ first: 'New', last: 'Person', email: 'planner@del.test', password: PASSWORD })
      .expect(201);
  });

  test('deleted accounts are not listed for admins or in the invite directory', async () => {
    const list = (await admin.get('/api/users').expect(200)).body;
    expect(JSON.stringify(list)).not.toMatch(/deleted\.invalid|Deleted user/);
    const directory = (await planner2.get('/api/users').expect(200)).body;
    expect(JSON.stringify(directory)).not.toMatch(/Deleted user/);
  });

  test('the only active admin cannot delete their account', async () => {
    await query('UPDATE `user` SET user_status = 0 WHERE user_id = ?', [ids.admin2]);
    const res = await admin.delete('/api/auth/account').send({ password: PASSWORD }).expect(409);
    expect(res.body.error).toMatch(/only active admin/);
    expect((await userRow(ids.admin)).user_status).toBe(1);
    await admin.get('/api/auth/me').expect(200);
    await query('UPDATE `user` SET user_status = 1 WHERE user_id = ?', [ids.admin2]);
  });

  test('a user whose upcoming events have no admin to take them is refused', async () => {
    await query('UPDATE `user` SET user_status = 0 WHERE user_role = ?', ['admin']);
    await planner2.delete('/api/auth/account').send({ password: PASSWORD }).expect(409);
    await query('UPDATE `user` SET user_status = 1 WHERE user_role = ?', ['admin']);
    expect((await userRow(ids.planner2)).user_status).toBe(1);
  });

  test('a plain member with nothing upcoming deletes without an admin involved', async () => {
    await member.delete('/api/auth/account').send({ password: PASSWORD }).expect(204);
    expect((await userRow(ids.member)).user_email).toBe(`deleted-${ids.member}@deleted.invalid`);
  });
});

describe('demo guests', () => {
  beforeAll(() => { config.demo.enabled = true; });
  afterAll(() => { config.demo.enabled = false; });

  test('visitors get 401; a guest deletes with confirm instead of a password', async () => {
    await request(app).delete('/api/auth/account').send({ confirm: true }).expect(401);

    const agent = request.agent(app);
    const guest = (await agent.post('/api/demo/guest').send({ name: 'Gina' }).expect(201)).body;
    await agent.post(`/api/events/${ids.upcoming}/registration`).expect(201);

    await agent.delete('/api/auth/account').send({}).expect(400);
    await agent.delete('/api/auth/account').send({ confirm: true }).expect(204);

    expect(await userRow(guest.id)).toMatchObject({ user_first: 'Deleted user', user_status: 0 });
    expect(await query('SELECT 1 FROM registration WHERE user_id = ?', [guest.id])).toHaveLength(0);
    await agent.get('/api/auth/me').expect(401);
  });
});
