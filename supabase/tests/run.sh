#!/usr/bin/env bash
# Applique le schéma sur une base PostgreSQL vierge et lance les tests.
#
#   PGHOST=/tmp PGPORT=5433 PGUSER=postgres PGDATABASE=maawen ./supabase/tests/run.sh
#
# Sur une base Supabase locale (`supabase start`), le shim n'est pas nécessaire:
#   SKIP_SHIM=1 ./supabase/tests/run.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql_run() { psql -v ON_ERROR_STOP=1 -q "$@"; }

echo "→ réinitialisation du schéma public"
psql_run -c "drop schema if exists public cascade;
             drop schema if exists tests cascade;
             create schema public;" >/dev/null

if [ -z "${SKIP_SHIM:-}" ]; then
  psql_run -c "truncate auth.users cascade;" >/dev/null 2>&1 || true
  psql_run -f "$here/00_supabase_shim.sql" >/dev/null
fi

echo "→ migrations"
for f in "$here"/../migrations/*.sql; do
  psql_run -f "$f" >/dev/null
  echo "   $(basename "$f")"
done

echo "→ tests"
psql -q -f "$here/rls_test.sql" 2>&1 | sed -e 's/^psql:.*NOTICE: //' -e '/^NOTICE:/d'
