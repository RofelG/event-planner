'use strict';

const { expect } = require('@playwright/test');
const { accounts } = require('./env');

/** Signs in through the sign-in form and waits for the catalogue. */
async function signIn(page, role) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(accounts[role].email);
  await page.getByLabel('Password').fill(accounts[role].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Event catalogue' })).toBeVisible();
}

/** The catalogue card for an event, found by its heading. */
const eventCard = (page, name) => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

/** Waits until the live stream is connected, so later changes are pushed. */
const waitForLive = (page) => expect(page.getByText('Live', { exact: true })).toBeVisible();

/** A value that is unique per call, so tests never collide on shared seeded data. */
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/**
 * Registers a throwaway member through the sign-up form and lands on the
 * catalogue. Returns the details the test needs to find or reuse the account.
 */
async function registerUser(page, label = 'Tester') {
  const id = stamp();
  const user = {
    first: 'Throwaway',
    last: `${label}${id}`,
    email: `e2e-${id}@example.test`,
    password: `Throwaway-${id}-pw1`,
  };
  user.fullName = `${user.first} ${user.last}`;
  await page.goto('/register');
  await page.getByLabel('First name').fill(user.first);
  await page.getByLabel('Last name').fill(user.last);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Event catalogue' })).toBeVisible();
  return user;
}

/**
 * Creates a public event through the API as the signed-in user of `page`
 * (a planner or admin). Returns the created event.
 */
async function createEvent(page, { name, capacity = 10 }) {
  const typesResponse = await page.request.get('/api/types');
  expect(typesResponse.status()).toBe(200);
  const types = await typesResponse.json();
  const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 2 * 3600 * 1000);
  const response = await page.request.post('/api/events', {
    data: {
      name,
      description: '',
      location: 'E2E Hall',
      start: start.toISOString(),
      end: end.toISOString(),
      capacity,
      cost: 0,
      typeId: types[0].id,
      visibility: 'public',
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

/** Narrows the catalogue to one event by searching for its name; returns its card. */
async function findEvent(page, name) {
  await page.getByLabel('Search events').fill(name);
  return eventCard(page, name);
}

module.exports = { signIn, eventCard, waitForLive, stamp, registerUser, createEvent, findEvent };
