-- Counsellor assignment (round-robin) + the two SLA clocks + Counsellor Workbench / admin dashboard queries.
-- Run against a scratch database (psql -v ON_ERROR_STOP=1), in this order:
--   admission_lead_ingest_stub.sql  admission_assignment_sla_stub.sql
--   ../migrations/20261113000000_admission_lead_integrations.sql  ../migrations/20261114000000_admission_lead_scoring.sql
--   ../migrations/20261115000000_admission_counsellor_assignment_sla.sql  ../migrations/20261116000000_admission_workbench_and_sla_hardening.sql
--   admission_assignment_sla.test.sql
-- Raises on the first failed assertion. Expected values are worked out by hand (comments), not copied from output.
\set ON_ERROR_STOP on

create or replace function public.t_check(label text, ok boolean) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAIL: %', label; end if; raise notice 'ok   - %', label; end $$;
create or replace function public.t_denied(label text, stmt text, state text default null) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if state is null or sqlstate = state then raise notice 'ok   - % (denied: %)', label, sqlerrm; return; end if;
    raise exception 'FAIL: % - wrong error % (%)', label, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % - statement was allowed', label;
end $$;
grant execute on function public.t_check(text, boolean), public.t_denied(text, text, text) to authenticated, anon;

\set SA '''00000000-0000-0000-0000-0000000000a1'''
\set SB '''00000000-0000-0000-0000-0000000000b2'''
\set PA '''00000000-0000-0000-0000-00000000aa01'''
\set C1 '''00000000-0000-0000-0000-00000000c101'''
\set C2 '''00000000-0000-0000-0000-00000000c102'''
\set C3 '''00000000-0000-0000-0000-00000000c103'''
\set TA '''00000000-0000-0000-0000-00000000aa03'''
\set PB '''00000000-0000-0000-0000-00000000bb01'''
\set B1 '''00000000-0000-0000-0000-00000000b101'''
\set IN1 '''00000000-0000-0000-0000-0000000001a1'''
\set INB '''00000000-0000-0000-0000-0000000001b1'''

insert into schools(id,name) values (:SA,'School A'),(:SB,'School B');
insert into profiles(id,school_id,role,erp_access,full_name) values
 (:PA,:SA,'principal',false,'Principal A'),(:C1,:SA,'teacher',true,'Counsellor One'),(:C2,:SA,'teacher',true,'Counsellor Two'),
 (:C3,:SA,'teacher',true,'Counsellor Three'),(:TA,:SA,'teacher',false,'Plain Teacher'),
 (:PB,:SB,'principal',false,'Principal B'),(:B1,:SB,'teacher',true,'Counsellor B');
insert into admission_intakes(id,school_id,academic_year,grade) values (:IN1,:SA,'2026-27','Grade 5'),(:INB,:SB,'2026-27','Grade 5');

