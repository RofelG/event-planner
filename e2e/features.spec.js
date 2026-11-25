'use strict';

const { test, expect } = require('@playwright/test');
const { signIn, eventCard, waitForLive, stamp, registerUser, createEvent, findEvent } = require('./helpers');

/** A second signed-in browser context, closed by the caller. */
async function openAs(browser, role) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return { context, page };
}

test.describe('waitlist', () => {
  test('an admin joins a full event\'s waitlist and gets the seat live when the member leaves', async ({ browser }) => {
    const name = `E2E Waitlist ${stamp()}`;
    const planner = await openAs(browser, 'planner');
    const member = await openAs(browser, 'user');
    const admin = await openAs(browser, 'admin');
    try {
      await createEvent(planner.page, { name, capacity: 1 });

      // The member takes the only seat.
      await member.page.reload();
      const memberCard = await findEvent(member.page, name);
      await memberCard.getByRole('button', { name: 'Join event' }).click();
      await expect(memberCard.getByText('You are going')).toBeVisible();

      // The admin sees a full event and joins the waitlist.
      await admin.page.reload();
      await waitForLive(admin.page);
      const adminCard = await findEvent(admin.page, name);
      await expect(adminCard.getByRole('button', { name: 'Join event' })).toHaveCount(0);
      await adminCard.getByRole('button', { name: 'Join waitlist' }).click();
      await expect(adminCard.getByText('You are number 1 on the waitlist')).toBeVisible();

      // The member leaves; the admin's open page gets the seat without a reload.
      await memberCard.getByRole('button', { name: 'Leave event' }).click();
      await expect(memberCard.getByText('You are going')).toHaveCount(0);
      await expect(adminCard.getByText('You are going')).toBeVisible();
      await expect(adminCard.getByText('You are number 1 on the waitlist')).toHaveCount(0);
      await expect(admin.page.getByText(`A seat opened up. You are now registered for ${name}.`)).toBeVisible();
    } finally {
      await Promise.all([planner.context.close(), member.context.close(), admin.context.close()]);
    }
  });
});

test.describe('calendar', () => {
  test('a registered member can download the event as an iCalendar file', async ({ page }) => {
    const name = `E2E Calendar ${stamp()}`;
    const planner = await openAs(page.context().browser(), 'planner');
    try {
      await createEvent(planner.page, { name });
    } finally {
      await planner.context.close();
    }

    await signIn(page, 'user');
    const card = await findEvent(page, name);
    await expect(card.getByRole('link', { name: 'Add to calendar' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Join event' }).click();
    await expect(card.getByText('You are going')).toBeVisible();

    const href = await card.getByRole('link', { name: 'Add to calendar' }).getAttribute('href');
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/calendar');
    expect(await response.text()).toMatch(new RegExp(`^SUMMARY:${name}\\s*$`, 'm'));
  });
});

test.describe('privacy', () => {
  test('a member who hides their name shows as Private attendee to other members', async ({ page, browser }) => {
    const name = `E2E Privacy ${stamp()}`;
    const planner = await openAs(browser, 'planner');
    try {
      await createEvent(planner.page, { name });
    } finally {
      await planner.context.close();
    }

    // A throwaway member hides their name and joins.
    const hider = await registerUser(page, 'Hidden');
    await page.getByRole('button', { name: new RegExp(hider.first) }).click();
    await page.getByRole('menuitem', { name: 'Account settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Account settings' });
    await settings.getByLabel('Hide my name in attendee lists').check();
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(settings).toBeHidden();

    const ownCard = await findEvent(page, name);
    await ownCard.getByRole('button', { name: 'Join event' }).click();
    await expect(ownCard.getByText('You are going')).toBeVisible();

    // The hider still sees their own name.
    await ownCard.getByRole('button', { name: 'View attendees' }).click();
    const ownList = page.getByRole('dialog', { name: 'Who is attending' });
    await expect(ownList.getByText(hider.fullName)).toBeVisible();
    await expect(ownList.getByText('Private attendee')).toHaveCount(0);

    // Another member, who does not manage the event, sees a placeholder.
    const other = await openAs(browser, 'user');
    try {
      const otherCard = await findEvent(other.page, name);
      await otherCard.getByRole('button', { name: 'View attendees' }).click();
      const list = other.page.getByRole('dialog', { name: 'Who is attending' });
      await expect(list.getByText('Private attendee')).toBeVisible();
      await expect(list.getByText(hider.fullName)).toHaveCount(0);
      await expect(list.getByText(hider.last)).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  });
});

test.describe('moderation', () => {
  test('an admin hides an event from members and unhides it', async ({ browser }) => {
    const name = `E2E Moderation ${stamp()}`;
    const planner = await openAs(browser, 'planner');
    const admin = await openAs(browser, 'admin');
    const member = await openAs(browser, 'user');
    try {
      await createEvent(planner.page, { name });

      await admin.page.reload();
      const adminCard = await findEvent(admin.page, name);
      await expect(adminCard.getByText('Hidden', { exact: true })).toHaveCount(0);
      await adminCard.getByRole('button', { name: 'Hide', exact: true }).click();
      const confirm = admin.page.getByRole('dialog', { name: 'Hide this event?' });
      await confirm.getByRole('button', { name: 'Hide event' }).click();
      await expect(adminCard.getByText('Hidden', { exact: true })).toBeVisible();

      await member.page.reload();
      await member.page.getByLabel('Search events').fill(name);
      await expect(member.page.getByRole('heading', { name: 'Event catalogue' })).toBeVisible();
      await expect(eventCard(member.page, name)).toHaveCount(0);

      await adminCard.getByRole('button', { name: 'Unhide' }).click();
      await expect(adminCard.getByText('Hidden', { exact: true })).toHaveCount(0);

      await member.page.reload();
      const memberCard = await findEvent(member.page, name);
      await expect(memberCard).toBeVisible();
    } finally {
      await Promise.all([planner.context.close(), admin.context.close(), member.context.close()]);
    }
  });
});
