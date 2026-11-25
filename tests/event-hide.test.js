'use strict';

/**
 * Admin moderation: hiding and unhiding events. Policy rules, the REST API and
 * the live stream. Runs against a real listening server because the live
 * stream never ends (see live.test.js). Uses the isolated test database.
 */
process.env.NODE_ENV = 'test';
const http = require('http');
const request = require('supertest');
const app = require('../server/app');
const live = require('../server/lib/live');
const policy = require('../server/lib/policy');
const { pool, query } = require('../server/db/pool');
const { applySchema } = require('../server/db/seed');
const { hashPassword } = require('../server/lib/passwords');

const PASSWORD = 'Test-password-1';
const ids = {};
const cookies = {};
let server;
let base;

async function createUser(first, role, email) {
  const r = await query(
    'INSERT INTO `user` (user_first, user_last, user_email, user_password, user_role) VALUES (?, ?, ?, ?, ?)',
    [first, 'Test', email, await hashPassword(PASSWORD), role]
  );
  return r.insertId;
}

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
}

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
const eventBody = (over = {}) => ({
  name: 'Moderation Event',
  location: 'Hall M',
  start: inDays(3),
  end: inDays(3.1),
  capacity: 5,
  cost: 0,
  typeId: ids.type,
  ...over,
});

/** Opens a stream as the given user and collects parsed messages. */
function openStream(cookie) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const waiters = [];
    const req = http.get(`${base}/api/events/stream`, { headers: { Cookie: cookie } }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const type = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (!type) continue;
          messages.push({ type, data: JSON.parse(data) });
          waiters.splice(0).forEach((check) => check());
        }
      });
      const stream = {
        messages,
        /** Resolves with the first message at or after index `from` matching `match`. */
        next(match, from = 0) {
          return new Promise((done, fail) => {
            const timer = setTimeout(() => fail(new Error('No matching stream message')), 3000);
            const check = () => {
              const found = messages.slice(from).find(match);
              if (found) {
                clearTimeout(timer);
                done(found);
              } else {
                waiters.push(check);
              }
            };
            check();
          });
        },
        close: () => req.destroy(),
      };
      stream.next((m) => m.type === 'ready').then(() => resolve(stream), reject);
    });
    req.on('error', (err) => (err.code === 'ECONNRESET' ? undefined : reject(err)));
  });
}

const about = (id, type) => (m) => m.type === type && m.data.id === id;
const api = (who) => ({
  get: (path) => request(base).get(`/api${path}`).set('Cookie', cookies[who]),
  post: (path, body) => request(base).post(`/api${path}`).set('Cookie', cookies[who]).send(body),
  put: (path, body) => request(base).put(`/api${path}`).set('Cookie', cookies[who]).send(body),
  del: (path) => request(base).delete(`/api${path}`).set('Cookie', cookies[who]),
});
const listed = async (who, q) => (await api(who).get(`/events?limit=50&q=${q}`).expect(200)).body.items.map((e) => e.id);

