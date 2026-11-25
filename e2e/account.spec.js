'use strict';

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mysql = require('mysql2/promise');
const { test, expect } = require('@playwright/test');
const { registerUser, stamp } = require('./helpers');
const { e2eDatabase } = require('./database');

/** Inserts a reset token (only its hash is stored, as the API does) for the user with this email. */
async function insertResetToken(email, token) {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: e2eDatabase(),
  });
  try {
    const [[user]] = await connection.query('SELECT user_id FROM `user` WHERE user_email = ?', [email]);
    expect(user, 'the registered user exists in the e2e database').toBeTruthy();
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await connection.query(
      'INSERT INTO password_reset (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
      [hash, user.user_id]
    );
  } finally {
    await connection.end();
  }
}

test.describe('password reset', () => {
  test('the forgot page shows the same confirmation for any email', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(`nobody-${stamp()}@example.test`);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('If an account exists for that email, a reset link is on its way.')).toBeVisible();
  });

  test('a reset link sets a new password once and then reports an invalid link', async ({ page, browser }) => {
    const user = await registerUser(page, 'Reset');
    const token = crypto.randomBytes(32).toString('hex');
    await insertResetToken(user.email, token);

    // A clean browser: the link is opened signed out, as from an email.
    const context = await browser.newContext();
    const reset = await context.newPage();
    try {
      const newPassword = `Fresh-${stamp()}-pw2`;
      await reset.goto(`/reset-password?token=${token}`);
      await reset.getByLabel(/^New password/).fill(newPassword);
      await reset.getByLabel('Confirm new password').fill(newPassword);
      await reset.getByRole('button', { name: 'Change password' }).click();

      await expect(reset).toHaveURL(/\/login$/);
      await expect(reset.getByText('Your password was changed. Sign in with your new password.')).toBeVisible();
      await reset.getByLabel('Email').fill(user.email);
      await reset.getByLabel('Password').fill(newPassword);
      await reset.getByRole('button', { name: 'Sign in' }).click();
      await expect(reset.getByRole('heading', { name: 'Event catalogue' })).toBeVisible();

      // The same link cannot be used twice.
      await reset.goto(`/reset-password?token=${token}`);
      const another = `Other-${stamp()}-pw3`;
      await reset.getByLabel(/^New password/).fill(another);
      await reset.getByLabel('Confirm new password').fill(another);
      await reset.getByRole('button', { name: 'Change password' }).click();
      await expect(reset.getByRole('alert')).toBeVisible();
      await expect(reset.getByRole('link', { name: 'Request a new link' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test.describe('account deletion', () => {
  test('a member deletes their account after confirming with their password', async ({ page }) => {
    const user = await registerUser(page, 'Delete');

    await page.getByRole('button', { name: new RegExp(user.first) }).click();
    await page.getByRole('menuitem', { name: 'Account settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Account settings' });
    await settings.getByRole('button', { name: 'Delete my account' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete your account?' });
    await expect(confirm).toBeVisible();

    // Escape closes only the confirmation.
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(settings).toBeVisible();

    await settings.getByRole('button', { name: 'Delete my account' }).click();
    await expect(confirm).toBeVisible();

    // A wrong password is refused and the dialog stays open.
    await confirm.getByLabel('Confirm with your password').fill('Wrong-password-1');
    await confirm.getByRole('button', { name: 'Delete my account' }).click();
    await expect(confirm.getByText('Password is incorrect')).toBeVisible();
    await expect(confirm).toBeVisible();

    // The right password deletes the account and signs out.
    await confirm.getByLabel('Confirm with your password').fill(user.password);
    await confirm.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // The account is gone.
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
