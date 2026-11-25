'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE_NAME = 'token';

function signToken(user, ttlSeconds = config.tokenTtlSeconds) {
  // Only identifiers go in the token. Role and group membership are loaded from
  // the database on every request so permission changes apply immediately.
  return jwt.sign({ sub: String(user.user_id), ver: user.token_version }, config.tokenKey, {
    algorithm: 'HS256',
    expiresIn: ttlSeconds,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.tokenKey, { algorithms: ['HS256'] });
}

const cookieOptions = (ttlSeconds = config.tokenTtlSeconds) => ({
  httpOnly: true, // not readable from JavaScript, so XSS cannot steal it
  secure: config.isProduction, // HTTPS only in production
  sameSite: 'strict', // not sent on cross-site requests (CSRF protection)
  maxAge: ttlSeconds * 1000,
  path: '/',
});

/** ttlSeconds defaults to the normal session length; demo guests get longer. */
function setAuthCookie(res, user, ttlSeconds) {
  res.cookie(COOKIE_NAME, signToken(user, ttlSeconds), cookieOptions(ttlSeconds));
}

function clearAuthCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(COOKIE_NAME, opts);
}

module.exports = { COOKIE_NAME, signToken, verifyToken, setAuthCookie, clearAuthCookie };
