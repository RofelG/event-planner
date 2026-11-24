#!/bin/bash
# Runs once on first container start: creates the isolated test database used
# by Jest/Supertest and grants the app user access to it.
set -e
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_test\`;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_test\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
