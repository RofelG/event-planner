'use strict';

const config = require('./config');
const app = require('./app');
const { pool } = require('./db/pool');
const live = require('./lib/live');
const demo = require('./demo');
const logger = require('./lib/logger');

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'API listening');
  if (config.demo.enabled) {
    demo.start().catch((err) => logger.error({ err }, 'Demo mode failed to start'));
  }
});

function shutdown() {
  demo.stop();
  // Open live streams would otherwise keep server.close() waiting forever.
  live.closeAll();
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
