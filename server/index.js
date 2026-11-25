'use strict';

const config = require('./config');
const app = require('./app');
const { pool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const live = require('./lib/live');
const demo = require('./demo');

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
      console.log(`API listening on http://localhost:${config.port} (${config.env})`);
      if (config.demo.enabled) {
        demo.start().catch((err) => console.error('Demo mode failed to start', err));
      }
    });
  })
  .catch((err) => {
    console.error(`Database migration failed, not starting: ${err.message}`);
    pool.end().finally(() => process.exit(1));
  });
