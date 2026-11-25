# Architecture Document

## Overview
This project uses a decoupled Client-Server architecture designed for scalability and modern web performance. The application follows a Single Page Application (SPA) pattern.

## Architecture Pattern
The application follows a **Single Page Application (SPA)** pattern with a clear separation between the presentation layer and the business logic layer.

### 1. Frontend (Client)
- **Framework:** React (managed by Vite)
- **Styling:** Tailwind CSS (Utility-first) and SCSS (for advanced component-level styling)
- **Build Tool:** Vite
- **Responsibilities:**
  - User Interface (UI) and User Experience (UX) logic.
  - Client-side routing (if applicable).
  - Data fetching from the Backend API via standard `fetch`.
  - Local state management using React Hooks.

### 2. Backend (Server)
- **Framework:** Express.js
- **Responsibilities:**
  - Serving as a RESTful API.
  - Providing data and configuration as JSON.
  - Handling authentication and business logic.
  - Managing data persistence.

## Communication
The Client communicates with the Server via **RESTful API** calls. All data is exchanged in **JSON** format.

Live catalogue updates (seats taken, events created, edited or deleted) flow one way, from server to browser, over **Server-Sent Events** (see [Live updates](#live-updates)). All writes still go through the REST API.

## Data Flow
1. The React application initializes and fetches configuration from the API.
2. React components request data from specific RESTful endpoints.
3. The Express backend processes the request, interacts with the data layer, and returns a JSON response.
4. The Frontend updates its state and re-renders the UI based on the received data.

## Deployment
- The application is built using Vite into a production-ready `dist` folder.
- The Express server serves the static assets from the `dist` directory in production.

## Implementation

### Project layout
```
client/                 React SPA (Vite root)
  src/components/ui/    Atomic components: Button, Field inputs, Modal, Feedback
  src/components/       Composed components: NavBar, EventCard, AttendeesModal,
                        EventEditorModal, ThemeToggle, LiveIndicator
  src/context/          AuthContext (session + role), ToastContext, ThemeContext
  src/hooks/            useApi (GET + loading/error), useEventActions, useLiveEvents
  src/lib/              api (fetch wrapper), live (shared EventSource), liveMerge, theme
  src/pages/            Route pages
  src/styles/           app.scss (Tailwind directives, animations), _tokens.scss (palette)
server/
  app.js                Express app (exported for Supertest)
  index.js              Starts the HTTP server
  config.js             Validated environment configuration
  db/                   Pool, migration runner and migrations/, seed script
  demo/                 Demo mode: accounts, showcase data, simulation and cleanup
  lib/policy.js         All access-control rules (pure functions)
  lib/logger.js         Shared pino logger (JSON in production, pretty in development)
  lib/live.js           Live update hub: open streams and per-user fan-out
  lib/serialize.js      Event response shape, shared by REST and the stream
  middleware/           authenticate, requireRole, validate (zod)
  repositories/         Parameterized SQL per resource
  routes/               REST handlers
  schemas.js            Request validation schemas
tests/                  Jest unit (policy) and Supertest integration tests
```

### REST API
All bodies are JSON. Errors are `{ "error": string, "fields"?: { [field]: string } }`.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Public | Creates a `user`-role account and signs in (201) |
| POST | `/api/auth/login` | Public | Sets the session cookie |
| POST | `/api/auth/logout` | Public | Clears the session cookie (204) |
| GET | `/api/auth/me` | Signed in | Current user, role and group ids |
| PUT | `/api/auth/password` | Signed in | Revokes all other sessions (204) |
| PUT | `/api/auth/settings` | Signed in (guests too, not visitors) | `{ hideName }`; returns the updated user |
| DELETE | `/api/auth/account` | Signed in (guests too, not visitors) | `{ password }`, or `{ confirm: true }` for demo guests; anonymizes the account and hands upcoming events to an admin (204, clears the cookie); 400 field error on a wrong password, 409 when no other admin can take over |
| GET | `/api/demo` | Public | `{ enabled, ttlHours }`, so the client can adapt to demo mode |
| POST | `/api/demo/guest` | Public, demo mode only | `{ name }`: creates a guest and signs them in (201); 404 outside demo mode |
| GET | `/api/events/stream` | Signed in (or visitor in demo) | Server-Sent Events: live `event`, `remove` and `ping` messages (see below) |
| GET | `/api/events` | Signed in (or visitor in demo) | Visible events only. Query: `type`, `q`, `mine=true`, `past=true`, `manageable=true`. With `limit` (1-50) the response is `{ items, nextCursor }`; pass `cursor` for the next page |
| GET | `/api/events/:id` | Signed in (or visitor in demo) | 404 when hidden or deleted |
| POST | `/api/events` | Planner, admin; any signed-in user in demo | 201 with `Location` header |
| PUT | `/api/events/:id` | Organizer, planner in a shared group, admin | Full replacement |
| DELETE | `/api/events/:id` | Organizer, planner in a shared group, admin | Soft delete (204) |
| POST | `/api/events/:id/hide` | Admin | Moderation: hide the event from everyone but admins; returns the event with `hidden: true` |
| DELETE | `/api/events/:id/hide` | Admin | Unhide; visibility rules apply again as before |
| GET | `/api/events/:id/calendar.ics` | Can view event | Single-event iCalendar download (`text/calendar`, attachment); 404 when hidden or missing |
| GET | `/api/events/:id/attendees` | Can view event | Names only; users with `hideName` appear as "Private attendee" (`private: true`, no real id) unless the viewer manages the event or is that user |
| POST | `/api/events/:id/registration` | Can view event | Join (201); 409 when full or already joined |
| DELETE | `/api/events/:id/registration` | Can view event | Leave; the first person on the waitlist takes the seat |
| POST | `/api/events/:id/waitlist` | Can view event | Join the waitlist (201); 409 when seats are free, registered, already waiting or ended |
| DELETE | `/api/events/:id/waitlist` | Can view event | Leave the waitlist; 404 when not on it |
| GET | `/api/types` | Signed in (or visitor in demo) | Event types |
| GET | `/api/users` | Planner, admin | Planners: names; admins: email, role, status, groups |
| PUT | `/api/users/:id` | Admin | `role`, `active`, `groupIds` |
| GET | `/api/groups` | Planner, admin | |
| POST, PUT, DELETE | `/api/groups[/:id]` | Admin | |

Every event in a response carries `permissions: { edit, delete, join, leave }`,
computed by `server/lib/policy.js`. The client shows controls from this object and
never derives permissions itself.

**Pagination.** The catalogue uses keyset pagination on `(start, id)` rather than
`OFFSET`, so pages stay stable while events are added or removed. Access rules run in
JavaScript, so the route reads database batches until the page is full. The cursor is
the position of the last row read, visible or not, so no event is repeated or skipped.
The client loads the next page when a sentinel near the bottom scrolls into view, and
merges live updates only into the part of the list already loaded.

### Security model
- **Passwords:** bcrypt (cost 12) with a unique per-password salt embedded in the hash.
  Length is capped at 72 bytes (bcrypt's input limit) so nothing is silently truncated.
  Login runs bcrypt even for unknown emails so timing does not reveal accounts.
- **Sessions:** HS256 JWT holding only the user id and a token version, in an
  `httpOnly`, `SameSite=Strict` cookie (`Secure` in production). Tokens last 15 minutes
  and are re-issued while the user is active. Changing a password or deactivating an
  account increments the token version, revoking existing sessions.
- **Authorization:** planners manage events they organize or that are shared with one of their groups; admins manage all. Role and group membership are read from the database on every
  request, so changes apply immediately. All rules live in `policy.js`. Events a user
  cannot see return 404 from every endpoint (detail, attendees, registration).
  An event hidden by an admin (`event_hidden_at`) is visible to admins only, not even its organizer, and is treated as missing for everyone else, including the live stream.
- **Privacy:** a user can hide their name in attendee lists (`user_hide_name`). The decision is
  `canSeeAttendeeName` in `policy.js`; hidden entries carry no user id, only a key that is
  unique within one response, so they cannot be correlated across events.
- **Account deletion:** `DELETE /api/auth/account` re-checks the password (demo guests confirm instead). `events.removeUsers` frees seats and promotes the waitlist; then `users.anonymize` runs in one transaction: upcoming events move to the lowest-id other active admin (409 if there is none), and group memberships, invites and reset tokens are deleted. The row is kept (past events reference it) as `Deleted user` with `deleted-<id>@deleted.invalid`, an unusable password hash, status 0, a bumped `token_version` (all sessions end) and a hidden name. These rows are filtered out of the admin Users list and the invite directory.
- **Input:** every body, query and path parameter is validated with zod; unknown fields
  are dropped, which prevents mass assignment (for example a client setting its own role).
  All SQL is parameterized.
- **CSRF:** SameSite=Strict cookies, plus the API rejects non-JSON write requests (415).
- **Password reset:** `POST /api/auth/forgot` always answers 202 and does its lookup and
  email after responding, so neither the body nor the timing reveals whether an account
  exists. Tokens are 32 random bytes, valid 30 minutes, single use; only their SHA-256 hash
  is stored (`password_reset`). A new request invalidates earlier ones. Redeeming a token
  sets the password through the same path as a password change, so all sessions are signed
  out. Demo guests and deactivated accounts get no email.
- **Abuse:** login, register, reset and forgot-password are rate limited per IP. `helmet` sets security headers.
- **Concurrency:** seat reservations lock the event row (`SELECT ... FOR UPDATE`) so
  capacity cannot be exceeded by simultaneous sign-ups.

### Migrations
The schema is versioned in `server/db/migrations/NNNN_name.sql` (four-digit number,
then a short snake_case name). `server/db/migrate.js` runs on API start and via
`npm run db:migrate`: it takes a MySQL named lock so concurrent processes cannot race,
applies each file not yet listed in `schema_migrations` in name order, and records it.
To change the schema, add the next numbered file; never edit one that has shipped.
`0001_initial.sql` is idempotent so it is a safe baseline for databases created before
migrations existed. MySQL DDL auto-commits, so a migration that fails halfway cannot be
rolled back and its version is not recorded: fix the leftovers by hand, then re-run.
Keep migrations small, one change each.

### Waitlist
Full events have a first-come, first-served waitlist (`waitlist` table, `created_at`
with millisecond precision, ties broken by user id).

- **Joining:** only for a full, not-ended event the user can see and has no seat in
  (`policy.canJoinWaitlist`); the repository re-checks under the event row lock.
  Registering removes the user from that event's waitlist.
- **Promotion:** `promoteFromWaitlist` in `repositories/events.js` fills free seats in
  order, inside the same transaction and event-row lock (`SELECT ... FOR UPDATE`) that
  freed them. It runs after `unregister`, after an `update` that raises capacity, and
  after `removeUsers` (demo guest cleanup), so concurrent leaves cannot over-fill an
  event. Ended events are skipped, and deleting an event cascades its waitlist rows.
- **Shape:** every serialized event has `waitlistCount` and, per user, `waitlistPosition`
  (1-based or `null`); `permissions` gains `joinWaitlist` and `leaveWaitlist`. The live
  hub computes each client's position from the ordered waitlist, like `isRegistered`.
  A client that sees itself go from waiting to registered shows a toast.

### Live updates
The catalogue receives changes in real time over Server-Sent Events, a one-way HTTP
stream built into browsers (`EventSource`). SSE was chosen over GraphQL subscriptions
because updates only flow from server to browser. It needs no second API layer or
WebSocket server, and it reuses the session cookie and ACLs as they are.

- **Flow:** after a join, leave, create, update or delete commits, the route calls
  `live.eventChanged(id, before)`. The hub loads the event once, then sends each open
  stream that user's view of it, serialized exactly as `GET /api/events/:id` would
  return it (`permissions`, `isRegistered`, audience details only for managers).
- **Messages:** `event` (the full event) goes to users who can see it. `remove`
  (`{ id }`) goes to users who could see it before the change but cannot now (deleted,
  or the audience changed). Everyone else gets nothing, so hidden events never leak,
  not even as an id or a seat count.
- **Sessions:** the stream uses a non-sliding session check, so an open tab does not
  keep an idle session alive. Each stream closes after 5 minutes. The browser then
  reconnects, which re-checks the session, role and group membership. A change to
  someone's groups therefore reaches their stream within 5 minutes; REST requests
  see it immediately. After a reconnect the client reloads its list to catch anything
  it missed while disconnected.
- **Dead connections:** the server sends a `ping` event every 15 seconds. If nothing
  arrives for 40 seconds, the client closes and reopens the stream. This covers
  connections that a proxy keeps open after the API restarts, which the browser
  cannot detect by itself. SSE comment lines would not work for this, because
  browsers never pass them to the page.
- **Client:** one shared `EventSource` (`client/src/lib/live.js`) for the whole app.
  The catalogue merges messages into its list (`liveMerge.js`, applying the same
  filters as the server). Manage Events reloads its table. Saves in the editor modal
  are also published locally, so lists update even if the stream is down.
- **Scaling:** the hub keeps open streams in the API process's memory. Running more
  than one API process would need a shared channel (for example Redis pub/sub) to fan
  each change out to every process.

### Event editor modal
Create and Edit open a modal over the current page rather than a separate page. Links
pass `state={{ background: location }}`. `App.jsx` renders the page routes at that
background location and the editor in a second route table, so the URL is still
`/manage/new` or `/manage/:id/edit` and links can be shared or bookmarked. On a direct
visit there is no background, so Manage Events renders underneath the modal.

### Logging
`server/lib/logger.js` exports one shared pino logger. `LOG_LEVEL` sets the level (default `info`; always `silent` under `NODE_ENV=test`). Development output is pretty-printed through pino-pretty; production writes one JSON object per line to stdout for the log collector. Cookies, authorization headers and `password`, `current` and `confirm` fields are redacted.

`pino-http` in `app.js` logs one line per request (method, url, status, duration, request id; 4xx at `warn`, 5xx at `error`). `/api/health` and the long-lived `/api/events/stream` are not logged. Unexpected errors: the error handler sets `res.err`, so the request line is logged at `error` with the real `err` (message and stack) next to the request id; clients still receive only the generic JSON error. Use `logger` (or `req.log` inside a request), never `console`. The CLI seed script keeps `console` for its terminal output.

### Demo mode
`DEMO_MODE=true` turns the app into a public showcase (setup in the README). The code
lives in `server/demo/` and two policy rules.

- **Visitors:** catalogue routes use `authenticateWith({ allowVisitor: true })`.
  Requests without a valid session continue as `policy.VISITOR` (id 0, role
  `visitor`, no groups). The normal ACL then limits them to public events. Routes
  that change data add `requireUser`, which answers 401 for visitors. The user and
  group lists stay closed to visitors.
- **Guests:** `POST /api/demo/guest` creates a `user`-role account with a random
  `guest-…@demo.invalid` email and a shared bcrypt hash of a discarded random secret,
  so nobody can sign in as a guest with a password. The session cookie lasts
  `DEMO_EVENT_TTL_HOURS`, so a guest can still leave an event the next day.
- **Policy:** in demo mode, anyone with a session can create events
  (`canCreateEvent`) and manage the events they organize (`canManageEvent`).
  Restricted audiences stay planner-only (`canRestrictEvent`), because choosing
  groups or invitees needs the user and group lists. Guests are limited to 5 new
  events an hour.
- **Word filter:** `server/lib/moderation.js` rejects guest names and the name,
  location and description of events from non-planners (400 with a neutral field
  error, a warn log with the field only). It matches whole words after normalizing
  case, accents, look-alike characters and repeated letters, so "Scunthorpe" passes.
  Terms: `server/lib/blocked-terms.json` plus an optional `BLOCKED_TERMS_FILE`.
- **Showcase and simulation:** `server/demo/showcase.js` keeps 48 upcoming public
  events organized by `host@demo.invalid` and 160 simulated attendees
  (`bot-NNN@demo.invalid`, hidden from user lists). `server/demo/index.js` signs
  attendees up and off at about 2-3 changes a second and pushes each change through
  `live.eventChanged`, the same path real sign-ups use.
- **Cleanup:** every 10 minutes, and at startup, guest events older than the TTL are
  soft-deleted. Guests older than the TTL are then deactivated (which also revokes
  their tokens), their sign-ups are deleted, and open catalogues are notified.
  Only guest-created data expires, so turning demo mode on over existing data never
  deletes real events.