beforeAll(async () => {
  await applySchema();
  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['password_reset', 'waitlist', 'registration', 'event_invite', 'event_group', 'event', 'user_group', '`group`', '`type`', '`user`']) {
    await query(`TRUNCATE TABLE ${t}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  ids.type = (await query("INSERT INTO `type` (type_name) VALUES ('Workshop')")).insertId;
  ids.group = (await query("INSERT INTO `group` (group_name) VALUES ('Staff')")).insertId;
  ids.admin = await createUser('Admin', 'admin', 'admin@mod.test');
  ids.planner = await createUser('Planner', 'planner', 'planner@mod.test');
  ids.other = await createUser('Other', 'planner', 'other@mod.test');
  ids.member = await createUser('Member', 'user', 'member@mod.test');
  ids.outsider = await createUser('Outsider', 'user', 'outsider@mod.test');
  await query('INSERT INTO user_group (user_id, group_id) VALUES (?, ?)', [ids.member, ids.group]);

  for (const name of ['admin', 'planner', 'other', 'member', 'outsider']) cookies[name] = await login(`${name}@mod.test`);

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  live.closeAll();
  await new Promise((r) => server.close(r));
  await pool.end();
});

describe('policy', () => {
  const user = (over = {}) => ({ id: 10, role: 'user', groupIds: [], ...over });
  const event = (over = {}) => ({
    organizerId: 1,
    visibility: 'public',
    groupIds: [],
    inviteIds: [],
    end: inDays(1),
    attendeeCount: 0,
    capacity: 10,
    isRegistered: false,
    hiddenAt: '2026-01-01T00:00:00Z',
    ...over,
  });

  test('only admins can see a hidden event, not even its organizer', () => {
    expect(policy.canViewEvent(user({ role: 'admin' }), event())).toBe(true);
    expect(policy.canViewEvent(user({ id: 1, role: 'planner' }), event())).toBe(false);
    expect(policy.canViewEvent(user(), event())).toBe(false);
    expect(policy.canViewEvent(user({ groupIds: [5] }), event({ visibility: 'restricted', groupIds: [5] }))).toBe(false);
    expect(policy.canViewEvent(user(), event({ hiddenAt: null }))).toBe(true);
  });

  test('only admins can moderate', () => {
    expect(policy.canModerateEvent(user({ role: 'admin' }))).toBe(true);
    expect(policy.canModerateEvent(user({ role: 'planner' }))).toBe(false);
    expect(policy.canModerateEvent(user())).toBe(false);
    expect(policy.canModerateEvent(policy.VISITOR)).toBe(false);
  });

  test('nobody can join a hidden event; permissions offer the matching action', () => {
    const admin = user({ role: 'admin' });
    expect(policy.canJoinEvent(admin, event())).toBe(false);
    expect(policy.eventPermissions(admin, event())).toMatchObject({ join: false, hide: false, unhide: true });
    expect(policy.eventPermissions(admin, event({ hiddenAt: null }))).toMatchObject({ join: true, hide: true, unhide: false });
    expect(policy.eventPermissions(user({ role: 'planner' }), event({ hiddenAt: null }))).toMatchObject({ hide: false, unhide: false });
  });
});

describe('REST API', () => {
  let eventId;

  beforeAll(async () => {
    // Organized by `planner`, restricted to Staff (member is in it, outsider is not).
    eventId = (
      await api('planner').post('/events', eventBody({ name: 'Moderated', visibility: 'restricted', groupIds: [ids.group] })).expect(201)
    ).body.id;
    await api('member').post(`/events/${eventId}/registration`).expect(201);
  });

  test('only admins can hide or unhide', async () => {
    await api('planner').post(`/events/${eventId}/hide`).expect(403); // the organizer too
    await api('other').post(`/events/${eventId}/hide`).expect(404); // cannot even see it
    await api('member').post(`/events/${eventId}/hide`).expect(403);
    await api('member').del(`/events/${eventId}/hide`).expect(403);
    await request(base).post(`/api/events/${eventId}/hide`).expect(401);
    expect((await api('admin').get(`/events/${eventId}`).expect(200)).body.hidden).toBe(false);
  });

  test('a hidden event is a 404 for everyone but admins, who still see it', async () => {
    const { body } = await api('admin').post(`/events/${eventId}/hide`).expect(200);
    expect(body).toMatchObject({ id: eventId, hidden: true, permissions: { hide: false, unhide: true, join: false } });

    for (const who of ['planner', 'member']) {
      await api(who).get(`/events/${eventId}`).expect(404);
      await api(who).get(`/events/${eventId}/attendees`).expect(404);
      await api(who).post(`/events/${eventId}/registration`).expect(404);
      await api(who).del(`/events/${eventId}/registration`).expect(404);
      await api(who).put(`/events/${eventId}`, eventBody()).expect(404);
      await api(who).del(`/events/${eventId}`).expect(404);
      await api(who).del(`/events/${eventId}/hide`).expect(404);
      expect(await listed(who, 'Moderated')).not.toContain(eventId);
    }
    const manageable = (await api('planner').get('/events?manageable=true').expect(200)).body;
    expect(manageable.map((e) => e.id)).not.toContain(eventId);
    expect(await listed('admin', 'Moderated')).toContain(eventId);
    expect((await api('admin').get(`/events/${eventId}`).expect(200)).body.hidden).toBe(true);
    await api('admin').get(`/events/${eventId}/attendees`).expect(200);
    // Even an admin cannot sign up for a hidden event.
    await api('admin').post(`/events/${eventId}/registration`).expect(409);
  });

  test('nobody can join the waitlist of a hidden full event, not even an admin', async () => {
    const full = (await api('planner').post('/events', eventBody({ name: 'Hidden and full', capacity: 1 })).expect(201)).body;
    await api('member').post(`/events/${full.id}/registration`).expect(201);
    await api('admin').post(`/events/${full.id}/hide`).expect(200);

    const seen = (await api('admin').get(`/events/${full.id}`).expect(200)).body;
    expect(seen.permissions).toMatchObject({ joinWaitlist: false });
    await api('admin').post(`/events/${full.id}/waitlist`).expect(409);
    await api('outsider').post(`/events/${full.id}/waitlist`).expect(404);
  });

  test('hiding twice is harmless; non-admins never see the hidden flag', async () => {
    await api('admin').post(`/events/${eventId}/hide`).expect(200);
    const { body } = await api('planner').post('/events', eventBody({ name: 'Plain' })).expect(201);
    expect(body).not.toHaveProperty('hidden');
    expect(body.permissions).toMatchObject({ hide: false, unhide: false });
  });

  test('unhiding restores the original visibility rules', async () => {
    const { body } = await api('admin').del(`/events/${eventId}/hide`).expect(200);
    expect(body).toMatchObject({ hidden: false, permissions: { hide: true, unhide: false } });

    await api('planner').get(`/events/${eventId}`).expect(200);
    expect(await listed('member', 'Moderated')).toContain(eventId);
    // Still restricted to Staff.
    await api('outsider').get(`/events/${eventId}`).expect(404);
    expect(await listed('outsider', 'Moderated')).not.toContain(eventId);
    // The member's registration survived.
    expect((await api('member').get(`/events/${eventId}`).expect(200)).body.isRegistered).toBe(true);
  });
});

describe('live stream', () => {
  let streams;

  beforeEach(async () => {
    const [admin, member, outsider] = await Promise.all(
      ['admin', 'member', 'outsider'].map((n) => openStream(cookies[n]))
    );
    streams = { admin, member, outsider };
  });
  afterEach(() => Object.values(streams).forEach((s) => s.close()));

  test('hiding removes the event for non-admins and unhiding brings it back', async () => {
    const { admin, member, outsider } = streams;
    const { body: event } = await api('planner').post('/events', eventBody({ name: 'Moderated live' })).expect(201);
    await outsider.next(about(event.id, 'event'));
    await member.next(about(event.id, 'event'));

    await api('admin').post(`/events/${event.id}/hide`).expect(200);
    const removed = await outsider.next(about(event.id, 'remove'));
    await member.next(about(event.id, 'remove'));
    const forAdmin = await admin.next((m) => about(event.id, 'event')(m) && m.data.hidden === true);
    expect(forAdmin.data.permissions).toMatchObject({ hide: false, unhide: true });
    expect(admin.messages.some(about(event.id, 'remove'))).toBe(false);

    await api('admin').del(`/events/${event.id}/hide`).expect(200);
    const after = (s) => s.messages.indexOf(removed) + 1;
    const back = await outsider.next(about(event.id, 'event'), after(outsider));
    expect(back.data).not.toHaveProperty('hidden');
    await member.next(about(event.id, 'event'), member.messages.findIndex(about(event.id, 'remove')) + 1);
  });

  test('hiding a restricted event only tells people who could see it', async () => {
    const { admin, member, outsider } = streams;
    const { body: event } = await api('planner')
      .post('/events', eventBody({ visibility: 'restricted', groupIds: [ids.group] }))
      .expect(201);
    await member.next(about(event.id, 'event'));
    await api('admin').post(`/events/${event.id}/hide`).expect(200);
    await member.next(about(event.id, 'remove'));
    await admin.next((m) => about(event.id, 'event')(m) && m.data.hidden === true);
    expect(outsider.messages.filter((m) => m.data.id === event.id)).toEqual([]);
  });
});
