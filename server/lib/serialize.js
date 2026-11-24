'use strict';

const policy = require('./policy');

/**
 * Client-facing shape of an event for one user. Audience details (groupIds,
 * inviteIds) are only included for people who manage the event. Shared by the
 * REST routes and the live stream so both send exactly the same data.
 */
function serializeEvent(user, event) {
  const permissions = policy.eventPermissions(user, event);
  const { organizerId, groupIds, inviteIds, ...rest } = event;
  return {
    ...rest,
    isFull: event.attendeeCount >= event.capacity,
    ...(permissions.edit ? { groupIds, inviteIds } : {}),
    permissions,
  };
}

module.exports = { serializeEvent };
