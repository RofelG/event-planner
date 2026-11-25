'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit').default;
const users = require('../repositories/users');
const schemas = require('../schemas');
const config = require('../config');
const { validate } = require('../middleware/validate');
const { setAuthCookie } = require('../lib/tokens');
const { notFound } = require('../lib/errors');
const { guestEmail, guestPasswordHash } = require('../demo/accounts');

const router = express.Router();

// Each name creates a guest account, so cap how fast one address can make them.
const guestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: 'Too many new names from this connection. Please try again later.' },
});

// GET /api/demo - public: whether demo mode is on, so the client can adapt.
router.get('/', (req, res) => {
  res.json({ enabled: config.demo.enabled, ttlHours: config.demo.enabled ? config.demo.ttlHours : null });
});

// POST /api/demo/guest - demo only: a visitor gives a name and gets a guest
// session (no password) for joining and creating events. The guest, its
// sign-ups and its events are removed after ttlHours.
router.post('/guest', (req, res, next) => (config.demo.enabled ? next() : next(notFound())), guestLimiter, validate(schemas.guest), async (req, res) => {
  const user = await users.createGuest({
    name: req.valid.body.name,
    email: guestEmail(),
    passwordHash: await guestPasswordHash(),
  });
  // The session lasts as long as the guest does, so they can leave an event
  // they joined yesterday.
  setAuthCookie(res, user, config.demo.ttlHours * 3600);
  res.status(201).json({ ...users.toPrincipal(user), groupIds: [] });
});

module.exports = router;
