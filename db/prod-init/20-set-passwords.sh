#!/bin/bash
# Runs ONCE, on first boot of an empty Postgres volume, right after
# 01-schema.sql has created the SELECT-only `gurzu_readonly` role.
#
# schema.sql ships that role with a well-known development password so a fresh
# clone works out of the box. In production that is a public credential, so we
# replace it here with the value from READONLY_DB_PASSWORD.
#
# Existing deployments are NOT touched by this script (init scripts only run on
# an empty data directory). To rotate the password later, run by hand:
#   docker compose -f docker-compose.prod.yml exec db \
#     psql -U "$POSTGRES_USER" -d merchant_catalog \
#     -c "ALTER ROLE gurzu_readonly WITH PASSWORD 'new-password'"
set -euo pipefail

if [ -z "${READONLY_DB_PASSWORD:-}" ]; then
  echo "20-set-passwords.sh: READONLY_DB_PASSWORD is empty — refusing to leave" \
       "the read-only role on its public development password." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname merchant_catalog <<-SQL
	ALTER ROLE gurzu_readonly WITH PASSWORD '${READONLY_DB_PASSWORD}';
SQL

echo "20-set-passwords.sh: gurzu_readonly password set from READONLY_DB_PASSWORD"
