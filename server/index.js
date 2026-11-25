'use strict';

const config = require('./config');
const app = require('./app');
const { pool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const live = require('./lib/live');
const demo = require('./demo');
const logger = require('./lib/logger');

let server;

function shutdown() {
  demo.stop();
  // Open live streams would otherwise keep server.close() waiting forever.
  live.closeAll();
  if (server) server.close(() => pool.end().finally(() => process.exit(0)));
  else pool.end().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Bring the schema up to date before accepting traffic.
migrate()
  .then(() => {
    server = app.listen(config.port, () => {
      logger.info({ port: config.port, env: config.env }, 'API listening');
      if (config.demo.enabled) {
        demo.start().catch((err) => logger.error({ err }, 'Demo mode failed to start'));
      }
    });
  })
  .catch((err) => {
    logger.fatal({ err }, 'Database migration failed, not starting');
    pool.end().finally(() => process.exit(1));
  });
