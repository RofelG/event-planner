'use strict';

const users = require('../repositories/users');
const { COOKIE_NAME, verifyToken, setAuthCookie } = require('../lib/tokens');
const { unauthorized, forbidden } = require('../lib/errors');
const config = require('../config');

/**
 * Builds the session middleware. With { slide: false } the cookie is never
 * renewed, for background requests (the live stream) that must not keep an
 * idle session alive.
 */
function authenticateWith({ slide = true } = {}) {
  return (req, res, next) => authenticate(req, res, next, slide);
}

/**
 * Requires a valid session cookie. On success sets req.user to
 * { id, first, last, email, role, groupIds } loaded fresh from the database.
 */
async function authenticate(req, res, next, slide = true) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return next(unauthorized());

  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    return next(unauthorized('Session expired. Please sign in again.'));
  }

  const user = await users.findActiveById(Number(claims.sub));
  // token_version changes on password change, revoking older tokens.
  if (!user || user.token_version !== claims.ver) {
    return next(unauthorized('Session expired. Please sign in again.'));
  }

  // Sliding session: once half the lifetime has passed, issue a fresh token so
  // active users are not signed out mid-task, while idle sessions still expire.
  const remaining = claims.exp - Math.floor(Date.now() / 1000);
  if (slide && remaining < config.tokenTtlSeconds / 2) setAuthCookie(res, user);

  req.user = users.toPrincipal(user);
  req.user.groupIds = await users.groupIdsFor(user.user_id);
  next();
}

/** Allows the request only if the signed-in user has one of the given roles. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

module.exports = { authenticate, authenticateWith, requireRole };