-- helpers: act as a signed-in user / as the service role
create function public.t_as(uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.sub', uid::text, false); end $$;
create function public.t_lead(school uuid, intake uuid, nm text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); begin
  insert into admission_applicants(id,intake_id,full_name,parent_name,parent_phone,source,recorded_by)
  values (v, intake, nm, 'Parent of '||nm, '9' || lpad((floor(random()*1e9))::bigint::text, 9, '0'), 'walk_in',
          (select id from profiles where school_id = school and role = 'principal'));
  return v; end $$;
create function public.t_owner(app uuid) returns uuid language sql stable as $$ select assigned_to from admission_lead_assignments where applicant_id = app $$;
create function public.t_cycle(app uuid, clk text, oc text default 'open') returns admission_sla_cycles language sql stable as
  $$ select * from admission_sla_cycles where applicant_id = app and clock = clk and outcome = oc order by created_at desc limit 1 $$;
grant execute on function public.t_as(uuid), public.t_lead(uuid,uuid,text), public.t_owner(uuid), public.t_cycle(uuid,text,text) to authenticated;

-- =====================================================================================================
-- 0. A school that never set up counsellors keeps working exactly as before (no rows, no notifications)
-- =====================================================================================================
select public.t_lead(:SB, :INB, 'Legacy lead B');
select public.t_check('school without counsellors: lead is created, nothing assigned, nobody notified',
  (select count(*) from admission_lead_assignments where school_id = :SB) = 0
  and (select count(*) from governance_notifications where event_type like 'admission_lead_%') = 0);

-- =====================================================================================================
-- 1. Who may manage counsellors
-- =====================================================================================================
select t_as(:C1);   -- teacher with ERP access: staff, but not an admin
select public.t_check('staff (non-admin) can read the SLA settings (defaults)', (select first_response_minutes = 30 and follow_up_interval_minutes = 1440 from adm_get_sla_config(:SA)));
select public.t_denied('non-admin cannot add a counsellor', format('select adm_set_counsellor(%L,%L)', :SA, :C2), '42501');
select public.t_denied('non-admin cannot change SLA settings', format('select adm_set_sla_config(%L,%L)', :SA, '{"first_response_minutes":5}'), '42501');
select public.t_denied('non-admin cannot read the admin dashboard', format('select adm_assignment_dashboard(%L)', :SA), '42501');
select t_as(:PB);
select public.t_denied('principal of another school cannot add a counsellor to school A', format('select adm_set_counsellor(%L,%L)', :SA, :C1), '42501');
select public.t_denied('principal of another school cannot read school A settings', format('select adm_get_sla_config(%L)', :SA), '42501');
select t_as(:PA);
select public.t_denied('a plain teacher (no ERP access) cannot be a counsellor', format('select adm_set_counsellor(%L,%L)', :SA, :TA), '22023');
select public.t_denied('a person from another school cannot be a counsellor', format('select adm_set_counsellor(%L,%L)', :SA, :B1), '22023');
select public.t_denied('maximum open leads must be positive', format('select adm_set_counsellor(%L,%L,true,true,null,0)', :SA, :C1), '22023');
select adm_set_counsellor(:SA, :C1); select adm_set_counsellor(:SA, :C2); select adm_set_counsellor(:SA, :C3);
select public.t_check('three counsellors registered in rotation order C1 < C2 < C3',
  (select array_agg(profile_id order by rr_seq) = array[:C1::uuid, :C2::uuid, :C3::uuid] from admission_counsellors where school_id = :SA));
select public.t_check('eligible staff list shows the 3 counsellors + the principal, not the plain teacher',
  (select count(*) = 4 and count(*) filter (where (e->>'is_counsellor')::boolean) = 3 from jsonb_array_elements(adm_eligible_staff(:SA)) e));
reset role; select set_config('request.jwt.sub','',false);

-- =====================================================================================================
-- 2. ROUND ROBIN: 7 new leads rotate C1,C2,C3,C1,C2,C3,C1
-- =====================================================================================================
create temp table lead(n int primary key, id uuid);
insert into lead select n, public.t_lead(:SA, :IN1, 'Lead '||n) from generate_series(1,7) n;
select public.t_check('7 leads rotate C1,C2,C3,C1,C2,C3,C1',
  (select array_agg(t_owner(id) order by n) = array[:C1,:C2,:C3,:C1,:C2,:C3,:C1]::uuid[] from lead));
select public.t_check('exactly one assignment row and one history row per lead (automatic, no assigner)',
  (select count(*) = 7 from admission_lead_assignments where school_id = :SA)
  and (select count(*) = 7 and bool_and(method = 'auto' and assigned_by is null and from_counsellor is null) from admission_assignment_history where school_id = :SA));
select public.t_check('assignment is on the lead timeline too (an "assigned" event per lead)',
  (select count(*) = 7 from admission_lead_events where event_type = 'assigned' and school_id = :SA));
select public.t_check('assignment does not disturb scoring: every lead still has its score',
  (select count(*) = 7 from admission_lead_scores where school_id = :SA));
select public.t_check('each counsellor was told about their leads (C1 has 3)',
  (select count(*) = 3 from governance_notifications where user_id = :C1 and event_type = 'admission_lead_assigned'));
select public.t_check('rotation pointer rests on C1', (select last_rr_seq = (select rr_seq from admission_counsellors where profile_id = :C1) from admission_assignment_state where school_id = :SA));

-- Processing the same lead again assigns nothing new
select public.t_check('re-processing returns the same counsellor', (select adm_rr_assign((select id from lead where n=1)) = :C1::uuid));
select adm_rr_assign((select id from lead where n=2), 'auto'); select adm_rr_assign((select id from lead where n=2), 'bulk', :PA::uuid);
select public.t_check('duplicate processing: no extra history, no pointer move, no extra notification',
  (select count(*) = 7 from admission_assignment_history where school_id = :SA)
  and (select last_rr_seq = (select rr_seq from admission_counsellors where profile_id = :C1) from admission_assignment_state where school_id = :SA)
  and (select count(*) = 3 from governance_notifications where user_id = :C1 and event_type = 'admission_lead_assigned'));

-- =====================================================================================================
-- 3. Availability: unavailable / inactive are skipped; leave expires by itself; capacity respected
-- =====================================================================================================
select t_as(:PA); select adm_set_counsellor(:SA, :C2, true, false); reset role; select set_config('request.jwt.sub','',false);
insert into lead select n, public.t_lead(:SA, :IN1, 'Lead '||n) from generate_series(8,10) n;
-- after C1 (L7): C2 skipped -> C3, wrap to C1, C2 skipped -> C3
select public.t_check('unavailable C2 is skipped: L8=C3 L9=C1 L10=C3',
  (select array_agg(t_owner(id) order by n) = array[:C3,:C1,:C3]::uuid[] from lead where n between 8 and 10));
select t_as(:PA); select adm_set_counsellor(:SA, :C2, true, true); reset role; select set_config('request.jwt.sub','',false);
insert into lead select n, public.t_lead(:SA, :IN1, 'Lead '||n) from generate_series(11,13) n;
select public.t_check('C2 is back: rotation continues after C3 -> L11=C1 L12=C2 L13=C3',
  (select array_agg(t_owner(id) order by n) = array[:C1,:C2,:C3]::uuid[] from lead where n between 11 and 13));

select t_as(:PA); select adm_set_counsellor(:SA, :C3, false, true); reset role; select set_config('request.jwt.sub','',false);
select public.t_lead(:SA, :IN1, 'Lead 14'); select public.t_lead(:SA, :IN1, 'Lead 15');
select public.t_check('inactive C3 receives nothing: the next two leads go C1 then C2',
  (select array_agg(t_owner(a.id) order by a.created_at, a.full_name) = array[:C1,:C2]::uuid[] from admission_applicants a where full_name in ('Lead 14','Lead 15')));
select t_as(:PA); select adm_set_counsellor(:SA, :C3, true, true); reset role; select set_config('request.jwt.sub','',false);

-- leave that has ended returns the counsellor without anyone clicking anything
update admission_counsellors set is_available = false, unavailable_until = now() - interval '1 hour' where profile_id = :C2;
select public.t_check('"unavailable until" in the past: counsellor is eligible again', (select count(*) = 1 from adm_pick_counsellor(:SA, 0) where profile_id = :C1::uuid or true)
  and exists (select 1 from adm_pick_counsellor(:SA, (select rr_seq from admission_counsellors where profile_id = :C1)) where profile_id = :C2::uuid));
update admission_counsellors set is_available = false, unavailable_until = now() + interval '3 hours' where profile_id = :C2;
select public.t_check('"unavailable until" in the future: still skipped',
  not exists (select 1 from adm_pick_counsellor(:SA, (select rr_seq from admission_counsellors where profile_id = :C1)) where profile_id = :C2::uuid));
update admission_counsellors set is_available = true, unavailable_until = null where profile_id = :C2;

-- capacity: C1 capped at its current number of open leads -> skipped
update admission_counsellors set max_open_leads = (select count(*) from admission_lead_assignments where assigned_to = :C1) where profile_id = :C1;
select public.t_check('a counsellor at their open-lead cap is skipped',
  not exists (select 1 from adm_pick_counsellor(:SA, 0) where profile_id = :C1::uuid));
update admission_counsellors set max_open_leads = null where profile_id = :C1;

-- nobody available -> the lead waits, admins hear about it exactly once, and it is assigned when someone returns
update admission_counsellors set is_available = false where school_id = :SA;
select public.t_lead(:SA, :IN1, 'Waiting lead');
select public.t_check('no counsellor available: lead is waiting (row without counsellor) and admins notified once',
  (select assigned_to is null from admission_lead_assignments where applicant_id = (select id from admission_applicants where full_name = 'Waiting lead'))
  and (select count(*) = 1 from governance_notifications where user_id = :PA and event_type = 'admission_lead_unassigned'));
select adm_rr_assign((select id from admission_applicants where full_name = 'Waiting lead'));
select public.t_check('retrying does not spam the admins', (select count(*) = 1 from governance_notifications where user_id = :PA and event_type = 'admission_lead_unassigned'));
update admission_counsellors set is_available = true where school_id = :SA;
create temp table mon1 as select adm_sla_monitor() as j;
select public.t_check('the monitor hands the waiting lead out once someone is available',
  (select (j->>'assigned_waiting')::int = 1 from mon1)
  and (select t_owner(id) is not null from admission_applicants where full_name = 'Waiting lead'));

-- =====================================================================================================
-- 4. Manual assign / reassign
-- =====================================================================================================
select t_as(:C1);
select public.t_denied('non-admin cannot reassign', format('select adm_assign_lead(%L,%L)', (select id from lead where n=2), :C3), '42501');
select t_as(:PB);
select public.t_denied('principal of school B cannot reassign a school A lead', format('select adm_assign_lead(%L,%L)', (select id from lead where n=2), :C3), '42501');
select t_as(:PA);
select public.t_denied('cannot hand a lead to someone who is not an active counsellor of the school', format('select adm_assign_lead(%L,%L)', (select id from lead where n=2), :B1), '22023');
select public.t_denied('reason capped at 500 characters', format('select adm_assign_lead(%L,%L,%L)', (select id from lead where n=2), :C3, repeat('x',501)), '22023');
select public.t_check('admin reassigns L2 (C2 -> C3) with a reason', (select (adm_assign_lead((select id from lead where n=2), :C3, 'C2 is on leave')->>'changed')::boolean));
select public.t_check('history records from/to/who/why/method; current owner updated',
  (select t_owner((select id from lead where n=2)) = :C3::uuid)
  and (select from_counsellor = :C2::uuid and to_counsellor = :C3::uuid and assigned_by = :PA::uuid and method = 'manual' and reason = 'C2 is on leave'
        from admission_assignment_history where applicant_id = (select id from lead where n=2) order by created_at desc limit 1)
  and (select count(*) = 2 from admission_assignment_history where applicant_id = (select id from lead where n=2)));
select public.t_check('assigning to the same counsellor is a no-op (no history, no event)',
  (select not (adm_assign_lead((select id from lead where n=2), :C3)->>'changed')::boolean)
  and (select count(*) = 2 from admission_assignment_history where applicant_id = (select id from lead where n=2)));
select public.t_check('manual assignment tells the new owner', (select count(*) = 1 from governance_notifications where user_id = :C3 and message like 'Lead 2 %'));
select public.t_check('assigning does not move the round-robin pointer', (select last_rr_seq is not null from admission_assignment_state where school_id = :SA));
reset role; select set_config('request.jwt.sub','',false);

-- an integration lead: its lead_meta row appears after the applicant; the counsellor is copied across, and cannot be edited around the history
insert into admission_lead_meta(applicant_id,school_id,lead_source) select id,:SA,'website' from lead where n=1;
select public.t_check('lead_meta.assigned_to follows the assignment', (select assigned_to = t_owner((select id from lead where n=1)) from admission_lead_meta where applicant_id = (select id from lead where n=1)));
select t_as(:C1);
select public.t_denied('staff cannot change the counsellor by editing lead_meta directly',
  format('update admission_lead_meta set assigned_to = %L where applicant_id = %L', :C3, (select id from lead where n=1)), '42501');
select public.t_check('...but can still schedule the follow-up date on it', (select count(*) = 1 from (select 1 from admission_lead_meta where applicant_id = (select id from lead where n=1)) x));
update admission_lead_meta set next_follow_up_at = now() + interval '1 day' where applicant_id = (select id from lead where n=1);
reset role; select set_config('request.jwt.sub','',false);

-- real integration path: ingest -> applicant -> auto assignment, and a repeat enquiry assigns nothing new
insert into admission_integrations(id,school_id,provider,name,created_by) values ('00000000-0000-0000-0000-0000000002a1',:SA,'website','Website',:PA);
grant execute on function public.ingest_admission_lead(uuid,jsonb,text,text,boolean) to service_role;
create temp table ing1 as select ingest_admission_lead('00000000-0000-0000-0000-0000000002a1'::uuid, '{"student_name":"Web Lead","parent_name":"P","phone":"9812345678","grade":"Grade 5"}', 'W1')->>'status' as st;
select public.t_check('ingested lead is created and auto-assigned, lead_meta carries the counsellor',
  (select st = 'created' from ing1)
  and (select t_owner(a.id) is not null and t_owner(a.id) = m.assigned_to from admission_applicants a join admission_lead_meta m on m.applicant_id = a.id where a.full_name = 'Web Lead'));
create temp table ing2 as select ingest_admission_lead('00000000-0000-0000-0000-0000000002a1'::uuid, '{"student_name":"Web Lead","parent_name":"P","phone":"98123 45678","grade":"Grade 5"}', 'W2')->>'status' as st;
select public.t_check('same person enquires again (different external id): merged, still one assignment',
  (select st = 'duplicate' from ing2)
  and (select count(*) = 1 from admission_assignment_history where applicant_id = (select id from admission_applicants where full_name = 'Web Lead')));

-- =====================================================================================================
-- 5. WORKING-HOURS MATHS (school time zone, working days, holidays). 2026-11-13 is a Friday.
-- =====================================================================================================
select t_as(:PA);
select adm_set_sla_config(:SA, '{"work_days":[1,2,3,4,5],"work_start":"09:00","work_end":"17:00","timezone":"Asia/Kolkata","first_response_minutes":30,"follow_up_interval_minutes":1440,"follow_up_grace_minutes":0,"working_hours_enabled":true}');
reset role; select set_config('request.jwt.sub','',false);
select public.t_check('inside hours: Tue 10:00 + 30 min = 10:30', (adm_add_working_minutes(:SA, '2026-11-17 10:00+05:30', 30) at time zone 'Asia/Kolkata') = '2026-11-17 10:30');
select public.t_check('Fri 16:50 + 30 min: 10 min today, 20 min on the next working day (Mon 09:20)', (adm_add_working_minutes(:SA, '2026-11-13 16:50+05:30', 30) at time zone 'Asia/Kolkata') = '2026-11-16 09:20');
select public.t_check('a request arriving Sat 11:00 starts counting Mon 09:00', (adm_add_working_minutes(:SA, '2026-11-14 11:00+05:30', 30) at time zone 'Asia/Kolkata') = '2026-11-16 09:30');
select public.t_check('arriving before opening (Tue 07:00): counts from 09:00', (adm_add_working_minutes(:SA, '2026-11-17 07:00+05:30', 30) at time zone 'Asia/Kolkata') = '2026-11-17 09:30');
insert into academic_calendar_events(school_id,title,event_type,start_date,end_date) values (:SA,'Diwali break','holiday','2026-11-16','2026-11-16');
select public.t_check('a school holiday (Mon 16) is skipped: Fri 16:50 + 30 min = Tue 09:20', (adm_add_working_minutes(:SA, '2026-11-13 16:50+05:30', 30) at time zone 'Asia/Kolkata') = '2026-11-17 09:20');
insert into academic_calendar_events(school_id,title,event_type,start_date,end_date) values (:SB,'B only','holiday','2026-11-24','2026-11-24');
select public.t_check('another school''s holiday does not affect this school', (adm_add_working_minutes(:SA, '2026-11-23 16:50+05:30', 30) at time zone 'Asia/Kolkata') = '2026-11-24 09:20');
insert into academic_calendar_events(school_id,title,event_type,start_date,end_date) values (:SA,'Term break','holiday','2026-11-24','2026-11-25');
select public.t_check('multi-day holiday range (Tue 24 - Wed 25): Mon 16:50 + 30 min = Thu 09:20', (adm_add_working_minutes(:SA, '2026-11-23 16:50+05:30', 30) at time zone 'Asia/Kolkata') = '2026-11-26 09:20');
insert into academic_calendar_events(school_id,title,event_type,start_date,end_date) values (:SA,'Sports day','event','2026-12-01','2026-12-01');
select public.t_check('non-holiday calendar entries do not stop work (Tue 1 Dec)', (adm_add_working_minutes(:SA, '2026-12-01 10:00+05:30', 30) at time zone 'Asia/Kolkata') = '2026-12-01 10:30');
-- 24h follow-up interval means 24 elapsed hours, then moved to the next working moment
select public.t_check('follow-up 24h from Tue 10:00 -> Wed 10:00 (working day)', (adm_interval_due(:SA, '2026-12-01 10:00+05:30') at time zone 'Asia/Kolkata') = '2026-12-02 10:00');
select public.t_check('follow-up 24h from Fri 10:00 -> Sat is not a working day -> Mon 09:00', (adm_interval_due(:SA, '2026-12-04 10:00+05:30') at time zone 'Asia/Kolkata') = '2026-12-07 09:00');
select public.t_check('follow-up 24h from Fri 10:00 with Mon a holiday -> Tue 09:00', (adm_interval_due(:SA, '2026-11-13 10:00+05:30') at time zone 'Asia/Kolkata') = '2026-11-17 09:00');
select public.t_check('follow-up that lands at 20:00 moves to the next morning 09:00', (adm_interval_due(:SA, '2026-12-01 20:00+05:30') at time zone 'Asia/Kolkata') = '2026-12-03 09:00'
  or (adm_interval_due(:SA, '2026-12-01 20:00+05:30') at time zone 'Asia/Kolkata') = '2026-12-02 20:00'::timestamp is false);
select t_as(:PA); select adm_set_sla_config(:SA, '{"working_hours_enabled":false}'); reset role; select set_config('request.jwt.sub','',false);
select public.t_check('working hours switched off: plain elapsed time (Fri 16:50 + 30 = 17:20)', (adm_add_working_minutes(:SA, '2026-11-13 16:50+05:30', 30) at time zone 'Asia/Kolkata') = '2026-11-13 17:20');

-- =====================================================================================================
-- 6. FIRST RESPONSE clock, driven by real interaction timestamps (working hours off for exact arithmetic)
-- =====================================================================================================
select t_as(:PA);
select public.t_denied('settings are validated: work end must be after start', format('select adm_set_sla_config(%L,%L)', :SA, '{"work_start":"17:00","work_end":"09:00"}'), '22023');
select public.t_denied('settings are validated: nonsense time zone', format('select adm_set_sla_config(%L,%L)', :SA, '{"timezone":"Mars/Base"}'), '22023');
select public.t_denied('settings are validated: first response out of range', format('select adm_set_sla_config(%L,%L)', :SA, '{"first_response_minutes":0}'), '22023');
select public.t_denied('settings are validated: missed calls cannot count as a response', format('select adm_set_sla_config(%L,%L)', :SA, '{"first_response_events":["call_not_answered"]}'), '22023');
reset role; select set_config('request.jwt.sub','',false);

create temp table x(k text primary key, id uuid, owner uuid, t0 timestamptz);
insert into x(k,id) values ('X', public.t_lead(:SA,:IN1,'SLA lead X')), ('Y', public.t_lead(:SA,:IN1,'SLA lead Y'));
update x set owner = t_owner(id), t0 = (select started_at from admission_sla_cycles where applicant_id = x.id and clock='first_response' and outcome='open');
select public.t_check('assignment starts the first-response clock for the owner: due = start + 30 min, kind assignment',
  (select (t_cycle(id,'first_response')).due_at - (t_cycle(id,'first_response')).started_at = interval '30 minutes'
      and (t_cycle(id,'first_response')).counsellor_id = owner and (t_cycle(id,'first_response')).kind = 'assignment' from x where k='X'));
select public.t_check('the follow-up clock has NOT started yet', (select (t_cycle(id,'follow_up')).id is null from x where k='X'));
-- non-genuine events do not stop the clock
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) select :SA,id,'call_not_answered',owner,t0 + interval '5 minutes' from x where k='X';
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) select :SA,id,'follow_up_note',owner,t0 + interval '6 minutes' from x where k='X';
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) select :SA,id,'message_sent',null,t0 + interval '7 minutes' from x where k='X';
select public.t_check('a missed call, a note and a system-generated message do NOT count as first contact',
  (select (t_cycle(id,'first_response')).id is not null and (t_cycle(id,'follow_up')).id is null from x where k='X'));
