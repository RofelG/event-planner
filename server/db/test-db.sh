#!/bin/bash
# Runs once on first container start: creates the isolated databases used by
# Jest/Supertest (_test) and the Playwright browser tests (_e2e), and grants the
# app user access to them. For an existing volume, run npm run db:e2e instead.
set -e
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_test\`;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_test\`.* TO '${MYSQL_USER}'@'%';
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_e2e\`;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_e2e\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
