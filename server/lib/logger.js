'use strict';

const pino = require('pino');

const env = process.env.NODE_ENV || 'development';

// Read straight from the environment (not config.js) so config can log too.
const level = env === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info';

// Secrets must never reach the logs, whether a whole request is serialized or
// a body is logged by hand. "current" and "confirm" are the password-change
// fields (see schemas.js).
const redact = {
  paths: [
    'req.headers.cookie',
    'req.headers.authorization',
    'res.headers["set-cookie"]',
    'password',
    'current',
    'confirm',
    '*.password',
    '*.current',
    '*.confirm',
    'req.body.password',
    'req.body.current',
    'req.body.confirm',
  ],
  censor: '[Redacted]',
};

const options = { level, redact };

// Pretty output only in development; production (and anything else) is plain
// JSON on stdout for the log collector. pino-pretty is a devDependency, so a
// production install (npm ci --omit=dev) that forgot NODE_ENV falls back to
// JSON instead of crashing on start.
const hasPretty = (() => {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
})();
if (env === 'development' && hasPretty) {
  options.transport = { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } };
}

module.exports = pino(options);