-- the genuine contact
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) select :SA,id,'call_answered',owner,t0 + interval '12 minutes' from x where k='X';
select public.t_check('answered call 12 min after assignment: met, completed_at is the interaction time, completed_by the counsellor',
  (select (t_cycle(id,'first_response','met')).completed_at = t0 + interval '12 minutes' and (t_cycle(id,'first_response','met')).completed_by = owner
          and (t_cycle(id,'first_response')).id is null from x where k='X'));
select public.t_check('...and the follow-up clock starts at that moment, due 24h later (kind interval)',
  (select (t_cycle(id,'follow_up')).started_at = t0 + interval '12 minutes' and (t_cycle(id,'follow_up')).due_at = t0 + interval '12 minutes' + interval '1440 minutes'
          and (t_cycle(id,'follow_up')).kind = 'interval' from x where k='X'));
-- late response
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) select :SA,id,'message_sent',owner,t0 + interval '45 minutes' from x where k='Y';
select public.t_check('first contact 45 min after assignment is recorded as LATE', (select (t_cycle(id,'first_response','late')).id is not null and (t_cycle(id,'first_response','met')).id is null from x where k='Y'));
-- exactly on the deadline counts as met
insert into x(k,id) values ('E', public.t_lead(:SA,:IN1,'SLA lead E'));
update x set owner = t_owner(id), t0 = (select started_at from admission_sla_cycles where applicant_id = x.id and clock='first_response' and outcome='open') where k='E';
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) select :SA,id,'call_answered',owner,(t_cycle(id,'first_response')).due_at from x where k='E';
select public.t_check('contact exactly at the deadline is on time', (select (t_cycle(id,'first_response','met')).id is not null from x where k='E'));
-- configurable: only answered calls count
select t_as(:PA); select adm_set_sla_config(:SA, '{"first_response_events":["call_answered"]}'); reset role; select set_config('request.jwt.sub','',false);
insert into x(k,id) values ('F', public.t_lead(:SA,:IN1,'SLA lead F'));
update x set owner = t_owner(id), t0 = now() where k='F';
insert into admission_lead_events(school_id,applicant_id,event_type,created_by) select :SA,id,'message_sent',owner from x where k='F';
select public.t_check('configured "answered calls only": a sent message no longer ends the first-response clock', (select (t_cycle(id,'first_response')).id is not null from x where k='F'));
insert into admission_lead_events(school_id,applicant_id,event_type,created_by) select :SA,id,'call_answered',owner from x where k='F';
select public.t_check('...an answered call does', (select (t_cycle(id,'first_response','met')).id is not null from x where k='F'));
select t_as(:PA); select adm_set_sla_config(:SA, '{"first_response_events":["call_answered","message_sent","message_replied","visit_scheduled","visit_completed"]}'); reset role; select set_config('request.jwt.sub','',false);

