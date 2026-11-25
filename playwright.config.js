'use strict';

const { defineConfig, devices } = require('@playwright/test');
require('dotenv').config({ quiet: true });
const { e2eDatabase } = require('./e2e/database');

// Off the default dev ports (3001, 5173) so the tests never collide with a
// running `npm run dev`.
const API_PORT = 3101;
const WEB_PORT = 5273;
// The database the run resets and seeds: event_planner_e2e for the usual .env,
// never the development database itself.
const DB_DB = e2eDatabase();

module.exports = defineConfig({
  testDir: './e2e',
  // The tests share one seeded database, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Reset and seed the e2e database first, so the API never runs while
      // its tables are being dropped (see e2e/reset-db.js).
      command: 'node e2e/reset-db.js && node server/index.js',
      // Any answer below 500 (including 401 without a session) shows the API is up.
      url: `http://localhost:${API_PORT}/api/types`,
      reuseExistingServer: false,
      env: { API_PORT: String(API_PORT), PORT: String(API_PORT), NODE_ENV: 'development', DB_DB },
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_PORT: String(API_PORT) },
      timeout: 60_000,
    },
  ],
});
