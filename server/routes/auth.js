'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit').default;
const users = require('../repositories/users');
const schemas = require('../schemas');
const config = require('../config');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { hashPassword, verifyPassword, DUMMY_HASH } = require('../lib/passwords');
const passwordResets = require('../repositories/passwordResets');
const logger = require('../lib/logger');
const mailer = require('../lib/mailer');
const { isGuestEmail } = require('../demo/accounts');
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

// Forgot-password requests are cheap for an attacker and send real email, so
// they get their own, tighter per-IP limit. Every response is 202, so
// successful requests must count too.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: 'Too many requests. Please wait 15 minutes and try again.' },
});

const RESET_TTL_MINUTES = 30;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Forgot-password work runs after the response is sent, so response time cannot
// reveal whether the account exists. Tests await settled() instead of sleeping.
const inFlight = new Set();
function runInBackground(task) {
  const p = task()
    .catch((err) => logger.error({ err }, 'password reset email failed'))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

async function sendResetEmail(email) {
  const user = await users.findActiveByEmail(email);
  if (!user || isGuestEmail(user.user_email)) return;
  // Only the hash is stored; the raw token exists only in the email.
  const token = crypto.randomBytes(32).toString('hex');
  await passwordResets.issue(user.user_id, hashToken(token), RESET_TTL_MINUTES);
  const link = `${config.appUrl}/reset-password?token=${token}`;
  await mailer.sendPasswordReset({ to: user.user_email, first: user.user_first, link, ttlMinutes: RESET_TTL_MINUTES });
}

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

// POST /api/auth/forgot - email a reset link if the account exists. The answer
// is identical either way, so this cannot be used to find out who has an account.
router.post('/forgot', forgotLimiter, validate(schemas.forgotPassword), (req, res) => {
  const { email } = req.valid.body;
  runInBackground(() => sendResetEmail(email));
  res.status(202).json({ message: 'If an account exists for that email, a reset link is on its way.' });
});

// POST /api/auth/reset - set a new password with an emailed token. Changing the
// password bumps token_version, which signs out every session.
router.post('/reset', credentialLimiter, validate(schemas.resetPassword), async (req, res) => {
  const { token, password } = req.valid.body;
  const invalid = () => badRequest('This reset link is invalid or has expired. Please request a new one.');
  const tokenHash = hashToken(token);

  const userId = await passwordResets.consume(tokenHash);
  if (!userId) throw invalid();
  // The account may have been deactivated since the email was sent.
  if (!(await users.findActiveById(userId))) throw invalid();

  await users.updatePassword(userId, await hashPassword(password));
  await passwordResets.deleteOthers(userId, tokenHash);
  res.status(204).end();
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

// For tests: resolves once background email work has finished.
router.settled = () => Promise.allSettled([...inFlight]);

module.exports = router;