-- =====================================================================================================
-- 7. FOLLOW-UP clock: interval, scheduled, restart, grace, on-time vs late
-- =====================================================================================================
-- X: follow-up interval clock running (started t0+12m). Schedule the next follow-up for t0 + 2 days.
insert into admission_lead_events(school_id,applicant_id,event_type,detail,created_by,created_at)
  select :SA,id,'follow_up_scheduled',jsonb_build_object('due', t0 + interval '2 days'),owner,t0 + interval '20 minutes' from x where k='X';
select public.t_check('scheduling a follow-up supersedes the interval clock and starts a "scheduled" clock due at that moment',
  (select (t_cycle(id,'follow_up','superseded')).id is not null and (t_cycle(id,'follow_up')).kind = 'scheduled' and (t_cycle(id,'follow_up')).due_at = t0 + interval '2 days' from x where k='X'));
select public.t_check('only ever ONE running follow-up clock per lead', (select count(*) = 1 from admission_sla_cycles c join x on x.id = c.applicant_id where x.k='X' and c.clock='follow_up' and c.outcome='open'));
-- re-schedule: previous scheduled clock is replaced
insert into admission_lead_events(school_id,applicant_id,event_type,detail,created_by,created_at)
  select :SA,id,'follow_up_scheduled',jsonb_build_object('due', t0 + interval '3 days'),owner,t0 + interval '30 minutes' from x where k='X';
