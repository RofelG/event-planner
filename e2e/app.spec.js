'use strict';

const { test, expect } = require('@playwright/test');
const { signIn, eventCard, waitForLive } = require('./helpers');

test.describe('authentication', () => {
  test('signing in lands on the catalogue and signing out returns to sign-in', async ({ page }) => {
    await signIn(page, 'user');
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: /Jordan/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('access control', () => {
  test('a member does not see management links and gets the no-access page', async ({ page }) => {
    await signIn(page, 'user');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Manage Events' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Users and Groups' })).toHaveCount(0);

    await page.goto('/manage');
    await expect(page.getByText('You do not have access to this page')).toBeVisible();
  });

  test('a restricted event is hidden from a member but visible to a staff planner', async ({ page, browser }) => {
    await signIn(page, 'user');
    await expect(eventCard(page, 'Annual Community Meetup')).toBeVisible();
    await expect(eventCard(page, 'Staff Planning Session')).toHaveCount(0);

    const plannerContext = await browser.newContext();
    const plannerPage = await plannerContext.newPage();
    await signIn(plannerPage, 'planner');
    await expect(eventCard(plannerPage, 'Staff Planning Session')).toBeVisible();
    await plannerContext.close();
  });
});

test.describe('events', () => {
  test('a planner creates an event and it appears in the catalogue', async ({ page }) => {
    const name = `E2E Planning Brunch ${Date.now()}`;
    await signIn(page, 'planner');

    await page.getByRole('button', { name: 'Create event' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create an event' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Event name').fill(name);
    await dialog.getByLabel('Event type').selectOption({ label: 'Social' });
    // Far enough ahead to be valid in any time zone.
    const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const end = new Date(start.getTime() + 2 * 3600 * 1000);
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await dialog.getByLabel('Starts').fill(local(start));
    await dialog.getByLabel('Ends').fill(local(end));
    await dialog.getByLabel('Location').fill('Test Kitchen');
    await dialog.getByLabel('Capacity').fill('10');
    await dialog.getByLabel('Cost (USD)').fill('0');
    await dialog.getByRole('button', { name: 'Create event' }).click();

    await expect(dialog).toBeHidden();
    // Search narrows the list, so the new card is found even on a long catalogue.
    await page.getByLabel('Search events').fill(name);
    await expect(eventCard(page, name)).toBeVisible();
  });

  test('a member joins and then leaves an event', async ({ page }) => {
    await signIn(page, 'user');
    const card = eventCard(page, 'Charity Volleyball Tournament');
    await expect(card.getByText('You are going')).toHaveCount(0);

    await card.getByRole('button', { name: 'Join event' }).click();
    await expect(card.getByText('You are going')).toBeVisible();

    await card.getByRole('button', { name: 'Leave event' }).click();
    await expect(card.getByText('You are going')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Join event' })).toBeVisible();
  });

  test('seat counts update live in another user\'s open catalogue', async ({ page, browser }) => {
    const eventName = 'Intro to Event Logistics';
    await signIn(page, 'user');
    const watcherCard = eventCard(page, eventName);
    await expect(watcherCard.getByText(/\d+ of 25 seats taken/)).toBeVisible();
    await waitForLive(page);
    const before = Number((await watcherCard.getByText(/\d+ of 25 seats taken/).innerText()).match(/^(\d+)/)[1]);

    const plannerContext = await browser.newContext();
    const plannerPage = await plannerContext.newPage();
    try {
      await signIn(plannerPage, 'planner');
      const plannerCard = eventCard(plannerPage, eventName);
      await plannerCard.getByRole('button', { name: 'Join event' }).click();
      await expect(plannerCard.getByText('You are going')).toBeVisible();

      // No reload on the watcher's page: the count arrives over the live stream.
      await expect(watcherCard.getByText(`${before + 1} of 25 seats taken`)).toBeVisible();

      await plannerCard.getByRole('button', { name: 'Leave event' }).click();
      await expect(watcherCard.getByText(`${before} of 25 seats taken`)).toBeVisible();
    } finally {
      await plannerContext.close();
    }
  });
});

test.describe('theme', () => {
  test('the theme button cycles System, Light, Dark and the choice survives a reload', async ({ page }) => {
    await signIn(page, 'user');
    const html = page.locator('html');
    const toggle = (mode) => page.getByRole('button', { name: new RegExp(`^Theme: ${mode}\\.`) });

    await expect(toggle('System')).toBeVisible();
    await toggle('System').click();
    await expect(toggle('Light')).toBeVisible();
    await expect(html).not.toHaveClass(/\bdark\b/);

    await toggle('Light').click();
    await expect(toggle('Dark')).toBeVisible();
    await expect(html).toHaveClass(/\bdark\b/);

    await page.reload();
    await expect(toggle('Dark')).toBeVisible();
    await expect(html).toHaveClass(/\bdark\b/);

    await toggle('Dark').click();
    await expect(toggle('System')).toBeVisible();
  });
});
