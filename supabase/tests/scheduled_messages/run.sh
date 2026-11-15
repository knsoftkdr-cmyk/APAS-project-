#!/usr/bin/env bash
# Runs the Scheduled Messages database tests against a throw-away local Postgres database.
#   usage: supabase/tests/scheduled_messages/run.sh
# Needs a reachable Postgres (>= 14) and a role allowed to create databases. Honors PGHOST/PGUSER/PGPORT/PGPASSWORD.
# Nothing here touches your real Supabase project.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../migrations"
DB="apas_sched_test_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"

"${PSQL[@]}" -f "$HERE/00_stubs.sql"
# The REAL existing migrations the feature builds on:
"${PSQL[@]}" -f "$MIG/20261024000000_notification_inbox_support.sql"
"${PSQL[@]}" -f "$MIG/20261105000000_message_delivery_tracking.sql"
# The migration under test (applied twice: it must be safe to re-run):
"${PSQL[@]}" -f "$MIG/20261111000000_scheduled_messages.sql"
"${PSQL[@]}" -f "$MIG/20261111000000_scheduled_messages.sql"

echo "── functional / permission / exactly-once tests ──"
"${PSQL[@]}" -f "$HERE/10_fixtures.sql"
"${PSQL[@]}" -f "$HERE/20_tests.sql"

echo "── concurrency test (parallel workers) ──"
BIG=$("${PSQL[@]}" -At -f "$HERE/30_concurrency_setup.sql" | tail -1)
T="/tmp/sched_$$"; mkdir -p "$T"
pids=()
for i in 1 2 3 4 5 6; do
  "${PSQL[@]}" -At -c "SELECT count(*) FROM public.process_due_scheduled_messages(50);" >"$T/worker_$i" &
  pids+=($!)
  # While the first worker is still delivering, the sender tries to cancel: it must wait for the lock, then
  # be told the message is already sent. It can never cancel a message that went out.
  if [ "$i" = 1 ]; then
    sleep 0.7
    "${PSQL[@]}" -At -c "SELECT tests.login(tests.id(1)); SELECT public.cancel_scheduled_message('$BIG');" >"$T/cancel_out" 2>&1 || true
  fi
done
for p in "${pids[@]}"; do wait "$p"; done
grep -qi "already sent" "$T/cancel_out" || { echo "FAIL: cancel racing the worker was not refused"; cat "$T/cancel_out"; exit 1; }
echo "ok - cancel racing an in-flight delivery is refused ('already sent')"
pids=()
for i in 1 2 3 4 5 6; do
  "${PSQL[@]}" -At -c "SELECT message_id FROM public.claim_scheduled_dispatches(1000);" >"$T/claim_$i" &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
cat "$T"/claim_* | sort >"$T/claim_all"
CLAIMED_TOTAL=$(wc -l <"$T/claim_all")
CLAIMED_UNIQUE=$(sort -u "$T/claim_all" | wc -l)
rm -rf "$T"
"${PSQL[@]}" -v claimed_total="$CLAIMED_TOTAL" -v claimed_unique="$CLAIMED_UNIQUE" -f "$HERE/31_concurrency_assert.sql"

echo "ALL SCHEDULED-MESSAGE DB TESTS PASSED"