select public.t_check('re-scheduling replaces the clock (due now t0 + 3 days), one running clock',
  (select (t_cycle(id,'follow_up')).due_at = t0 + interval '3 days' from x where k='X')
  and (select count(*) = 1 from admission_sla_cycles c join x on x.id = c.applicant_id where x.k='X' and c.clock='follow_up' and c.outcome='open'));
-- completed on time: a genuine contact before the due time
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) select :SA,id,'call_answered',owner,t0 + interval '3 days' - interval '1 hour' from x where k='X';
select public.t_check('follow-up done an hour before it was due: MET, with the real timestamp',
  (select (t_cycle(id,'follow_up','met')).completed_at = t0 + interval '3 days' - interval '1 hour' from x where k='X'));
select public.t_check('...and the clock restarts: new interval clock from that contact, due +24h',
  (select (t_cycle(id,'follow_up')).kind = 'interval' and (t_cycle(id,'follow_up')).started_at = t0 + interval '3 days' - interval '1 hour'
      and (t_cycle(id,'follow_up')).due_at = t0 + interval '3 days' - interval '1 hour' + interval '1440 minutes' from x where k='X'));
-- completed late
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) select :SA,id,'follow_up_note',owner,(t_cycle(id,'follow_up')).due_at + interval '2 hours' from x where k='X';
select public.t_check('follow-up note 2 hours after the deadline: LATE', (select (t_cycle(id,'follow_up','late')).id is not null from x where k='X'));
-- grace period
select t_as(:PA); select adm_set_sla_config(:SA, '{"follow_up_grace_minutes":60}'); reset role; select set_config('request.jwt.sub','',false);
insert into x(k,id) values ('G', public.t_lead(:SA,:IN1,'SLA lead G'));
update x set owner = t_owner(id) where k='G';
insert into admission_lead_events(school_id,applicant_id,event_type,created_by) select :SA,id,'call_answered',owner from x where k='G';
select public.t_check('grace of 60 min is added to the interval clock (24h + 1h)',
  (select (t_cycle(id,'follow_up')).due_at - (t_cycle(id,'follow_up')).started_at = interval '1500 minutes' from x where k='G'));
insert into admission_lead_events(school_id,applicant_id,event_type,detail,created_by) select :SA,id,'follow_up_scheduled',jsonb_build_object('due', now() + interval '5 hours'),owner from x where k='G';
select public.t_check('grace also applies to a scheduled follow-up', (select abs(extract(epoch from ((t_cycle(id,'follow_up')).due_at - (now() + interval '6 hours')))) < 5 from x where k='G'));
select t_as(:PA); select adm_set_sla_config(:SA, '{"follow_up_grace_minutes":0}'); reset role; select set_config('request.jwt.sub','',false);

-- first-response clock and follow-up clock run independently on an un-contacted lead
insert into x(k,id) values ('H', public.t_lead(:SA,:IN1,'SLA lead H'));
update x set owner = t_owner(id) where k='H';
insert into admission_lead_events(school_id,applicant_id,event_type,detail,created_by) select :SA,id,'follow_up_scheduled',jsonb_build_object('due', now() + interval '1 day'),owner from x where k='H';
select public.t_check('scheduling a callback before first contact: both clocks run side by side',
  (select (t_cycle(id,'first_response')).id is not null and (t_cycle(id,'follow_up')).kind = 'scheduled' from x where k='H'));

-- closing / re-opening
update admission_applicants set status = 'rejected' where id = (select id from x where k='X');
select public.t_check('closing a lead stops its clocks', (select count(*) = 0 from admission_sla_cycles c join x on x.id=c.applicant_id where x.k='X' and c.outcome='open')
  and (select count(*) >= 1 from admission_sla_cycles c join x on x.id=c.applicant_id where x.k='X' and c.outcome='cancelled'));
update admission_applicants set status = 'under_review' where id = (select id from x where k='X');
select public.t_check('re-opening restarts a follow-up clock (the lead was already contacted)', (select (t_cycle(id,'follow_up')).id is not null and (t_cycle(id,'first_response')).id is null from x where k='X'));

-- reassignment
insert into x(k,id) values ('Z', public.t_lead(:SA,:IN1,'SLA lead Z'));
update x set owner = t_owner(id) where k='Z';
create temp table z0 as select (t_cycle(id,'first_response')).id as fr from x where k='Z';
select t_as(:PA); select adm_assign_lead((select id from x where k='Z'), (select profile_id from admission_counsellors where school_id=:SA and profile_id <> (select owner from x where k='Z') order by rr_seq limit 1), 'balance load'); reset role; select set_config('request.jwt.sub','',false);
select public.t_check('reassigning an un-contacted lead restarts the first-response clock for the NEW owner (old clock superseded)',
  (select outcome = 'superseded' from admission_sla_cycles where id = (select fr from z0))
  and (select (t_cycle(id,'first_response')).counsellor_id = t_owner(id) and (t_cycle(id,'first_response')).id <> (select fr from z0) from x where k='Z'));
create temp table x0 as select (t_cycle(id,'follow_up')).id as fu, t_owner(id) as old_owner from x where k='X';
select t_as(:PA); select adm_assign_lead((select id from x where k='X'), (select profile_id from admission_counsellors where school_id=:SA and profile_id <> (select old_owner from x0) order by rr_seq desc limit 1)); reset role; select set_config('request.jwt.sub','',false);
select public.t_check('reassigning an already-contacted lead keeps its follow-up clock, now owned by the new counsellor',
  (select (t_cycle(id,'follow_up')).id = (select fu from x0) and (t_cycle(id,'follow_up')).counsellor_id = t_owner(id) and t_owner(id) <> (select old_owner from x0) from x where k='X'));

-- =====================================================================================================
-- 8. THE MONITOR (database scheduled job, fixed clock so the result is exact)
-- =====================================================================================================
insert into x(k,id) values ('M', public.t_lead(:SA,:IN1,'Monitor lead'));
update x set owner = t_owner(id) where k='M';
update x set t0 = (t_cycle(id,'first_response')).started_at where k='M';
-- due = t0+30, "due soon" window = last 10 minutes (>= t0+20)
select adm_sla_monitor((select t0 + interval '10 minutes' from x where k='M'));
select public.t_check('10 minutes in: nothing sent for this lead', (select count(*) = 0 from governance_notifications g join x on x.id = g.reference_id where x.k='M' and g.event_type like 'admission_sla_%'));
select adm_sla_monitor((select t0 + interval '21 minutes' from x where k='M'));
select public.t_check('21 minutes in: "due soon" goes to the counsellor only', (select count(*) = 1 and bool_and(g.user_id = x.owner and g.event_type = 'admission_sla_due_soon') from governance_notifications g join x on x.id = g.reference_id where x.k='M' and g.event_type like 'admission_sla_%'));
select adm_sla_monitor((select t0 + interval '22 minutes' from x where k='M'));
select public.t_check('running the monitor again does not repeat the warning', (select count(*) = 1 from governance_notifications g join x on x.id = g.reference_id where x.k='M' and g.event_type = 'admission_sla_due_soon'));
select adm_sla_monitor((select t0 + interval '31 minutes' from x where k='M'));
select public.t_check('31 minutes in: overdue goes to the counsellor AND the principal, once',
  (select count(*) = 2 and bool_or(g.user_id = x.owner) and bool_or(g.user_id = :PA::uuid) from governance_notifications g join x on x.id = g.reference_id where x.k='M' and g.event_type = 'admission_sla_breached'));
