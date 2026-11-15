-- Run: psql -v ON_ERROR_STOP=1 -f admission_lead_ingest_stub.sql -f ../migrations/20261113000000_admission_lead_integrations.sql -f admission_lead_ingest.test.sql
-- (against a scratch database). Raises an exception on the first failed assertion.
\set ON_ERROR_STOP on
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAIL: %', label; end if; raise notice 'ok   - %', label; end $$;

insert into schools(id,name) values ('00000000-0000-0000-0000-0000000000a1','School A'),('00000000-0000-0000-0000-0000000000b2','School B');
insert into profiles(id,school_id,role) values
 ('00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000a1','principal'),
 ('00000000-0000-0000-0000-00000000aa02','00000000-0000-0000-0000-0000000000a1','school_admin'),
 ('00000000-0000-0000-0000-00000000aa03','00000000-0000-0000-0000-0000000000a1','teacher'),
 ('00000000-0000-0000-0000-00000000bb01','00000000-0000-0000-0000-0000000000b2','principal');
insert into admission_intakes(id,school_id,academic_year,grade,is_open) values
 ('00000000-0000-0000-0000-0000000001a1','00000000-0000-0000-0000-0000000000a1','2026-27','Grade 5',true),
 ('00000000-0000-0000-0000-0000000001a2','00000000-0000-0000-0000-0000000000a1','2026-27','Nursery',true),
 ('00000000-0000-0000-0000-0000000001a3','00000000-0000-0000-0000-0000000000a1','2026-27','Grade 9',false);
insert into admission_integrations(id,school_id,provider,name,default_intake_id,created_by,notify_emails) values
 ('00000000-0000-0000-0000-0000000002a1','00000000-0000-0000-0000-0000000000a1','meta','Meta - Spring',null,'00000000-0000-0000-0000-00000000aa01','{admissions@school.test}'),
 ('00000000-0000-0000-0000-0000000002a2','00000000-0000-0000-0000-0000000000a1','website','Website',
    '00000000-0000-0000-0000-0000000001a2','00000000-0000-0000-0000-00000000aa01','{}');


grant execute on function public.ingest_admission_lead(uuid,jsonb,text,text,boolean) to service_role;

\set M '''00000000-0000-0000-0000-0000000002a1'''
\set W '''00000000-0000-0000-0000-0000000002a2'''

-- 1. creates a lead in the existing CRM table, matched to the open Grade 5 intake
select pg_temp.check('create: status', (select ingest_admission_lead(:M::uuid,
  '{"student_name":"Aarav Sharma","parent_name":"Priya Sharma","phone":"+91 98765 43210","email":"Priya@Example.com","grade":"Class 5","gender":"Boy"}','L1')->>'status') = 'created');
select pg_temp.check('create: applicant row', (select count(*) from admission_applicants where full_name='Aarav Sharma' and parent_phone='+91 98765 43210'
   and parent_email='priya@example.com' and source='online_enquiry' and status='under_review' and gender='male'
   and intake_id='00000000-0000-0000-0000-0000000001a1' and school_id='00000000-0000-0000-0000-0000000000a1')=1);
select pg_temp.check('create: lead meta source + follow-up due', (select count(*) from admission_lead_meta where lead_source='meta' and external_lead_id='L1' and next_follow_up_at > now() + interval '23 hours')=1);
select pg_temp.check('create: timeline event', (select count(*) from admission_lead_events where event_type='lead_created')=1);
select pg_temp.check('create: admins notified (2), teacher not, other school not',
  (select count(*) from governance_notifications where event_type='admission_lead')=2);
select pg_temp.check('create: counters', (select leads_received=1 and leads_created=1 and last_success_at is not null from admission_integrations where id=:M::uuid));

-- 2. idempotent redelivery of the same external id
select pg_temp.check('retry same external id is idempotent', (select ingest_admission_lead(:M::uuid,
  '{"student_name":"Aarav Sharma","phone":"9876543210"}','L1')->>'status')='idempotent');
select pg_temp.check('idempotent: still one applicant', (select count(*) from admission_applicants)=1);

-- 3. duplicate by phone in a different format, other source, new external id
select pg_temp.check('duplicate detected across sources/format', (select ingest_admission_lead(:W::uuid,
  '{"student_name":"  aarav   SHARMA ","parent_name":"P Sharma","phone":"098765-43210","email":"new@x.com"}','W1')->>'status')='duplicate');
