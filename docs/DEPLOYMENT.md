# Deployment

Runs the whole app on one server with Docker Compose: Caddy (automatic HTTPS), the
app (Express serving the built client) and MySQL 8.4. Only Caddy publishes ports.

## Prerequisites

- A VPS with Docker Engine and the Compose plugin installed.
- A domain whose DNS A (and AAAA) record points at the VPS.
- Ports 80 and 443 open in the firewall (Caddy needs 80 to get certificates).
- Git, to fetch the code.

## First deploy

```sh
git clone <repository-url> event-planner
cd event-planner
cp .env.production.example .env
```

Edit `.env`: set `DOMAIN`, generate `TOKEN_KEY`
(`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, or
`openssl rand -hex 48`), and choose strong `DB_PASS` and `DB_ROOT_PASS`. Avoid
spaces and quotes in values. Then:

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

On start the app applies any pending database migrations, so the first start creates
the schema and later updates apply their changes automatically. Open `https://<your domain>`; the first
certificate can take a minute. Sign-ups are always members, so register the first
account in the browser, then promote it to admin:

```sh
docker compose -f docker-compose.prod.yml exec db sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "UPDATE user SET user_role=\"admin\" WHERE user_email=\"you@example.com\""'
```

## Updating

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Only changed services are recreated. Data lives in named volumes and survives rebuilds.
Live-update streams reconnect on their own after the app restarts.

## Logs

```sh
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f caddy
docker compose -f docker-compose.prod.yml ps
```

## Backups

Dump the database with `mysqldump` through the running container:

```sh
docker compose -f docker-compose.prod.yml exec -T db sh -c \
  'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$MYSQL_DATABASE"' \
  | gzip > backup.sql.gz
```

Daily at 03:15 with 14 days kept (`crontab -e`; adjust the paths):

```cron
15 3 * * * cd /opt/event-planner && docker compose -f docker-compose.prod.yml exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$MYSQL_DATABASE"' | gzip > /var/backups/event-planner/$(date +\%F).sql.gz && find /var/backups/event-planner -name '*.sql.gz' -mtime +14 -delete
```

Create the backup directory first and copy backups off the server too.

Restore into the running database (this overwrites current data):

```sh
gunzip -c backup.sql.gz | docker compose -f docker-compose.prod.yml exec -T db sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
```

## Demo mode

Demo mode adds about 160 simulated users, so give it its own database rather than
your real one. Easiest is a separate deployment (own clone, own `.env`,
own volumes, own domain) with:

```
DEMO_MODE=true
DB_DB=event_planner_demo
```

The README describes the other demo variables. After changing `DEMO_MODE`, run
`docker compose -f docker-compose.prod.yml up -d` to recreate the app container.

## Single instance only

Live updates (Server-Sent Events) keep open streams in the memory of one app process.
Run exactly one `app` container: do not use `--scale app=2` or `deploy.replicas`,
or users on different containers will not see each other's changes live. Caddy is
configured with `flush_interval -1` and no compression on `/api/events/stream` so
events are delivered immediately; any other proxy placed in front must not buffer
that path either.

## Notes

- `.env` holds secrets and is gitignored. Compose reads it both for the app's settings
  and to fill in the database and Caddy settings, so commands need no `--env-file` flag.
- The app creates and updates the database schema itself when it starts (migrations),
  so a fresh database needs no manual setup.
