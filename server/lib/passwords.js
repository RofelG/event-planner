'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config');

// bcrypt generates a unique random salt for every hash and stores it inside
// the 60-character hash string, so hashes of identical passwords differ and no
// separate salt column is needed. bcrypt only reads the first 72 bytes of
// input, which is why validation caps password length at 72 bytes.
async function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// A valid hash used when the email does not exist, so a failed login takes the
// same time whether or not the account exists (prevents user enumeration).
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', config.bcryptRounds);

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };
