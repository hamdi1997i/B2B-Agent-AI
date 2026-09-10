#!/usr/bin/env bash
# Remet la base de test à zéro (schéma + données de départ), sans les tests.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-5433}" PGUSER="${PGUSER:-postgres}" PGDATABASE="${PGDATABASE:-maawen}"

psql -v ON_ERROR_STOP=1 -q -c "drop schema if exists public cascade;
                               drop schema if exists tests cascade;
                               create schema public;" >/dev/null
psql -v ON_ERROR_STOP=1 -q -c "truncate auth.users cascade;" >/dev/null 2>&1 || true
[ -z "${SKIP_SHIM:-}" ] && psql -v ON_ERROR_STOP=1 -q -f "$here/00_supabase_shim.sql" >/dev/null
for f in "$here"/../migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done
