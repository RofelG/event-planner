'use strict';

const config = require('./config');
const app = require('./app');
const { pool } = require('./db/pool');
const live = require('./lib/live');
const demo = require('./demo');

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (${config.env})`);
  if (config.demo.enabled) {
    demo.start().catch((err) => console.error('Demo mode failed to start', err));
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
