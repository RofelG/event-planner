'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const isTest = process.env.NODE_ENV === 'test';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || process.env.API_PORT || 3001),
  tokenKey: required('TOKEN_KEY'),
  // PROJECT.md: authentication tokens expire after 15 minutes. Active sessions
  // are re-issued a fresh token by the auth middleware (sliding expiry).
  tokenTtlSeconds: 15 * 60,
  bcryptRounds: isTest ? 4 : 12,
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: required('DB_PASS'),
    // Tests run against an isolated <DB_DB>_test database created by docker compose.
    database: isTest ? `${required('DB_DB')}_test` : required('DB_DB'),
  },
  // Public demo: visitors browse without an account, give a name to join or
  // create events, and their events are removed after ttlHours. Showcase
  // events with simulated attendees keep the catalogue busy. See README.
  demo: {
    enabled: process.env.DEMO_MODE === 'true',
    ttlHours: Number(process.env.DEMO_EVENT_TTL_HOURS || 48),
    // Simulated attendees joining and leaving showcase events (off in tests).
    simulate: process.env.DEMO_SIMULATE !== 'false' && !isTest,
  },
};

if (!(config.demo.ttlHours > 0)) {
  throw new Error('DEMO_EVENT_TTL_HOURS must be a positive number.');
}

if (config.tokenKey.length < 32) {
  throw new Error('TOKEN_KEY must be at least 32 characters.');
}

module.exports = config;
