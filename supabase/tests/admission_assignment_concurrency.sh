#!/usr/bin/env bash
# Concurrency proof for round-robin assignment. Real, separate database sessions run at the same time.
#   PSQL="psql -h localhost -U postgres" ./admission_assignment_concurrency.sh      (scratch server; creates and drops apas_sla_conc)
# Checks:  A. 60 leads arriving at once (60 sessions, 20 at a time)       -> exactly 20 / 20 / 20, one assignment + one history row each
#          B. 6 sessions each inserting 10 leads inside ONE transaction    -> exactly 20 / 20 / 20 again
#          C. the SAME lead pushed through the engine by 12 sessions at once, plus a manual reassignment racing the rotation
#             -> one assignment row, no errors, history consistent with the final owner
#          D. a counsellor going on leave while leads arrive              -> that counsellor receives none after the change
set -euo pipefail
PSQL=${PSQL:-psql}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; M="$HERE/../migrations"
DB=apas_sla_conc
q() { $PSQL -v ON_ERROR_STOP=1 -X -q -t -A -d "$DB" "$@"; }
$PSQL -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
q -f "$HERE/admission_lead_ingest_stub.sql" -f "$HERE/admission_assignment_sla_stub.sql" -f "$M/20261113000000_admission_lead_integrations.sql" \
  -f "$M/20261114000000_admission_lead_scoring.sql" -f "$M/20261115000000_admission_counsellor_assignment_sla.sql" -f "$M/20261116000000_admission_workbench_and_sla_hardening.sql" >/dev/null

SA=00000000-0000-0000-0000-0000000000a1; PA=00000000-0000-0000-0000-00000000aa01; IN1=00000000-0000-0000-0000-0000000001a1
C1=00000000-0000-0000-0000-00000000c101; C2=00000000-0000-0000-0000-00000000c102; C3=00000000-0000-0000-0000-00000000c103
q >/dev/null <<SQL
insert into schools(id,name) values ('$SA','A');
insert into profiles(id,school_id,role,erp_access,full_name) values ('$PA','$SA','principal',false,'P'),('$C1','$SA','teacher',true,'C1'),('$C2','$SA','teacher',true,'C2'),('$C3','$SA','teacher',true,'C3');
insert into admission_intakes(id,school_id,academic_year,grade) values ('$IN1','$SA','2026-27','Grade 5');
select set_config('request.jwt.sub','$PA',false); select adm_set_counsellor('$SA','$C1'); select adm_set_counsellor('$SA','$C2'); select adm_set_counsellor('$SA','$C3');
SQL

ins() { echo "insert into admission_applicants(intake_id,full_name,parent_name,parent_phone,source,recorded_by) values ('$IN1','$1','P','9000000000','walk_in','$PA');"; }
fail() { echo "FAIL: $*"; exit 1; }
counts() { q -c "select string_agg(n::text, '/' order by p) from (select c.profile_id p, count(la.applicant_id) n from admission_counsellors c left join admission_lead_assignments la on la.assigned_to = c.profile_id and la.applicant_id in (select id from admission_applicants where full_name like '$1%') group by c.profile_id) t"; }

# ---- A
export -f ins; export PSQL DB IN1 PA
seq 1 60 | xargs -P 20 -I{} bash -c "$PSQL -X -q -d $DB -c \"\$(ins 'A{}')\" >/dev/null"
r=$(counts A); [ "$r" = "20/20/20" ] || fail "A: 60 simultaneous leads distributed $r (expected 20/20/20)"
[ "$(q -c "select count(*) from admission_lead_assignments la join admission_applicants a on a.id=la.applicant_id where a.full_name like 'A%'")" = 60 ] || fail "A: assignment rows != 60"
[ "$(q -c "select count(*) from admission_assignment_history h join admission_applicants a on a.id=h.applicant_id where a.full_name like 'A%'")" = 60 ] || fail "A: history rows != 60"
echo "ok   - A: 60 simultaneous leads -> $r, one assignment + one history row each"

