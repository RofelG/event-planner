# Event Planner Project Brief

## Why this project exists

Planning an event requires a shared place where people can discover available events, see their details, and register to attend. Organizers also need a straightforward way to publish and manage those events. This application provides those workflows behind an authenticated web experience.

## Goals

### Current product goals

- Let people create an account, sign in, sign out, and change their password.
- Show authenticated users the available events and their event types.
- Let authenticated users create events with dates, location, capacity, cost, type, and an optional description.
- Let authenticated users register for an event or remove their registration.
- Let organizers remove events through the existing event-management flow.
- Keep account credentials protected with salted password hashes and short-lived JWT-based authentication.

### Engineering goals

- Build the client as a React single-page application (SPA) using Vite.
- Keep a clear separation between the React presentation layer and the Express/MySQL API and business-logic layer.
- Use reusable, responsive React components and manage UI state with React hooks; introduce shared state only where the application requires it.
- Use Tailwind CSS as the primary styling system and SCSS only for complex component styles, animations, or shared custom properties.
- Keep protected actions behind the existing authentication middleware.
- Test React components and API integration as changes are made, following the QA policy.

## Restrictions and constraints

- The repository currently contains a server-rendered Express/EJS implementation. Moving to React/Vite is an intentional migration and must preserve the existing API behavior until compatible replacements are verified.
- Data persistence depends on the configured MySQL connection and required environment variables, including database settings, `TOKEN_KEY`, and a port (`PORT` or `API_PORT`).
- Event and account management endpoints require a valid JWT token supplied through the application cookie flow.
- Authentication tokens expire after 15 minutes.
- Passwords must never be stored or logged in plain text; the existing implementation uses a per-password salt and `bcryptjs` hash.
- The current project has a QA policy that calls for feature or bug-fix work on a dedicated branch, local verification, and unit/integration coverage with Jest and Supertest. Those test tools are not yet listed in `package.json`.
- API and database changes must remain consistent with the documented REST/JSON communication model and the existing MySQL helper interface.

## Roadmap

### 1. Establish a reliable baseline

- Document setup, required environment variables, database schema, and local start instructions.
- Add Jest and Supertest, then cover registration, login, authentication, event retrieval, event creation, and registration flows.
- Standardize route error handling and validation responses.

### 2. Strengthen event management

- Confirm and enforce authorization rules for event editing and deletion.
- Add event editing and clearer organizer controls.
- Validate dates, capacity, cost, and registration limits on the server.
- Make event removal semantics explicit and preserve an audit-friendly soft-delete policy if that remains the intended behavior.

### 3. Improve the attendee experience

- Add clear empty, loading, validation-error, and success states.
- Improve filtering and discovery using event type and relevant event details.
- Ensure the interface remains usable across mobile and desktop breakpoints.

### 4. Complete the SPA migration and prepare for sustainable delivery

- Create the Vite-based React client, migrate the existing event and account workflows, and retire EJS views only after the SPA provides verified equivalents.
- Keep Express focused on the REST API, authentication, and persistence; have the React client communicate with it over JSON endpoints.
- Update `docs/ARCHITECTURE.md` and `docs/DESIGN.md` to reflect the completed React/Vite SPA.
- Add CI checks for tests and basic application health.
- Review authentication-cookie settings, rate limiting, and production configuration before release.

## Definition of success

The project succeeds when a user can securely create an account, find an event, register or withdraw, and receive clear feedback; an authorized organizer can reliably create and manage events; and changes are backed by documented setup and repeatable automated tests.
