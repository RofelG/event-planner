'use strict';

const config = require('./config');
const app = require('./app');
const { pool } = require('./db/pool');

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (${config.env})`);
});

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
