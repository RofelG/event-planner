'use strict';

const events = require('../repositories/events');
const policy = require('./policy');
const { serializeEvent } = require('./serialize');

/**
 * Live catalogue updates over Server-Sent Events.
 *
 * Each open stream is a signed-in user. When an event changes (seat taken or
 * freed, created, edited, deleted), every stream receives that event as its
 * user would see it from the REST API, after the same ACL check:
 *   - `event`  the user can see the event: the full serialized event.
 *   - `remove` the user could see it before but no longer can (deleted, or the
 *              audience changed), so the client drops it.
 * Users who could not see the event before or after receive nothing, so hidden
 * events never leak through the stream, not even as an id or a seat count.
 *
 * The hub lives in this process's memory. Running several API processes would
 * need a shared channel (for example Redis pub/sub) to fan changes out.
 */

// Streams are closed periodically so the browser reconnects and the user's
// role, groups and session are re-checked by the authenticate middleware.
const MAX_STREAM_MS = 5 * 60 * 1000;
// A named `ping` event (not an SSE comment, which browsers never surface) so
// the client can tell a quiet stream from a dead one. Keep in sync with
// STALE_MS in client/src/lib/live.js.
const HEARTBEAT_MS = 15 * 1000;

const clients = new Set();

function send(client, type, data) {
  client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Express handler for GET /api/events/stream. Requires req.user. */
function stream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops reverse proxies such as nginx from buffering the stream.
    'X-Accel-Buffering': 'no',
  });
  // Reconnect delay used by EventSource after a dropped connection.
  res.write('retry: 3000\n\n');

  const client = { user: req.user, res };
  clients.add(client);
  send(client, 'ready', { at: new Date().toISOString() });

  // Keeps idle connections open through proxies and proves to the client that
  // the stream is still alive.
  const heartbeat = setInterval(() => send(client, 'ping', {}), HEARTBEAT_MS);
  const expiry = setTimeout(() => res.end(), MAX_STREAM_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    clients.delete(client);
  };
  res.on('close', cleanup);
}

/**
 * Broadcasts a change to one event. `before` is the event as it was before the
 * change (needed to tell who should be told it disappeared); omit it for
 * creates. Call after the change is committed. Never throws.
 */
async function eventChanged(eventId, before) {
  if (clients.size === 0) return;
  try {
    // Loaded once for everyone; viewer 0 matches no user, so isRegistered is
    // filled in per client from the attendee list below.
    const after = await events.findById(0, eventId);
    const attendeeIds = after ? new Set((await events.attendees(eventId)).map((r) => r.user_id)) : new Set();

    for (const client of clients) {
      const { user } = client;
      if (after && policy.canViewEvent(user, after)) {
        send(client, 'event', serializeEvent(user, { ...after, isRegistered: attendeeIds.has(user.id) }));
      } else if (before && policy.canViewEvent(user, before)) {
        send(client, 'remove', { id: eventId });
      }
    }
  } catch (err) {
    console.error('Live update failed', err);
  }
}

/** Ends every open stream, so the HTTP server can shut down. */
function closeAll() {
  for (const client of clients) client.res.end();
}

module.exports = { stream, eventChanged, closeAll, clientCount: () => clients.size };
