'use strict';

/**
 * Demo-mode account conventions. Demo accounts use the reserved `.invalid`
 * domain (RFC 2606), so they can never collide with a real email address:
 *   host@demo.invalid           organizer of the showcase events
 *   bot-NNN@demo.invalid        simulated attendees
 *   guest-<random>@demo.invalid visitors who gave a name to join or create
 * None of them can sign in: they share a password hash whose secret is random
 * and never stored (see guestPasswordHash).
 */
const crypto = require('crypto');
const { hashPassword } = require('../lib/passwords');

const DOMAIN = '@demo.invalid';
const HOST_EMAIL = `host${DOMAIN}`;

const botEmail = (n) => `bot-${String(n).padStart(3, '0')}${DOMAIN}`;
const guestEmail = () => `guest-${crypto.randomBytes(12).toString('hex')}${DOMAIN}`;
const isGuestEmail = (email) => /^guest-[0-9a-f]+@demo\.invalid$/.test(email || '');

let unusableHash;
/** A bcrypt hash of a random, discarded secret: nobody can sign in with it. */
async function guestPasswordHash() {
  unusableHash ??= await hashPassword(crypto.randomBytes(32).toString('hex'));
  return unusableHash;
}

module.exports = { DOMAIN, HOST_EMAIL, botEmail, guestEmail, isGuestEmail, guestPasswordHash };
