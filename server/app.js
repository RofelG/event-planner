'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { authenticate, authenticateWith } = require('./middleware/auth');
const live = require('./lib/live');
const { HttpError } = require('./lib/errors');
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const adminRoutes = require('./routes/admin');
const demoRoutes = require('./routes/demo');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.isProduction ? 1 : false);
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Defense in depth against CSRF (on top of SameSite=strict cookies): browsers
// cannot send a cross-site application/json body without a CORS preflight,
// which this API never approves.
app.use('/api', (req, res, next) => {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0';
  if (hasBody && req.headers['content-type'] && !req.is('application/json')) {
    return next(new HttpError(415, 'Requests must be sent as JSON.'));
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Public routes (register, login, logout). /me and /password authenticate inside.
app.use('/api/auth', authRoutes);

// Demo mode settings (public) and guest names (demo only).
app.use('/api/demo', demoRoutes);

// Everything below requires a signed-in user. In demo mode the catalogue,
// stream and types also accept visitors (no session), who see public events
// only; event routes that change data still require a user (requireUser).
const catalogueAuth = authenticateWith({ allowVisitor: true });

// Live catalogue updates (Server-Sent Events). Registered before /api/events so
// it uses the non-sliding session check: an open tab must not keep an idle
// session alive.
app.get('/api/events/stream', authenticateWith({ slide: false, allowVisitor: true }), live.stream);
app.use('/api/events', catalogueAuth, eventRoutes);
app.use('/api/types', catalogueAuth, adminRoutes.types);
app.use('/api/users', authenticate, adminRoutes.users);
app.use('/api/groups', authenticate, adminRoutes.groups);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// In production Express serves the built React app and lets the client router
// handle every non-API path.
const dist = path.join(__dirname, '..', 'dist');
if (config.isProduction && fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { fields: err.details } : {}) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  // Unknown errors: log server-side, never leak internals to the client.
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;
