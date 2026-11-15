#!/usr/bin/env bash
# Runs the instalment DB tests against a throw-away Postgres. Usage: PGHOST=... PGPORT=... PGUSER=postgres ./run.sh
# Applies a stub of the pre-existing tables, then the REAL migration (twice, to prove it is re-runnable), then the scenarios.
set -euo pipefail
cd "$(dirname "$0")"
P="psql -v ON_ERROR_STOP=1 -q -X"
DB=${TEST_DB:-apas_instalment_test}
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
P="$P -d $DB"
$P -f 00_stub_schema.sql 2>/dev/null
$P -f ../../migrations/20261110000000_fee_instalments.sql 2>/dev/null
$P -f ../../migrations/20261110000000_fee_instalments.sql 2>/dev/null && echo "migration re-run: OK (idempotent)"
$P -f ../../migrations/20261111000000_payment_gateways.sql 2>/dev/null
$P -f ../../migrations/20261111000000_payment_gateways.sql 2>/dev/null && echo "gateway migration re-run: OK (idempotent)"
$P -f 01_helpers.sql 2>/dev/null
$P -f 02_scenarios.sql 2>&1 | grep -v "^psql:.*NOTICE" || true
$P -f 03_gateways.sql 2>&1 | grep -v "^psql:.*NOTICE" || true
$P -At -c "SELECT format('%s %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, label) FROM t.log ORDER BY n" | grep -c '^PASS' | sed 's/^/passed: /'
if $P -At -c "SELECT 1 FROM t.log WHERE NOT ok LIMIT 1" | grep -q 1; then echo "FAILURES PRESENT"; exit 1; fi
