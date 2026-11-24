'use strict';

/**
 * Live stream (Server-Sent Events) tests against a real listening server, since
 * supertest buffers whole responses and an event stream never ends.
 * Uses the same isolated test database as api.test.js.
 */
process.env.NODE_ENV = 'test';
const http = require('http');
const request = require('supertest');
const app = require('../server/app');
const live = require('../server/lib/live');
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
  name: 'Live Event',
  location: 'Hall B',
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
        status: res.statusCode,
        headers: res.headers,
        messages,
        /** Resolves with the first message matching `match`, or rejects after 3s. */
        next(match) {
          return new Promise((done, fail) => {
            const timer = setTimeout(() => fail(new Error('No matching stream message')), 3000);
            const check = () => {
              const found = messages.find(match);
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
      if (res.statusCode !== 200) {
        res.resume();
        resolve(stream);
        return;
      }
      stream.next((m) => m.type === 'ready').then(() => resolve(stream), reject);
    });
    req.on('error', (err) => (err.code === 'ECONNRESET' ? undefined : reject(err)));
  });
}

const about = (id, type) => (m) => m.type === type && (m.data.id === id);

beforeAll(async () => {
  await applySchema();
  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['registration', 'event_invite', 'event_group', 'event', 'user_group', '`group`', '`type`', '`user`']) {
    await query(`TRUNCATE TABLE ${t}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');

  ids.type = (await query("INSERT INTO `type` (type_name) VALUES ('Workshop')")).insertId;
  ids.group = (await query("INSERT INTO `group` (group_name) VALUES ('Volleyball')")).insertId;
  ids.planner = await createUser('Planner', 'planner', 'planner@live.test');
  ids.member = await createUser('Member', 'user', 'member@live.test');
  ids.outsider = await createUser('Outsider', 'user', 'outsider@live.test');
  await query('INSERT INTO user_group (user_id, group_id) VALUES (?, ?)', [ids.member, ids.group]);

  for (const name of ['planner', 'member', 'outsider']) cookies[name] = await login(`${name}@live.test`);

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  live.closeAll();
  await new Promise((r) => server.close(r));
  await pool.end();
});

const api = (who) => ({
  post: (path, body) => request(base).post(`/api${path}`).set('Cookie', cookies[who]).send(body),
  put: (path, body) => request(base).put(`/api${path}`).set('Cookie', cookies[who]).send(body),
  del: (path) => request(base).delete(`/api${path}`).set('Cookie', cookies[who]),
});

describe('live stream', () => {
  let member;
  let outsider;

  beforeEach(async () => {
    [member, outsider] = await Promise.all([openStream(cookies.member), openStream(cookies.outsider)]);
  });
  afterEach(() => {
    member.close();
    outsider.close();
  });

  test('requires a session', async () => {
    const anon = await openStream('');
    expect(anon.status).toBe(401);
  });

  test('is an event stream that does not renew the session cookie', () => {
    expect(member.status).toBe(200);
    expect(member.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(member.headers['set-cookie']).toBeUndefined();
  });

  test('a seat taken on a public event reaches every viewer, with per-user state', async () => {
    const { body: event } = await api('planner').post('/events', eventBody()).expect(201);
    await api('member').post(`/events/${event.id}/registration`).expect(201);

    const forMember = await member.next((m) => about(event.id, 'event')(m) && m.data.attendeeCount === 1);
    const forOutsider = await outsider.next((m) => about(event.id, 'event')(m) && m.data.attendeeCount === 1);
    expect(forMember.data).toMatchObject({ isRegistered: true, permissions: { join: false, leave: true } });
    expect(forOutsider.data).toMatchObject({ isRegistered: false, permissions: { join: true, leave: false } });
    // Audience details stay with managers, as in the REST API.
    expect(forOutsider.data).not.toHaveProperty('groupIds');
  });

  test('changes to a restricted event never reach users outside its audience', async () => {
    const { body: event } = await api('planner')
      .post('/events', eventBody({ visibility: 'restricted', groupIds: [ids.group] }))
      .expect(201);
    await api('member').post(`/events/${event.id}/registration`).expect(201);
    await api('planner').del(`/events/${event.id}`).expect(204);

    // Each change fans out to all streams in one pass, so once the member has
    // the final message the outsider has had every chance to receive one.
    await member.next(about(event.id, 'remove'));
    expect(member.messages.some(about(event.id, 'event'))).toBe(true);
    expect(outsider.messages.filter((m) => m.data.id === event.id)).toEqual([]);
  });

  test('restricting a public event removes it for users who lose access', async () => {
    const { body: event } = await api('planner').post('/events', eventBody()).expect(201);
    await outsider.next(about(event.id, 'event'));

    await api('planner')
      .put(`/events/${event.id}`, eventBody({ visibility: 'restricted', groupIds: [ids.group] }))
      .expect(200);

    await outsider.next(about(event.id, 'remove'));
    const update = await member.next((m) => about(event.id, 'event')(m) && m.data.visibility === 'restricted');
    expect(update.data.id).toBe(event.id);
  });
});
