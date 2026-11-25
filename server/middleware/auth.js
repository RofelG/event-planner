'use strict';

const users = require('../repositories/users');
const policy = require('../lib/policy');
const { COOKIE_NAME, verifyToken, setAuthCookie } = require('../lib/tokens');
const { unauthorized, forbidden } = require('../lib/errors');
const config = require('../config');

/**
 * Builds the session middleware.
 *   slide: false        never renew the cookie, for background requests (the
 *                       live stream) that must not keep an idle session alive.
 *   allowVisitor: true  in demo mode, a request without a valid session
 *                       continues as policy.VISITOR instead of getting 401.
 *                       Routes that change data must then use requireUser.
 */
function authenticateWith({ slide = true, allowVisitor = false } = {}) {
  const visitorsAllowed = allowVisitor && config.demo.enabled;
  return async (req, res, next) => {
    const user = await loadSession(req, res, slide);
    if (user instanceof Error) {
      if (!visitorsAllowed) return next(user);
      req.user = policy.VISITOR;
      return next();
    }
    req.user = user;
    next();
  };
}

/** Returns the signed-in principal, or an Error describing why there is none. */
async function loadSession(req, res, slide) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return unauthorized();

  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    return unauthorized('Session expired. Please sign in again.');
  }

  const user = await users.findActiveById(Number(claims.sub));
  // token_version changes on password change, revoking older tokens.
  if (!user || user.token_version !== claims.ver) {
    return unauthorized('Session expired. Please sign in again.');
  }

  // Sliding session: once half the lifetime has passed, issue a fresh token so
  // active users are not signed out mid-task, while idle sessions still expire.
  const remaining = claims.exp - Math.floor(Date.now() / 1000);
  if (slide && remaining < config.tokenTtlSeconds / 2) setAuthCookie(res, user);

  const principal = users.toPrincipal(user);
  principal.groupIds = await users.groupIdsFor(user.user_id);
  return principal;
}

/**
 * Requires a valid session cookie. On success sets req.user to
 * { id, first, last, email, role, isGuest, groupIds } loaded fresh from the database.
 */
const authenticate = authenticateWith();

/** Rejects demo visitors (no session) with 401, for routes that change data. */
function requireUser(req, res, next) {
  if (!req.user || policy.isVisitor(req.user)) {
    return next(unauthorized('Tell us your name to continue.'));
  }
  next();
}

/** Allows the request only if the signed-in user has one of the given roles. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || policy.isVisitor(req.user)) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

module.exports = { authenticate, authenticateWith, requireUser, requireRole };
