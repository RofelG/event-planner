'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit').default;
const users = require('../repositories/users');
const schemas = require('../schemas');
const config = require('../config');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { hashPassword, verifyPassword, DUMMY_HASH } = require('../lib/passwords');
const { setAuthCookie, clearAuthCookie } = require('../lib/tokens');
const { conflict, unauthorized, badRequest } = require('../lib/errors');

const router = express.Router();

// Server-side, per-IP limit. Replaces the old cookie counter, which a client
// could reset by simply discarding the cookie.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => config.env === 'test',
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
});

const me = async (user) => ({ ...users.toPrincipal(user), groupIds: await users.groupIdsFor(user.user_id) });

// POST /api/auth/register - create an account (always role "user") and sign in.
router.post('/register', credentialLimiter, validate(schemas.register), async (req, res) => {
  const { first, last, email, password } = req.valid.body;
  if (await users.emailExists(email)) throw conflict('An account with this email already exists.');

  const user = await users.create({ first, last, email, passwordHash: await hashPassword(password) });
  setAuthCookie(res, user);
  res.status(201).json(await me(user));
});

// POST /api/auth/login - verify credentials and set the session cookie.
router.post('/login', credentialLimiter, validate(schemas.login), async (req, res) => {
  const { email, password } = req.valid.body;
  const user = await users.findByEmailWithHash(email);
  // Always run bcrypt so response time does not reveal whether the email exists.
  const ok = await verifyPassword(password, user ? user.user_password : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Email or password is incorrect.');

  setAuthCookie(res, user);
  res.json(await me(user));
});

// POST /api/auth/logout - clear the session cookie.
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

// GET /api/auth/me - the signed-in user, or 401.
router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

// PUT /api/auth/settings - account settings (currently the privacy flag). Demo
// guests may use it; visitors never reach it because authenticate rejects them.
router.put('/settings', authenticate, validate(schemas.accountSettings), async (req, res) => {
  const updated = await users.updateSettings(req.user.id, req.valid.body);
  res.json(await me(updated));
});

// PUT /api/auth/password - change password; signs out every other session.
router.put('/password', authenticate, validate(schemas.changePassword), async (req, res) => {
  const { current, password } = req.valid.body;
  const hash = await users.findHashById(req.user.id);
  if (!(await verifyPassword(current, hash))) {
    throw badRequest('Please correct the highlighted fields.', { current: 'Current password is incorrect' });
  }
  const updated = await users.updatePassword(req.user.id, await hashPassword(password));
  setAuthCookie(res, updated); // keep this session alive with the new token version
  res.status(204).end();
});

module.exports = router;