select pg_temp.check('duplicate: no new applicant', (select count(*) from admission_applicants)=1);
select pg_temp.check('duplicate: enquiry_count bumped + repeat event', (select enquiry_count=2 from admission_lead_meta) and (select count(*) from admission_lead_events where event_type='repeat_enquiry')=1);
select pg_temp.check('duplicate: existing email kept (not overwritten)', (select parent_email='priya@example.com' from admission_applicants));
select pg_temp.check('duplicate: repeat notification sent', (select count(*) from governance_notifications where event_type='admission_lead_repeat')=2);

-- 4. duplicate by email only
select pg_temp.check('duplicate by email only', (select ingest_admission_lead(:W::uuid,
  '{"student_name":"Aarav Sharma","phone":"9111111111","email":"PRIYA@example.com"}','W2')->>'status')='duplicate');

-- 5. sibling (same parent phone, different child) is a NEW lead
select pg_temp.check('sibling is not a duplicate', (select ingest_admission_lead(:W::uuid,
  '{"student_name":"Diya Sharma","parent_name":"Priya Sharma","phone":"9876543210","grade":"Nursery"}','W3')->>'status')='created');
select pg_temp.check('sibling routed to Nursery intake', (select intake_id='00000000-0000-0000-0000-0000000001a2' from admission_applicants where full_name='Diya Sharma'));

-- 6. fall back to the integration default intake; unknown grade
select pg_temp.check('unknown grade uses default intake', (select ingest_admission_lead(:W::uuid,
  '{"student_name":"Rohan","phone":"9000000001","grade":"Grade 12"}','W4')->>'status')='created');
select pg_temp.check('...and landed in default intake', (select intake_id='00000000-0000-0000-0000-0000000001a2' from admission_applicants where full_name='Rohan'));

-- 7. no intake anywhere -> needs_review, payload retained for retry; NOT lost, NOT created
select pg_temp.check('no intake -> needs_review', (select ingest_admission_lead(:M::uuid,
  '{"student_name":"Kabir","phone":"9000000002","grade":"Grade 9"}','L2','ENCRYPTEDBLOB')->>'status')='needs_review');
select pg_temp.check('needs_review keeps encrypted payload', (select payload_enc='ENCRYPTEDBLOB' from admission_lead_ingestions where external_lead_id='L2'));
select pg_temp.check('closed intake not used', (select count(*) from admission_applicants where full_name='Kabir')=0);
-- admin fixes it (default intake) and replays the SAME external id
update admission_integrations set default_intake_id='00000000-0000-0000-0000-0000000001a1' where id=:M::uuid;
select pg_temp.check('retry after fix creates the lead', (select ingest_admission_lead(:M::uuid,
  '{"student_name":"Kabir","phone":"9000000002","grade":"Grade 9"}','L2')->>'status')='created');
select pg_temp.check('retry reuses log row, clears payload', (select count(*)=1 and bool_and(payload_enc is null and status='created') from admission_lead_ingestions where external_lead_id='L2'));

-- 8. validation
select pg_temp.check('no phone & no email rejected', (select ingest_admission_lead(:M::uuid,'{"student_name":"X"}','V1')->>'status')='failed');
select pg_temp.check('short phone rejected', (select ingest_admission_lead(:M::uuid,'{"student_name":"X","phone":"12345"}','V2')->>'status')='failed');
select pg_temp.check('bad email rejected', (select ingest_admission_lead(:M::uuid,'{"student_name":"X","email":"nope"}','V3')->>'status')='failed');
select pg_temp.check('email-only lead accepted', (select ingest_admission_lead(:M::uuid,'{"student_name":"EmailOnly","email":"eo@x.com","grade":"5"}','V4')->>'status')='created');
select pg_temp.check('failures counted', (select leads_failed>=4 from admission_integrations where id=:M::uuid));
select pg_temp.check('SQL injection-ish input stored verbatim, harmless', (select ingest_admission_lead(:M::uuid,
  '{"student_name":"Robert''); drop table admission_applicants;--","phone":"9000000009","grade":"5","date_of_birth":"not a date","gender":"???"}','V5')->>'status')='created');
select pg_temp.check('bad dob -> null, odd gender -> other', (select date_of_birth is null and gender='other' from admission_applicants where full_name like 'Robert%'));

-- 9. paused integration rejects; test leads create nothing
update admission_integrations set status='paused' where id=:W::uuid;
select pg_temp.check('paused rejects', (select ingest_admission_lead(:W::uuid,'{"student_name":"P","phone":"9000000010"}','P1')->>'status')='rejected');
update admission_integrations set status='active' where id=:W::uuid;
select pg_temp.check('test lead creates nothing', (select ingest_admission_lead(:W::uuid,'{"student_name":"T","phone":"9000000011"}','T1',null,true)->>'status')='test'
  and (select count(*) from admission_applicants where full_name='T')=0);