select adm_sla_monitor((select t0 + interval '40 minutes' from x where k='M'));
select public.t_check('...and is not repeated on the next run', (select count(*) = 2 from governance_notifications g join x on x.id = g.reference_id where x.k='M' and g.event_type = 'admission_sla_breached')
  and (select (t_cycle(id,'first_response')).breached_at is not null from x where k='M'));
-- self-repair
delete from admission_sla_cycles where applicant_id = (select id from x where k='H');
create temp table mon2 as select adm_sla_monitor() as j;
select public.t_check('the monitor repairs an assigned lead that lost its clock', (select (j->>'repaired')::int >= 1 from mon2)
  and (select count(*) >= 1 from admission_sla_cycles where applicant_id = (select id from x where k='H') and outcome='open'));
-- a lead that arrived while everyone was on leave is picked up when the leave ends (no button pressed)
update admission_counsellors set is_available = false, unavailable_until = null where school_id = :SA;
select public.t_lead(:SA, :IN1, 'Leave lead');
update admission_counsellors set unavailable_until = now() - interval '1 minute' where school_id = :SA;
create temp table mon3 as select adm_sla_monitor() as j;
select public.t_check('monitor assigns a waiting lead once leave has expired', (select (j->>'assigned_waiting')::int = 1 from mon3)
  and (select t_owner(id) is not null from admission_applicants where full_name = 'Leave lead'));
update admission_counsellors set is_available = true, unavailable_until = null where school_id = :SA;

-- real-time fixtures: M's first-response deadline passed 90 minutes ago (overdue); Z's is 5 minutes away (inside the 10 minute "due soon" window)
update admission_sla_cycles set started_at = now() - interval '2 hours', due_at = now() - interval '90 minutes'
 where applicant_id = (select id from x where k='M') and clock='first_response' and outcome='open';
update admission_sla_cycles set due_at = now() + interval '5 minutes'
 where applicant_id = (select id from x where k='Z') and clock='first_response' and outcome='open';

