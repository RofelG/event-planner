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

| Script | What it does |
| --- | --- |
| `npm run dev` | API on `API_PORT` (default 3001) with reload, plus Vite on 5173 proxying `/api` |
| `npm run build` | Production build of the client into `dist/` |
| `npm start` | API only; with `NODE_ENV=production` it also serves `dist/` |
| `npm test` | Unit and integration tests (needs the database running) |
| `npm run db:up` / `db:down` | Start or stop the MySQL container |
| `npm run db:seed` | Apply the schema and add demo types, groups, users and events |

## Environment variables

See `.env.example`. Required: `TOKEN_KEY` (at least 32 characters), `DB_HOST`,
`DB_USER`, `DB_PASS`, `DB_DB`. The tests use a separate `<DB_DB>_test` database that
docker compose creates on first start.

## Roles and access

| Role | Can do |
| --- | --- |
| Member (`user`) | See events they are allowed to see, join and leave them, view attendees, change their password |
| Event Planner (`planner`) | Everything a member can, plus create events and edit or delete events they organize or that are shared with one of their groups |
| Admin (`admin`) | Everything, including any event, user roles, account status and groups |

New sign-ups are always members. An admin assigns roles under **Users and Groups**.

Each event is either **Public** (every signed-in user) or **Restricted** (members of the
selected groups and individually invited people, plus the organizer and admins).
Hidden events are reported as not found, so their existence is never revealed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the API reference and security model.
