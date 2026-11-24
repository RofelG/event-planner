'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE_NAME = 'token';

function signToken(user) {
  // Only identifiers go in the token. Role and group membership are loaded from
  // the database on every request so permission changes apply immediately.
  return jwt.sign({ sub: String(user.user_id), ver: user.token_version }, config.tokenKey, {
    algorithm: 'HS256',
    expiresIn: config.tokenTtlSeconds,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.tokenKey, { algorithms: ['HS256'] });
}

const cookieOptions = () => ({
  httpOnly: true, // not readable from JavaScript, so XSS cannot steal it
  secure: config.isProduction, // HTTPS only in production
  sameSite: 'strict', // not sent on cross-site requests (CSRF protection)
  maxAge: config.tokenTtlSeconds * 1000,
  path: '/',
});

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
}

function clearAuthCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(COOKIE_NAME, opts);
}

module.exports = { COOKIE_NAME, signToken, verifyToken, setAuthCookie, clearAuthCookie };
