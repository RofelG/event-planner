# Event Planner

Browse events, reserve a seat, and see who else is going. Event planners publish
and manage events, and can restrict an event to specific groups or invited people.

- **Client:** React 19 SPA built with Vite, styled with Tailwind CSS and SCSS (`client/`)
- **API:** Express 5 REST/JSON API with MySQL 8 (`server/`)
- **Tests:** Jest and Supertest (`tests/`)

## Quick start

Requires Node.js 20.19+ or 22.12+ (CI runs on Node 24) and Docker Desktop.

```powershell
Copy-Item .env.example .env
```

Edit `.env`: set `TOKEN_KEY` to a long random value, choose database passwords, and
change the `SEED_*` demo passwords. Then:

```powershell
npm install
```

```powershell
npm run db:up
```

```powershell
npm run db:seed
```

```powershell
npm run dev
```

Open http://localhost:5173 and sign in with one of the `SEED_*` accounts from `.env`.

### Password reset email

"Forgot your password?" sends a reset link by email. In development, start Mailpit,
which catches all outgoing mail instead of delivering it:

```powershell
docker compose up -d mailpit
```

Open the inbox at http://localhost:8025 to find the link. `.env.example` already points
the API at it (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`). If `SMTP_HOST` is empty, no mail
is sent and the link is written to the API log at warn level instead.

| Script | What it does |
| --- | --- |
| `npm run dev` | API on `API_PORT` (default 3001) with reload, plus Vite on 5173 proxying `/api` |
| `npm run build` | Production build of the client into `dist/` |
| `npm start` | API only; with `NODE_ENV=production` it also serves `dist/` |
| `npm test` | Unit and integration tests (needs the database running) |
| `npm run test:e2e` | Browser tests with Playwright (see Browser tests) |
| `npm run db:up` / `db:down` | Start or stop the MySQL container |
| `npm run db:migrate` | Apply pending database migrations (also done automatically when the API starts) |
| `npm run db:seed` | Apply migrations and add demo types, groups, users and events |

## Environment variables

See `.env.example`. Required: `TOKEN_KEY` (at least 32 characters), `DB_HOST`,
`DB_USER`, `DB_PASS`, `DB_DB`. Optional: `APP_URL` and the `SMTP_*` / `MAIL_FROM`
settings for password reset email. The tests use a separate `<DB_DB>_test` database that
docker compose creates on first start.

## Browser tests

`npm run test:e2e` runs Playwright (Chromium) against a real API and Vite dev server,
started on ports 3101 and 5273 so they never clash with `npm run dev`. Install the
browser once with `npx playwright install chromium`.

The run **drops every table** in its own database, `<DB_DB>_e2e` (`event_planner_e2e`
with the usual `.env`), and reseeds it from the `SEED_*` accounts. Your development
database is never touched: the reset refuses any database whose name does not contain `e2e`.

A fresh database container creates `event_planner_e2e` automatically. With an existing
container, create it once (this uses `DB_ROOT_PASS` from `.env`):

```powershell
npm run db:e2e
```

Then run the tests:

```powershell
npm run test:e2e
```

After a failure, open the report with `npx playwright show-report`.

## Database schema

The schema lives in numbered SQL files in `server/db/migrations/`. The API applies any
that are pending when it starts, and `npm run db:migrate` or `npm run db:seed` does the
same on demand; applied versions are recorded in the `schema_migrations` table. The
database container only creates empty databases; it no longer loads a schema itself.

## Roles and access

| Role | Can do |
| --- | --- |
| Member (`user`) | See events they are allowed to see, join and leave them, join the waitlist of a full event (they are registered automatically when a seat frees up), view attendees, change their password, hide their name in attendee lists (organizers and admins still see it) |
| Event Planner (`planner`) | Everything a member can, plus create events and edit or delete events they organize or that are shared with one of their groups |
| Admin (`admin`) | Everything, including any event, user roles, account status and groups |

New sign-ups are always members. An admin assigns roles under **Users and Groups**.

Each event is either **Public** (every signed-in user) or **Restricted** (members of the
selected groups and individually invited people, plus the organizer and admins).
Hidden events are reported as not found, so their existence is never revealed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the API reference and security model.

## Demo mode

Set `DEMO_MODE=true` in `.env` to run the app as a public showcase:

- **No account needed.** Visitors open the catalogue straight away and see public events.
  The first time they join or create an event, they're asked for their name. That
  creates a guest with no password.
- **Live activity.** Dozens of showcase events, organized by "Demo Host", are created
  and topped up as they end. About 160 simulated attendees join and leave them a few
  times a second, so seat counts change in real time.
- **Short-lived visitor data.** Guests can create public events and edit or delete
  their own. Guest events, the guests and their sign-ups are removed
  `DEMO_EVENT_TTL_HOURS` (default 48) after creation. Showcase events and anything
  created by planners or admins are never removed.
- **Word filter.** Guest names and the name, location and description of guest events
  are checked against a list of slurs and strong profanity
  (`server/lib/blocked-terms.json`; add more with `BLOCKED_TERMS_FILE`). Staff are not filtered.
- **Staff still sign in** through "Staff sign in" in the nav, with the usual roles.

| Variable | Default | Effect |
| --- | --- | --- |
| `DEMO_MODE` | `false` | Turns demo mode on |
| `DEMO_EVENT_TTL_HOURS` | `48` | How long guest events and guests last |
| `DEMO_SIMULATE` | `true` | Set to `false` to stop the simulated sign-ups |

Demo mode only adds rows; it never changes existing users or events. It does add about
160 simulated users, so point `DB_DB` at a separate database for a demo. Guests are
limited to 10 new names per hour per IP address and 5 new events per hour.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to run the app on a VPS with Docker
Compose and automatic HTTPS.

## Dependency updates

Dependabot checks npm packages and GitHub Actions every Monday, configured in
`.github/dependabot.yml`. Minor and patch npm updates are grouped into one pull request,
while major version updates arrive as separate pull requests so each can be reviewed on its own.
