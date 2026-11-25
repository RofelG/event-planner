'use strict';

/** Forgot / reset password: real Express app + the isolated <DB_DB>_test database. */
process.env.NODE_ENV = 'test';
const crypto = require('crypto');
const request = require('supertest');
const app = require('../server/app');
const authRoutes = require('../server/routes/auth');
const mailer = require('../server/lib/mailer');
const config = require('../server/config');
const { pool, query } = require('../server/db/pool');
const { applySchema } = require('../server/db/seed');
const { hashPassword } = require('../server/lib/passwords');
const { guestEmail } = require('../server/demo/accounts');

const PASSWORD = 'Test-password-1';
const NEW_PASSWORD = 'Brand-new-pass-1';
const sent = [];

async function createUser(email, status = 1) {
  const r = await query(
    'INSERT INTO `user` (user_first, user_last, user_email, user_password, user_role, user_status) VALUES (?, ?, ?, ?, ?, ?)',
    ['Reset', 'Test', email, await hashPassword(PASSWORD), 'user', status]
  );
  return r.insertId;
}

/** Requests a reset and waits for the background work, returning the response. */
async function forgot(email) {
  const res = await request(app).post('/api/auth/forgot').send({ email });
  await authRoutes.settled();
  return res;
}

const tokenFrom = (mail) => new RegExp(`${config.appUrl}/reset-password\\?token=([0-9a-f]{64})`).exec(mail.text)?.[1];
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const reset = (token, password = NEW_PASSWORD, confirm = password) =>
  request(app).post('/api/auth/reset').send({ token, password, confirm });

beforeAll(async () => {
  await applySchema();
  // Start from empty tables like the other suites, so the fixed emails below can
  // be inserted again on every run.
  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['password_reset', 'waitlist', 'registration', 'event_invite', 'event_group', 'event', 'user_group', '`group`', '`type`', '`user`']) {
    await query(`TRUNCATE TABLE ${t}`);
  }
  await query('SET FOREIGN_KEY_CHECKS = 1');
  mailer.setTransport({ sendMail: async (message) => { sent.push(message); } });
});

beforeEach(() => { sent.length = 0; });

afterAll(async () => {
  mailer.setTransport(undefined);
  await pool.end();
});

describe('POST /api/auth/forgot', () => {
  test('unknown and known emails get identical responses', async () => {
    await createUser('known@t.test');
    const known = await forgot('known@t.test');
    const unknown = await forgot('nobody@t.test');
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
  });

  test('sends exactly one email with a working link, storing only a hash', async () => {
    const id = await createUser('one@t.test');
    await forgot('one@t.test');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('one@t.test');
    const token = tokenFrom(sent[0]);
    expect(token).toBeTruthy();

    const rows = await query('SELECT token_hash FROM password_reset WHERE user_id = ?', [id]);
    expect(rows).toEqual([{ token_hash: hash(token) }]);
    expect(rows[0].token_hash).not.toBe(token);

    await reset(token).expect(204);
  });

  test('a new request invalidates the earlier token', async () => {
    await createUser('twice@t.test');
    await forgot('twice@t.test');
    await forgot('twice@t.test');
    expect(sent).toHaveLength(2);
    await reset(tokenFrom(sent[0])).expect(400);
    await reset(tokenFrom(sent[1])).expect(204);
  });

  test('guests and deactivated users get no email', async () => {
    await createUser(guestEmail());
    const guest = (await query("SELECT user_email FROM `user` WHERE user_email LIKE 'guest-%' LIMIT 1"))[0].user_email;
    await createUser('off@t.test', 0);
    const a = await forgot(guest);
    const b = await forgot('off@t.test');
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(sent).toHaveLength(0);
  });

  test('rejects a malformed email', async () => {
    await request(app).post('/api/auth/forgot').send({ email: 'not-an-email' }).expect(400);
  });
});

describe('POST /api/auth/reset', () => {
  test('a token works once, then the new password signs in', async () => {
    await createUser('once@t.test');
    await forgot('once@t.test');
    const token = tokenFrom(sent[0]);
    await reset(token).expect(204);
    const again = await reset(token, 'Another-pass-22').expect(400);
    expect(again.body.error).toMatch(/invalid or has expired/);

    await request(app).post('/api/auth/login').send({ email: 'once@t.test', password: PASSWORD }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'once@t.test', password: NEW_PASSWORD }).expect(200);
  });

  test('an expired token is rejected', async () => {
    await createUser('late@t.test');
    await forgot('late@t.test');
    const token = tokenFrom(sent[0]);
    await query('UPDATE password_reset SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE token_hash = ?', [hash(token)]);
    await reset(token).expect(400);
  });

  test('the token lasts about 30 minutes', async () => {
    await createUser('ttl@t.test');
    await forgot('ttl@t.test');
    const [row] = await query(
      'SELECT TIMESTAMPDIFF(MINUTE, NOW(), expires_at) AS minutes FROM password_reset WHERE token_hash = ?',
      [hash(tokenFrom(sent[0]))]
    );
    expect(row.minutes).toBeGreaterThanOrEqual(29);
    expect(row.minutes).toBeLessThanOrEqual(30);
  });

  test('an unknown token is rejected', async () => {
    await reset(crypto.randomBytes(32).toString('hex')).expect(400);
  });

  test('applies the registration password rules and checks confirmation', async () => {
    await createUser('rules@t.test');
    await forgot('rules@t.test');
    const token = tokenFrom(sent[0]);
    const weak = await reset(token, 'short1').expect(400);
    expect(weak.body.fields.password).toBeTruthy();
    const mismatch = await reset(token, NEW_PASSWORD, 'Different-pass-1').expect(400);
    expect(mismatch.body.fields.confirm).toBe('Passwords do not match');
    await reset(token).expect(204); // the failed attempts did not use the token
  });

  test('signs out sessions that existed before the reset', async () => {
    await createUser('session@t.test');
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'session@t.test', password: PASSWORD }).expect(200);
    await agent.get('/api/auth/me').expect(200);

    await forgot('session@t.test');
    await reset(tokenFrom(sent[0])).expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  test('a token for an account deactivated since is rejected', async () => {
    const id = await createUser('gone@t.test');
    await forgot('gone@t.test');
    await query('UPDATE `user` SET user_status = 0 WHERE user_id = ?', [id]);
    await reset(tokenFrom(sent[0])).expect(400);
  });

  test('other tokens for the user are deleted after a reset', async () => {
    const id = await createUser('others@t.test');
    await forgot('others@t.test');
    const token = tokenFrom(sent[0]);
    // A leftover used token must not survive either.
    await query(
      "INSERT INTO password_reset (token_hash, user_id, expires_at, used_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW())",
      [hash('leftover'), id]
    );
    await reset(token).expect(204);
    const rows = await query('SELECT token_hash FROM password_reset WHERE user_id = ?', [id]);
    expect(rows).toEqual([{ token_hash: hash(token) }]);
  });
});
