'use strict';

/**
 * Access-control policy. Every permission decision in the API goes through
 * these pure functions so the rules live in one place and are unit tested.
 *
 * user:  { id, role: 'user' | 'planner' | 'admin' | 'visitor', groupIds: number[] }
 * event: { organizerId, visibility: 'public' | 'restricted',
 *          groupIds: number[], inviteIds: number[], end: Date | string,
 *          attendeeCount, capacity, isRegistered }
 *
 * Demo mode (DEMO_MODE=true) adds two things:
 *   - visitors: people browsing without a session. They are VISITOR below and
 *     see public events only (they are in no group and on no invite list).
 *   - every signed-in user may create public events and manage their own.
 */

const config = require('../config');

const ROLES = Object.freeze(['user', 'planner', 'admin']);

/** Demo-mode principal for requests without a session. Never matches a user id. */
const VISITOR = Object.freeze({ id: 0, role: 'visitor', groupIds: Object.freeze([]), isVisitor: true });

const isAdmin = (user) => user.role === 'admin';
const isPlanner = (user) => user.role === 'planner' || isAdmin(user);
const isVisitor = (user) => user.role === 'visitor';
const demoMode = () => config.demo.enabled;

/**
 * Planners and admins can open the event-planning side and create events. In
 * demo mode anyone signed in (including a named guest) can create public ones.
 */
function canCreateEvent(user) {
  if (isPlanner(user)) return true;
  return demoMode() && !isVisitor(user);
}

/** Only planners and admins choose restricted audiences (groups, invitees). */
function canRestrictEvent(user) {
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
  // Demo mode: anyone who created an event may edit or delete it.
  if (demoMode() && !isVisitor(user) && event.organizerId === user.id) return true;
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

/**
 * Whether the viewer may see this attendee's real name and id in an attendee
 * list. People who chose to hide their name are visible only to themselves and
 * to those who manage the event (organizer, planner in a shared group, admin).
 * attendee: { id, hideName }
 */
function canSeeAttendeeName(viewer, event, attendee) {
  if (!attendee.hideName) return true;
  if (!isVisitor(viewer) && viewer.id === attendee.id) return true;
  return canManageEvent(viewer, event);
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
  VISITOR,
  isAdmin,
  isPlanner,
  isVisitor,
  canCreateEvent,
  canRestrictEvent,
  canViewEvent,
  canManageEvent,
  canJoinEvent,
  canLeaveEvent,
  canSeeAttendeeName,
  hasEnded,
  eventPermissions,
};
