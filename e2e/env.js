'use strict';

// Single place that loads .env and exposes the seeded demo accounts to the
// tests. Credentials are read here and never logged.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. The e2e tests sign in with the SEED_* accounts (see .env.example).`);
  return value;
};

const accounts = {
  admin: { email: need('SEED_ADMIN_EMAIL'), password: need('SEED_ADMIN_PASSWORD') },
  planner: { email: need('SEED_PLANNER_EMAIL'), password: need('SEED_PLANNER_PASSWORD') },
  user: { email: need('SEED_USER_EMAIL'), password: need('SEED_USER_PASSWORD') },
};

module.exports = { accounts };
