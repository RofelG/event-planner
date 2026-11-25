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

module.exports = { signIn, eventCard, waitForLive };