-- 10. rate limit
update admission_integrations set config='{"rate_limit_per_min":3}' where id=:W::uuid;
do $$ declare r jsonb; i int; begin
  for i in 1..6 loop r := ingest_admission_lead('00000000-0000-0000-0000-0000000002a2'::uuid, jsonb_build_object('student_name','R'||i,'phone','90000001'||lpad(i::text,2,'0')),'RL'||i); end loop;
  perform pg_temp.check('rate limited eventually', r->>'status'='rate_limited'); end $$;

-- 11. tenant isolation: integration of school B can never write into school A's intakes
insert into admission_integrations(id,school_id,provider,name,default_intake_id,created_by) values
 ('00000000-0000-0000-0000-0000000002b1','00000000-0000-0000-0000-0000000000b2','website','B site','00000000-0000-0000-0000-0000000001a1',null);
select pg_temp.check('cross-tenant default intake is refused or fails safely',
  (select ingest_admission_lead('00000000-0000-0000-0000-0000000002b1'::uuid,'{"student_name":"Leak","phone":"9000000077"}','B1')->>'status') <> 'created'
  or (select school_id from admission_applicants where full_name='Leak') = '00000000-0000-0000-0000-0000000000b2');

-- 12. status change on a lead lands in the timeline
update admission_applicants set status='shortlisted' where full_name='Aarav Sharma';
select pg_temp.check('status change logged', (select count(*) from admission_lead_events where event_type='status_changed')=1);
select pg_temp.check('first contact stamped', (select last_contacted_at is not null from admission_lead_meta where external_lead_id='L1'));

-- 13. RLS: staff of school A see their rows, not school B's; secrets & payload are not readable
set role authenticated;
set request.jwt.sub = '00000000-0000-0000-0000-00000000aa01';
select pg_temp.check('A principal sees own integrations only', (select count(*) from admission_integrations)=2);
select pg_temp.check('A principal sees own meta', (select count(*) from admission_lead_meta)>0 and (select count(*)=0 from admission_lead_meta where school_id<>'00000000-0000-0000-0000-0000000000a1'));
set request.jwt.sub = '00000000-0000-0000-0000-00000000bb01';
select pg_temp.check('B principal cannot see A integrations', (select count(*) from admission_integrations where school_id='00000000-0000-0000-0000-0000000000a1')=0);
select pg_temp.check('B principal cannot see A events', (select count(*) from admission_lead_events where school_id='00000000-0000-0000-0000-0000000000a1')=0);
set request.jwt.sub = '00000000-0000-0000-0000-00000000aa03';
select pg_temp.check('teacher sees nothing', (select count(*) from admission_integrations)=0);
set request.jwt.sub = '00000000-0000-0000-0000-00000000aa01';
do $$ begin begin perform payload_enc from admission_lead_ingestions; raise exception 'payload readable'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform * from admission_integration_secrets; raise exception 'secrets readable'; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin update admission_integrations set name='hax'; if found then raise exception 'client updated integration'; end if; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin perform ingest_admission_lead('00000000-0000-0000-0000-0000000002a1'::uuid,'{}'); raise exception 'client can call ingest'; exception when insufficient_privilege then null; end; end $$;
do $$ begin insert into admission_lead_events(school_id,applicant_id,event_type,detail)
   select school_id,applicant_id,'follow_up_note','{"note":"called parent"}' from admission_lead_meta limit 1;
   raise notice 'ok   - client may add follow-up note'; end $$;
do $$ begin begin insert into admission_lead_events(school_id,applicant_id,event_type) select school_id,applicant_id,'lead_created' from admission_lead_meta limit 1; raise exception 'forged system event'; exception when insufficient_privilege or check_violation then null; end; end $$;
reset role;

-- 14. works when the PII-encryption view exists (dynamic target relation)
update admission_integrations set config='{}' where id=:W::uuid;
create view public.decrypted_admission_applicants as select * from public.admission_applicants;
select pg_temp.check('ingest via decrypted view', (select ingest_admission_lead(:M::uuid,
  '{"student_name":"ViaView","phone":"9000000055","grade":"Grade 5"}','VW1')->>'status')='created');
select pg_temp.check('...and dedupes via view', (select ingest_admission_lead(:W::uuid,
  '{"student_name":"ViaView","phone":"9000000055"}','VW2')->>'status')='duplicate');
\echo ALL SQL TESTS PASSED
