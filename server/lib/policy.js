'use strict';

/**
 * Access-control policy. Every permission decision in the API goes through
 * these pure functions so the rules live in one place and are unit tested.
 *
 * user:  { id, role: 'user' | 'planner' | 'admin', groupIds: number[] }
 * event: { organizerId, visibility: 'public' | 'restricted',
 *          groupIds: number[], inviteIds: number[], end: Date | string,
 *          attendeeCount, capacity, isRegistered }
 */

const ROLES = Object.freeze(['user', 'planner', 'admin']);

const isAdmin = (user) => user.role === 'admin';
const isPlanner = (user) => user.role === 'planner' || isAdmin(user);

/** Planners and admins can open the event-planning side and create events. */
function canCreateEvent(user) {
  return isPlanner(user);
}

/**
 * Whether the user may see the event at all (catalogue, detail, attendees,
 * joining). Hidden events are reported as 404 so their existence is not leaked.
 */
function canViewEvent(user, event) {
  if (isAdmin(user)) return true;
  if (event.organizerId === user.id) return true;
  if (event.visibility === 'public') return true;

  // Restricted: visible to individually invited users and to members of any
  // group the event is shared with.
  if (event.inviteIds.includes(user.id)) return true;
  return event.groupIds.some((groupId) => user.groupIds.includes(groupId));
}

/** Whether the user may edit or delete the event. */
function canManageEvent(user, event) {
  if (isAdmin(user)) return true;
  // Only planners manage events; a demoted user loses control of events they organized.
  if (!isPlanner(user)) return false;
  // Planners manage events they organize, plus events shared with a group they
  // belong to, so a team (e.g. the "Volleyball" planners) can co-manage its events.
  if (event.organizerId === user.id) return true;
  return event.groupIds.some((groupId) => user.groupIds.includes(groupId));
}

const hasEnded = (event) => new Date(event.end).getTime() <= Date.now();

function canJoinEvent(user, event) {
  return (
    canViewEvent(user, event) &&
    !event.isRegistered &&
    !hasEnded(event) &&
    event.attendeeCount < event.capacity
  );
}

function canLeaveEvent(user, event) {
  return canViewEvent(user, event) && event.isRegistered && !hasEnded(event);
}

/** The permissions object sent to the client so it can show or hide controls. */
function eventPermissions(user, event) {
  const manage = canManageEvent(user, event);
  return {
    edit: manage,
    delete: manage,
    join: canJoinEvent(user, event),
    leave: canLeaveEvent(user, event),
  };
}

module.exports = {
  ROLES,
  isAdmin,
  isPlanner,
  canCreateEvent,
  canViewEvent,
  canManageEvent,
  canJoinEvent,
  canLeaveEvent,
  hasEnded,
  eventPermissions,
};