# ---- B
for w in 1 2 3 4 5 6; do { echo "begin;"; for i in $(seq 1 10); do ins "B${w}_$i"; done; echo "select pg_sleep(0.2); commit;"; } > /tmp/conc_b_$w.sql; done
printf '%s\n' 1 2 3 4 5 6 | xargs -P 6 -I{} bash -c "$PSQL -X -q -d $DB -f /tmp/conc_b_{}.sql >/dev/null"
r=$(counts B); [ "$r" = "20/20/20" ] || fail "B: multi-lead transactions distributed $r (expected 20/20/20)"
echo "ok   - B: 6 concurrent transactions x 10 leads -> $r"

# ---- C
q -c "insert into admission_applicants(id,intake_id,full_name,parent_name,parent_phone,source,recorded_by) values ('00000000-0000-0000-0000-00000000cafe','$IN1','Same lead','P','9111111111','walk_in','$PA')" >/dev/null
q -c "delete from admission_lead_assignments where applicant_id='00000000-0000-0000-0000-00000000cafe'; delete from admission_assignment_history where applicant_id='00000000-0000-0000-0000-00000000cafe';" >/dev/null
seq 1 12 | xargs -P 12 -I{} bash -c "$PSQL -X -q -d $DB -c \"select adm_rr_assign('00000000-0000-0000-0000-00000000cafe')\" >/dev/null"
[ "$(q -c "select count(*) from admission_lead_assignments where applicant_id='00000000-0000-0000-0000-00000000cafe'")" = 1 ] || fail "C: duplicate assignment rows"
[ "$(q -c "select count(*) from admission_assignment_history where applicant_id='00000000-0000-0000-0000-00000000cafe'")" = 1 ] || fail "C: same lead processed 12x produced more than one history row"
echo "ok   - C1: one lead processed by 12 sessions at once -> one assignment, one history row"
( for i in 1 2 3 4 5 6; do $PSQL -X -q -d $DB -c "select adm_rr_assign('00000000-0000-0000-0000-00000000cafe')" >/dev/null & done
  $PSQL -X -q -d $DB -c "select set_config('request.jwt.sub','$PA',false); select adm_assign_lead('00000000-0000-0000-0000-00000000cafe','$C3','race')" >/dev/null 2>/tmp/conc_c.err & wait )
[ ! -s /tmp/conc_c.err ] || fail "C: manual reassignment raced the rotation and errored: $(cat /tmp/conc_c.err)"
owner=$(q -c "select assigned_to from admission_lead_assignments where applicant_id='00000000-0000-0000-0000-00000000cafe'")
last=$(q -c "select to_counsellor from admission_assignment_history where applicant_id='00000000-0000-0000-0000-00000000cafe' order by created_at desc, id limit 1")
[ "$owner" = "$last" ] || fail "C: history ($last) disagrees with the current owner ($owner)"
echo "ok   - C2: manual reassignment racing the rotation: no error, history == current owner"

# ---- D
q -c "update admission_counsellors set is_available=false where profile_id='$C2'" >/dev/null
seq 1 30 | xargs -P 15 -I{} bash -c "$PSQL -X -q -d $DB -c \"\$(ins 'D{}')\" >/dev/null"
[ "$(q -c "select count(*) from admission_lead_assignments la join admission_applicants a on a.id=la.applicant_id where a.full_name like 'D%' and la.assigned_to='$C2'")" = 0 ] || fail "D: unavailable counsellor received a lead"
r=$(counts D); [ "$r" = "15/0/15" ] || fail "D: with C2 away, 30 simultaneous leads distributed $r (expected 15/0/15)"
echo "ok   - D: counsellor on leave receives nothing; the other two split 30 simultaneous leads $r"
$PSQL -X -q -d postgres -c "drop database $DB" >/dev/null
echo "ALL CONCURRENCY TESTS PASSED"
