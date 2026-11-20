#!/usr/bin/env bash
# Runs the fee-plan DB tests against a throw-away Postgres. Usage: PGHOST=... PGPORT=... PGUSER=postgres ./run.sh
# Applies stubs of the pre-existing tables/helpers, then the REAL migration (twice, to prove it is re-runnable), then the scenarios.
set -euo pipefail
cd "$(dirname "$0")"
P="psql -v ON_ERROR_STOP=1 -q -X"
DB=${TEST_DB:-apas_feeplan_test}
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
P="$P -d $DB"
$P -f 00_stub_schema.sql 2>/dev/null
$P -f ../../migrations/20261116000000_fee_plan_assignment.sql 2>/dev/null
$P -f ../../migrations/20261116000000_fee_plan_assignment.sql 2>/dev/null && echo "migration re-run: OK (idempotent)"
$P -f 01_helpers.sql 2>/dev/null
psql -v ON_ERROR_STOP=0 -q -X -d "$DB" -f 02_scenarios.sql 2>&1 | grep -v "NOTICE\|^$\|^(.*row" | grep -i "error" | grep -v "expected" || true
$P -At -c "SELECT format('%s %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, label) FROM t.log ORDER BY n"
echo "passed: $($P -At -c "SELECT count(*) FROM t.log WHERE ok")  failed: $($P -At -c "SELECT count(*) FROM t.log WHERE NOT ok")"
if $P -At -c "SELECT 1 FROM t.log WHERE NOT ok LIMIT 1" | grep -q 1; then echo "FAILURES PRESENT"; exit 1; fi
