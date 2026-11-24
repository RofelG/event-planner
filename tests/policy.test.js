'use strict';

process.env.NODE_ENV = 'test';
const policy = require('../server/lib/policy');

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

const user = (over = {}) => ({ id: 10, role: 'user', groupIds: [], ...over });
const event = (over = {}) => ({
  organizerId: 1,
  visibility: 'public',
  groupIds: [],
  inviteIds: [],
  end: future,
  attendeeCount: 0,
  capacity: 10,
  isRegistered: false,
  ...over,
});

describe('canCreateEvent', () => {
  test.each([
    ['user', false],
    ['planner', true],
    ['admin', true],
  ])('%s -> %s', (role, expected) => {
    expect(policy.canCreateEvent(user({ role }))).toBe(expected);
  });
});

describe('canViewEvent', () => {
  test('anyone can see a public event', () => {
    expect(policy.canViewEvent(user(), event())).toBe(true);
  });

  test('a restricted event is hidden from users outside its audience', () => {
    expect(policy.canViewEvent(user(), event({ visibility: 'restricted', groupIds: [5], inviteIds: [99] }))).toBe(false);
  });

  test('group members can see a restricted event shared with their group', () => {
    expect(policy.canViewEvent(user({ groupIds: [5] }), event({ visibility: 'restricted', groupIds: [5] }))).toBe(true);
  });

  test('invited users can see a restricted event', () => {
    expect(policy.canViewEvent(user(), event({ visibility: 'restricted', inviteIds: [10] }))).toBe(true);
  });

  test('the organizer always sees their own event', () => {
    expect(policy.canViewEvent(user({ id: 1, role: 'planner' }), event({ visibility: 'restricted' }))).toBe(true);
  });

  test('a planner who is not in the audience cannot see a restricted event', () => {
    expect(policy.canViewEvent(user({ role: 'planner' }), event({ visibility: 'restricted', groupIds: [5] }))).toBe(false);
  });

  test('admins see everything', () => {
    expect(policy.canViewEvent(user({ role: 'admin' }), event({ visibility: 'restricted' }))).toBe(true);
  });
});

describe('canManageEvent', () => {
  test('regular users cannot manage, even an event they organized before a demotion', () => {
    expect(policy.canManageEvent(user({ id: 1 }), event())).toBe(false);
  });

  test('planners manage only events they organize', () => {
    expect(policy.canManageEvent(user({ id: 1, role: 'planner' }), event())).toBe(true);
    expect(policy.canManageEvent(user({ id: 2, role: 'planner' }), event())).toBe(false);
  });

  test('planners manage events shared with a group they belong to', () => {
    const volleyballEvent = event({ visibility: 'restricted', groupIds: [7] });
    expect(policy.canManageEvent(user({ id: 2, role: 'planner', groupIds: [7] }), volleyballEvent)).toBe(true);
    expect(policy.canManageEvent(user({ id: 2, role: 'planner', groupIds: [8] }), volleyballEvent)).toBe(false);
  });

  test('group membership does not let regular users manage events', () => {
    expect(policy.canManageEvent(user({ groupIds: [7] }), event({ visibility: 'restricted', groupIds: [7] }))).toBe(false);
  });

  test('admins manage any event', () => {
    expect(policy.canManageEvent(user({ role: 'admin' }), event())).toBe(true);
  });
});

describe('join and leave', () => {
  test('can join an open, visible, upcoming event', () => {
    expect(policy.canJoinEvent(user(), event())).toBe(true);
  });

  test('cannot join when full, already registered, ended, or hidden', () => {
    expect(policy.canJoinEvent(user(), event({ attendeeCount: 10 }))).toBe(false);
    expect(policy.canJoinEvent(user(), event({ isRegistered: true }))).toBe(false);
    expect(policy.canJoinEvent(user(), event({ end: past }))).toBe(false);
    expect(policy.canJoinEvent(user(), event({ visibility: 'restricted' }))).toBe(false);
  });

  test('can leave only when registered and the event has not ended', () => {
    expect(policy.canLeaveEvent(user(), event({ isRegistered: true }))).toBe(true);
    expect(policy.canLeaveEvent(user(), event())).toBe(false);
    expect(policy.canLeaveEvent(user(), event({ isRegistered: true, end: past }))).toBe(false);
  });
});