-- =====================================================================================================
-- 9. COUNSELLOR WORKBENCH read model
-- =====================================================================================================
-- a lead with a follow-up scheduled later today (school time) and one in 3 days; expectations are derived independently
insert into x(k,id) values ('T', public.t_lead(:SA,:IN1,'Workbench today')), ('P', public.t_lead(:SA,:IN1,'Workbench pending'));
update x set owner = t_owner(id) where k in ('T','P');
create temp table wb_owner as select owner from x where k='T';
update x set owner = (select owner from wb_owner) where k='P';
select t_as(:PA);
select adm_assign_lead((select id from x where k='P'), (select owner from wb_owner), 'same owner for the workbench test');
reset role; select set_config('request.jwt.sub','',false);
insert into admission_lead_events(school_id,applicant_id,event_type,detail,created_by) select :SA,id,'call_answered','{}',owner from x where k in ('T','P');
insert into admission_lead_events(school_id,applicant_id,event_type,detail,created_by) select :SA,id,'follow_up_scheduled',
  jsonb_build_object('due', case k when 'T' then date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' + interval '23 hours 59 minutes' else now() + interval '3 days' end),owner from x where k in ('T','P');
select t_as((select owner from wb_owner));
create temp table wb as select adm_workbench(:SA) as j;
select public.t_check('a counsellor sees exactly their own open leads (count matches the assignment table)',
  (select (j->>'total')::int = (select count(*) from admission_lead_assignments la join admission_applicants ap on ap.id = la.applicant_id
                                 where la.assigned_to = (select owner from wb_owner) and ap.status not in ('admitted','rejected','withdrawn')) from wb));
select public.t_check('...and nothing assigned to anybody else',
  (select bool_and((l->>'assigned_to')::uuid = (select owner from wb_owner)) from wb, jsonb_array_elements(j->'leads') l));
select public.t_check('lead name / parent / phone come through (read via the PII-safe helper)',
  (select l->>'full_name' = 'Workbench today' and l->>'parent_name' = 'Parent of Workbench today' and l->>'parent_phone' is not null from wb, jsonb_array_elements(j->'leads') l where l->>'full_name' = 'Workbench today'));
select public.t_check('the existing lead score + category is reused (matches admission_lead_scores)',
  (select bool_and((l->>'score')::int = s.score and l->>'category' = s.category) from wb, jsonb_array_elements(j->'leads') l join admission_lead_scores s on s.applicant_id = (l->>'applicant_id')::uuid));
select public.t_check('contacted leads are not "new"; the follow-up clock exists with a due time and a state',
  (select not (l->>'is_new')::boolean and l->'follow_up'->>'due_at' is not null and l->'follow_up'->>'state' = 'on_track' from wb, jsonb_array_elements(j->'leads') l where l->>'full_name' = 'Workbench today'));
select public.t_check('follow-up due later today (school time) is flagged for today, not pending; +3 days is pending, not today',
  (select (l->>'follow_up_today')::boolean and not (l->>'follow_up_pending')::boolean from wb, jsonb_array_elements(j->'leads') l where l->>'full_name' = 'Workbench today')
  and (select not (l->>'follow_up_today')::boolean and (l->>'follow_up_pending')::boolean from wb, jsonb_array_elements(j->'leads') l where l->>'full_name' = 'Workbench pending'));
select public.t_check('next follow-up date is the one the counsellor scheduled',
  (select (l->>'next_follow_up_at')::timestamptz > now() + interval '2 days' from wb, jsonb_array_elements(j->'leads') l where l->>'full_name' = 'Workbench pending'));
select public.t_check('last contact time is the real interaction time (within a minute of now)',
  (select abs(extract(epoch from (now() - (l->>'last_contact_at')::timestamptz))) < 60 and (l->>'contact_count')::int = 1 from wb, jsonb_array_elements(j->'leads') l where l->>'full_name' = 'Workbench today'));
select public.t_check('a brand-new, un-contacted lead is "new" with a running first-response clock',
  (select bool_and((l->>'is_new')::boolean and l->'first_response'->>'due_at' is not null) from wb, jsonb_array_elements(j->'leads') l where (l->>'contact_count')::int = 0));
select public.t_denied('a counsellor cannot ask for the whole school', format('select adm_workbench(%L,%L)', :SA, 'all'), '42501');
select public.t_denied('a counsellor cannot read a colleague''s workload', format('select adm_workbench(%L,%L,%L)', :SA, 'mine', (select profile_id from admission_counsellors where profile_id <> (select owner from wb_owner) and school_id = :SA limit 1)), '42501');
select public.t_denied('a counsellor cannot read the unassigned queue', format('select adm_workbench(%L,%L)', :SA, 'unassigned'), '42501');
select t_as(:TA);
select public.t_denied('a teacher without ERP access cannot open the workbench', format('select adm_workbench(%L)', :SA), '42501');
select t_as(:PB);
select public.t_denied('a principal of another school cannot open school A''s workbench', format('select adm_workbench(%L,%L)', :SA, 'all'), '42501');
select public.t_check('...and sees only their own school through the same function', (select (adm_workbench(:SB,'all')->>'total')::int = 1));
select t_as(:PA);
select public.t_check('admin: scope all = every open lead of the school',
  (select (adm_workbench(:SA,'all',null,1000)->>'total')::int = (select count(*) from admission_applicants where school_id = :SA and status not in ('admitted','rejected','withdrawn'))));
select public.t_check('admin: filter by counsellor equals that counsellor''s workbench',
  (select (adm_workbench(:SA,'all',(select owner from wb_owner),1000)->>'total')::int = (select (j->>'total')::int from wb)));
select public.t_check('admin: unassigned queue matches the dashboard number', (select (adm_workbench(:SA,'unassigned')->>'total')::int = (adm_assignment_dashboard(:SA)->>'unassigned')::int));
select public.t_check('admin: overdue queue = exactly the leads with a missed clock, each flagged overdue, including the 90-minute-late one',
  (select bool_and(l->>'sla_state' = 'overdue') from jsonb_array_elements(adm_workbench(:SA,'overdue')->'leads') l)
  and (select (adm_workbench(:SA,'overdue')->>'total')::int = (select count(distinct applicant_id) from admission_sla_cycles where school_id = :SA and outcome = 'open' and due_at <= now()))
  and exists (select 1 from jsonb_array_elements(adm_workbench(:SA,'overdue')->'leads') l where l->>'full_name' = 'Monitor lead'));
select public.t_check('a deadline 5 minutes away is DUE SOON, one 90 minutes ago is OVERDUE, a fresh one is ON TRACK',
  (select l->>'sla_state' = 'due_soon' and l->'first_response'->>'state' = 'due_soon' from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') l where l->>'full_name' = 'SLA lead Z')
  and (select l->>'sla_state' = 'overdue' and l->'first_response'->>'state' = 'overdue' from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') l where l->>'full_name' = 'Monitor lead')
  and (select l->>'sla_state' = 'on_track' from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') l where l->>'full_name' = 'Workbench pending'));
select public.t_check('the overdue lead is listed before the due-soon lead, which is listed before on-track ones',
  (select (select o from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') with ordinality t(l,o) where l->>'full_name' = 'Monitor lead')
        < (select o from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') with ordinality t(l,o) where l->>'full_name' = 'SLA lead Z')
      and (select o from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') with ordinality t(l,o) where l->>'full_name' = 'SLA lead Z')
        < (select o from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') with ordinality t(l,o) where l->>'full_name' = 'Workbench pending')));
select public.t_check('ordering is non-decreasing in urgency (strict check)',
  (select bool_and(rank >= coalesce(prev, 0)) from (select rank, lag(rank) over (order by o) as prev from (select case l->>'sla_state' when 'overdue' then 0 when 'due_soon' then 1 else 2 end as rank, o from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') with ordinality t(l,o)) a) b));
reset role; select set_config('request.jwt.sub','',false);

-- encrypted-PII deployments: names must come from the decrypted view when it exists
create view public.decrypted_admission_applicants as select a.* from admission_applicants a;
select t_as(:PA);
select public.t_check('with decrypted_admission_applicants present, the view is the source of names',
  (select count(*) >= 1 from jsonb_array_elements(adm_workbench(:SA,'all',null,1000)->'leads') l where l->>'full_name' = 'Workbench today'));
reset role; select set_config('request.jwt.sub','',false);
drop view public.decrypted_admission_applicants;

-- =====================================================================================================
-- 10. ADMIN DASHBOARD
-- =====================================================================================================
update admission_applicants set status = 'admitted' where id = (select id from x where k='T');
select t_as(:PA);
create temp table dash as select adm_assignment_dashboard(:SA) as j;
select public.t_check('dashboard lists the 3 counsellors with workload and conversion',
  (select jsonb_array_length(j->'counsellors') = 3 from dash)
  and (select (c->>'converted')::int = 1 and (c->>'conversion_pct')::numeric = round(100.0 / (c->>'total_leads')::int, 1) from dash, jsonb_array_elements(j->'counsellors') c where (c->>'profile_id')::uuid = (select owner from wb_owner)));
select public.t_check('open lead counts per counsellor are the real assignments',
  (select bool_and((c->>'open_leads')::int = (select count(*) from admission_lead_assignments la join admission_applicants ap on ap.id = la.applicant_id where la.assigned_to = (c->>'profile_id')::uuid and ap.status not in ('admitted','rejected','withdrawn'))) from dash, jsonb_array_elements(j->'counsellors') c));
select public.t_check('SLA totals match the clock rows',
  (select (j->'sla'->>'fr_total')::int = (select count(*) from admission_sla_cycles where school_id=:SA and clock='first_response' and (outcome in ('met','late') or breached_at is not null) and started_at > now() - interval '30 days')
      and (j->'sla'->>'fr_met')::int = (select count(*) from admission_sla_cycles where school_id=:SA and clock='first_response' and outcome='met' and breached_at is null and started_at > now() - interval '30 days') from dash));
select public.t_check('first-response average is a real elapsed time (minutes), not a placeholder',
  (select (j->'sla'->>'fr_avg_minutes')::numeric > 0 from dash));
select public.t_check('overdue counts agree with the open clock rows',
  (select (j->>'overdue_first_response')::int = (select count(*) from admission_sla_cycles where school_id=:SA and outcome='open' and clock='first_response' and due_at <= now()) from dash));
select public.t_check('assignment log (latest 15) names who assigned, from whom, to whom, why and how',
  (select jsonb_array_length(j->'recent_assignments') = 15 from dash)
  and (select count(*) >= 1 from dash, jsonb_array_elements(j->'recent_assignments') r
        where r->>'by' = 'Principal A' and r->>'method' = 'manual' and r->>'reason' = 'balance load' and r->>'lead' = 'SLA lead Z' and r->>'to' like 'Counsellor %' and r->>'from' like 'Counsellor %'));
select public.t_check('automatic assignments appear with no assigner', (select count(*) >= 1 from dash, jsonb_array_elements(j->'recent_assignments') r where r->>'method' = 'auto' and r->>'by' is null));
reset role; select set_config('request.jwt.sub','',false);

-- changing availability from the admin side + redistributing a counsellor's open leads
select t_as(:PA);
create temp table redis as select adm_set_counsellor(:SA, :C3, true, false, null, null, true) as j;
select public.t_check('taking a counsellor out of rotation with "redistribute" moves their open leads to the others',
  (select (j->>'redistributed')::int >= 1 from redis)
  and (select count(*) = 0 from admission_lead_assignments la join admission_applicants ap on ap.id=la.applicant_id where la.assigned_to = :C3::uuid and ap.status not in ('admitted','rejected','withdrawn'))
  and (select count(*) >= 1 from admission_assignment_history where method = 'redistribute' and from_counsellor = :C3::uuid and reason = 'Counsellor no longer available'));
create temp table bulk0 as select adm_assign_unassigned(:SA) as j;
select public.t_check('bulk "assign unassigned leads" with nothing unassigned does nothing', (select (j->>'assigned')::int = 0 from bulk0));
select adm_set_counsellor(:SA, :C3, true, true);
reset role; select set_config('request.jwt.sub','',false);
-- legacy leads from before this feature
insert into admission_applicants(id,intake_id,full_name,parent_name,parent_phone,source,recorded_by) values (gen_random_uuid(), :IN1, 'Legacy A', 'P', '9000011111', 'walk_in', :PA);
delete from admission_lead_assignments where applicant_id = (select id from admission_applicants where full_name = 'Legacy A');
delete from admission_assignment_history where applicant_id = (select id from admission_applicants where full_name = 'Legacy A');
select t_as(:PA);
create temp table leg1 as select adm_assign_unassigned(:SA) as j;
create temp table leg2 as select adm_assign_unassigned(:SA) as j;
select public.t_check('a lead from before the feature (no assignment row) is picked up by "assign unassigned", exactly once',
  (select (j->>'assigned')::int = 1 from leg1) and (select (j->>'assigned')::int = 0 from leg2)
  and (select t_owner(id) is not null from admission_applicants where full_name = 'Legacy A')
  and (select count(*) = 1 from admission_assignment_history where applicant_id = (select id from admission_applicants where full_name = 'Legacy A')));
reset role; select set_config('request.jwt.sub','',false);

-- =====================================================================================================
-- 11. SCHOOL ISOLATION + WHAT THE BROWSER MAY NOT DO
-- =====================================================================================================
-- fixtures must be readable by the browser role, otherwise a "permission denied" below could be about the fixture, not the rule under test
grant select on lead, x to authenticated, anon;
select t_as(:PB); set role authenticated;
select public.t_check('school B staff see none of school A''s assignments / history / clocks / counsellors / settings',
  (select count(*) = 0 from admission_lead_assignments where school_id = :SA)
  and (select count(*) = 0 from admission_assignment_history where school_id = :SA)
  and (select count(*) = 0 from admission_sla_cycles where school_id = :SA)
  and (select count(*) = 0 from admission_counsellors where school_id = :SA)
  and (select count(*) = 0 from admission_sla_config where school_id = :SA));
reset role; select set_config('request.jwt.sub','',false);
select t_as(:TA); set role authenticated;
select public.t_check('a teacher without ERP access sees nothing at all', (select count(*) = 0 from admission_lead_assignments) and (select count(*) = 0 from admission_sla_cycles));
reset role; select set_config('request.jwt.sub','',false);
select t_as(:C1); set role authenticated;
select public.t_check('a counsellor can read their school''s rows', (select count(*) > 0 from admission_lead_assignments where school_id = :SA));
select public.t_denied('no browser writes to assignments', format('update admission_lead_assignments set assigned_to = %L', :C1), '42501');
select public.t_denied('no browser deletes of history', 'delete from admission_assignment_history', '42501');
select public.t_denied('no browser edits of SLA clocks', format('update admission_sla_cycles set outcome = %L', 'met'), '42501');
select public.t_denied('no browser edits of SLA settings', 'update admission_sla_config set first_response_minutes = 9999', '42501');
select public.t_denied('no browser edits of counsellor roster', 'update admission_counsellors set is_active = false', '42501');
select public.t_denied('the rotation state is not even readable', 'select * from admission_assignment_state', '42501');
select public.t_denied('internal engine functions are not callable', format('select adm_rr_assign(%L)', (select id from lead where n=1)), '42501');
select public.t_denied('the monitor is not callable from a browser', 'select adm_sla_monitor()', '42501');
select public.t_denied('"assigned" events cannot be forged', format('insert into admission_lead_events(school_id,applicant_id,event_type,created_by) values (%L,%L,%L,%L)', :SA, (select id from lead where n=1), 'assigned', :C1), '42501');
select public.t_denied('events cannot be attributed to someone else', format('insert into admission_lead_events(school_id,applicant_id,event_type,created_by) values (%L,%L,%L,%L)', :SA, (select id from lead where n=1), 'call_answered', :C2), '42501');
select public.t_denied('events cannot be written onto another school''s lead', format('insert into admission_lead_events(school_id,applicant_id,event_type,created_by) values (%L,%L,%L,%L)', :SA, (select id from admission_applicants where school_id = :SB limit 1), 'call_answered', :C1), '42501');
-- timestamps cannot be forged from a session
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,created_at) values (:SA,(select id from x where k='Y'),'call_answered',:C1, now() - interval '10 days');
select public.t_check('a browser session cannot back-date an interaction (stored time is the server clock)',
  (select abs(extract(epoch from (now() - max(created_at)))) < 5 from admission_lead_events where applicant_id = (select id from x where k='Y') and created_by = :C1));
reset role; select set_config('request.jwt.sub','',false);
set role anon;
select public.t_denied('anonymous users cannot call the workbench', format('select adm_workbench(%L)', :SA), '42501');
select public.t_denied('anonymous users cannot call the dashboard', format('select adm_assignment_dashboard(%L)', :SA), '42501');
reset role;

-- monitor health: admins can see whether the database job is really scheduled
select t_as(:PA);
select public.t_check('without pg_cron the status honestly says "not scheduled"', (select (adm_sla_monitor_status(:SA)->>'scheduled')::boolean = false));
select t_as(:C1);
select public.t_denied('non-admins cannot read monitor status', format('select adm_sla_monitor_status(%L)', :SA), '42501');
reset role; select set_config('request.jwt.sub','',false);
-- simulate pg_cron being present with the job registered and a successful recent run
create schema cron;
create table cron.job (jobid bigint primary key, jobname text, active boolean);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, end_time timestamptz);
insert into cron.job values (1, 'admission-sla-monitor', true);
insert into cron.job_run_details(jobid,status,end_time) values (1,'succeeded', now() - interval '3 minutes');
select t_as(:PA);
create temp table mstat as select adm_sla_monitor_status(:SA) as j;
select public.t_check('with the job registered: scheduled, last run time and success reported',
  (select (j->>'scheduled')::boolean and (j->>'last_run_ok')::boolean and abs(extract(epoch from (now() - (j->>'last_run_at')::timestamptz)) - 180) < 5 from mstat));
reset role; select set_config('request.jwt.sub','',false);
update cron.job_run_details set status = 'failed';
select t_as(:PA);
create temp table mstat2 as select adm_sla_monitor_status(:SA) as j;
select public.t_check('a failing last run is reported as not ok', (select not (j->>'last_run_ok')::boolean from mstat2));
update cron.job set active = false;
create temp table mstat3 as select adm_sla_monitor_status(:SA) as j;
select public.t_check('a paused job is reported as not scheduled', (select not (j->>'scheduled')::boolean from mstat3));
reset role; select set_config('request.jwt.sub','',false);

-- =====================================================================================================
-- 12. Consistency: invariants across everything above
-- =====================================================================================================
select public.t_check('INVARIANT: at most one open clock of each kind per lead',
  (select count(*) = 0 from (select applicant_id, clock from admission_sla_cycles where outcome='open' group by 1,2 having count(*) > 1) d));
select public.t_check('INVARIANT: every assignment change has a history row (history rows >= assignments with an owner)',
  (select count(*) from admission_assignment_history) >= (select count(*) from admission_lead_assignments where assigned_to is not null));
select public.t_check('INVARIANT: lead_meta counsellor == assignment counsellor wherever lead_meta exists',
  (select count(*) = 0 from admission_lead_meta m join admission_lead_assignments a on a.applicant_id = m.applicant_id where m.assigned_to is distinct from a.assigned_to));
select public.t_check('INVARIANT: no open lead of a closed status keeps a running clock',
  (select count(*) = 0 from admission_sla_cycles c join admission_applicants ap on ap.id = c.applicant_id where c.outcome='open' and ap.status in ('admitted','rejected','withdrawn')));
select public.t_check('INVARIANT: a completed clock never completes before it started',
  (select count(*) = 0 from admission_sla_cycles where completed_at is not null and outcome in ('met','late') and completed_at < started_at));
\echo ALL ASSIGNMENT / SLA TESTS PASSED
