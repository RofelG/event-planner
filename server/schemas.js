'use strict';

const { z } = require('zod');
const { ROLES } = require('./lib/policy');
const { decodeCursor } = require('./lib/cursor');

const name = (label, max = 100) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(255)
  .pipe(z.email('Enter a valid email address'));

// bcrypt ignores input past 72 bytes, so longer passwords are rejected rather
// than silently truncated.
const newPassword = z
  .string({ error: 'Password is required' })
  .min(10, 'Password must be at least 10 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');

const id = z.coerce.number().int().positive();
const idList = z.array(id).max(500).default([]).transform((ids) => [...new Set(ids)]);
const isoDate = (label) =>
  z.iso.datetime({ offset: true, error: `${label} must be a valid date and time` }).transform((s) => new Date(s));

const register = z.object({
  first: name('First name'),
  last: name('Last name'),
  email,
  password: newPassword,
});

const login = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(200),
});

const changePassword = z
  .object({
    current: z.string({ error: 'Current password is required' }).min(1, 'Current password is required').max(200),
    password: newPassword,
    confirm: z.string({ error: 'Please confirm the new password' }),
  })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Passwords do not match' });

// Unknown fields are dropped; add new account settings here.
const accountSettings = z.object({ hideName: z.boolean({ error: 'hideName must be true or false' }) });

const forgotPassword = z.object({ email });

const resetPassword = z
  .object({
    token: z.string({ error: 'The reset link is incomplete' }).min(1, 'The reset link is incomplete').max(200),
    password: newPassword,
    confirm: z.string({ error: 'Please confirm the new password' }),
  })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Passwords do not match' });

const event = z
  .object({
    name: name('Name', 200),
    description: z.string().trim().max(5000).optional().default(''),
    location: name('Location', 255),
    start: isoDate('Start'),
    end: isoDate('End'),
    capacity: z.coerce.number({ error: 'Capacity is required' }).int('Capacity must be a whole number').min(1, 'Capacity must be at least 1').max(100000),
    cost: z.coerce.number({ error: 'Cost is required' }).min(0, 'Cost cannot be negative').max(1000000).multipleOf(0.01, 'Cost can have at most two decimals'),
    typeId: z.coerce.number({ error: 'Choose an event type' }).int().positive('Choose an event type'),
    visibility: z.enum(['public', 'restricted']).default('public'),
    groupIds: idList,
    inviteIds: idList,
  })
  .refine((e) => e.end > e.start, { path: ['end'], message: 'End must be after the start' });

const eventQuery = z.object({
  type: id.optional(),
  q: z.string().trim().max(100).optional(),
  past: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  manageable: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  // Only events the caller has joined.
  mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  // Pagination: with `limit` the response is { items, nextCursor } instead of an array.
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z
    .string()
    .max(200)
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const decoded = decodeCursor(value);
      if (!decoded) {
        ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
        return z.NEVER;
      }
      return decoded;
    }),
});

// Demo mode: the name a visitor gives to join or create events.
const guest = z.object({
  name: name('Your name', 60).refine(
    (n) => /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(n),
    'Use letters, spaces, apostrophes, hyphens or periods'
  ),
});

const idParam = z.object({ id });

const group = z.object({ name: name('Group name') });

const userUpdate = z
  .object({
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    groupIds: z.array(id).max(500).transform((ids) => [...new Set(ids)]).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

module.exports = { register, login, changePassword, forgotPassword, resetPassword, accountSettings, event, eventQuery, guest, idParam, group, userUpdate };
