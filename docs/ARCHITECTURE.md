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
  src/components/       Composed components: NavBar, EventCard, AttendeesModal
  src/context/          AuthContext (session + role), ToastContext
  src/hooks/            useApi (GET + loading/error), useEventActions
  src/pages/            Route pages
  src/styles/           app.scss (Tailwind directives, animations), _tokens.scss (palette)
server/
  app.js                Express app (exported for Supertest)
  index.js              Starts the HTTP server
  config.js             Validated environment configuration
  db/                   Pool, schema.sql, seed script
  lib/policy.js         All access-control rules (pure functions)
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
| GET | `/api/events` | Signed in | Visible events only. Query: `type`, `q`, `past=true`, `manageable=true` |
| GET | `/api/events/:id` | Signed in | 404 when hidden or deleted |
| POST | `/api/events` | Planner, admin | 201 with `Location` header |
| PUT | `/api/events/:id` | Organizer, planner in a shared group, admin | Full replacement |
| DELETE | `/api/events/:id` | Organizer, planner in a shared group, admin | Soft delete (204) |
| GET | `/api/events/:id/attendees` | Can view event | Names only |
| POST | `/api/events/:id/registration` | Can view event | Join (201); 409 when full or already joined |
| DELETE | `/api/events/:id/registration` | Can view event | Leave |
| GET | `/api/types` | Signed in | Event types |
| GET | `/api/users` | Planner, admin | Planners: names; admins: email, role, status, groups |
| PUT | `/api/users/:id` | Admin | `role`, `active`, `groupIds` |
| GET | `/api/groups` | Planner, admin | |
| POST, PUT, DELETE | `/api/groups[/:id]` | Admin | |

Every event in a response carries `permissions: { edit, delete, join, leave }`,
computed by `server/lib/policy.js`. The client shows controls from this object and
never derives permissions itself.

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
- **Input:** every body, query and path parameter is validated with zod; unknown fields
  are dropped, which prevents mass assignment (for example a client setting its own role).
  All SQL is parameterized.
- **CSRF:** SameSite=Strict cookies, plus the API rejects non-JSON write requests (415).
- **Abuse:** login and register are rate limited per IP. `helmet` sets security headers.
- **Concurrency:** seat reservations lock the event row (`SELECT ... FOR UPDATE`) so
  capacity cannot be exceeded by simultaneous sign-ups.
