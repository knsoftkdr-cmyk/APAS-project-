-- Run: psql -v ON_ERROR_STOP=1 -f admission_lead_ingest_stub.sql -f ../migrations/20261113000000_admission_lead_integrations.sql \
--          -f ../migrations/20261114000000_admission_lead_scoring.sql -f admission_lead_scoring.test.sql   (scratch database)
-- Raises on the first failed assertion. Expected values are computed BY HAND from the spec formula (see comments),
-- not copied from the implementation's output.
\set ON_ERROR_STOP on

-- Test-only helpers live in public so they remain callable after SET ROLE authenticated.
create function public.t_check(label text, ok boolean) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAIL: %', label; end if; raise notice 'ok   - %', label; end $$;
-- Runs a statement as the current role and asserts it fails with the given SQLSTATE (or any error when NULL).
create function public.t_denied(label text, stmt text, state text default null) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if state is null or sqlstate = state then raise notice 'ok   - % (denied: %)', label, sqlerrm; return; end if;
    raise exception 'FAIL: % - wrong error % (%)', label, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % - statement was allowed', label;
end $$;
grant execute on function public.t_check(text, boolean), public.t_denied(text, text, text) to authenticated, anon;

-- users: PA principal A; TA teacher w/o ERP access (A); EA teacher WITH erp_access (A); PB principal B; PC principal C
-- intakes: IN1 Grade 5 (no fee), IN7 Grade 7 (fee set later), INB school B
\set SA '''00000000-0000-0000-0000-0000000000a1'''
\set SB '''00000000-0000-0000-0000-0000000000b2'''
\set SC '''00000000-0000-0000-0000-0000000000c3'''
\set PA '''00000000-0000-0000-0000-00000000aa01'''
\set TA '''00000000-0000-0000-0000-00000000aa03'''
\set EA '''00000000-0000-0000-0000-00000000aa04'''
\set PB '''00000000-0000-0000-0000-00000000bb01'''
\set PC '''00000000-0000-0000-0000-00000000cc01'''
\set IN1 '''00000000-0000-0000-0000-0000000001a1'''
\set IN7 '''00000000-0000-0000-0000-0000000001a7'''
\set INB '''00000000-0000-0000-0000-0000000001b1'''
\set A  '''00000000-0000-0000-0000-00000000a001'''
\set AB '''00000000-0000-0000-0000-00000000a00b'''
\set AC '''00000000-0000-0000-0000-00000000a00c'''
\set AD '''00000000-0000-0000-0000-00000000a00d'''
\set AE '''00000000-0000-0000-0000-00000000a00e'''
\set AF '''00000000-0000-0000-0000-00000000a00f'''
\set BB '''00000000-0000-0000-0000-00000000b001'''

insert into schools(id,name) values (:SA,'School A'),(:SB,'School B'),(:SC,'School C');
insert into profiles(id,school_id,role,erp_access) values
 (:PA,:SA,'principal',false),(:TA,:SA,'teacher',false),(:EA,:SA,'teacher',true),(:PB,:SB,'principal',false),(:PC,:SC,'principal',false);
insert into admission_intakes(id,school_id,academic_year,grade) values (:IN1,:SA,'2026-27','Grade 5'),(:IN7,:SA,'2026-27','Grade 7'),(:INB,:SB,'2026-27','Grade 5');

-- helper views for readability
create view public.t_s with (security_invoker = true) as select applicant_id, score, computed_score, category, coverage, factors, override_score from admission_lead_scores;
grant select on public.t_s to authenticated;
create function public.t_f(app uuid, f text) returns numeric language sql stable as
  $$ select (factors->f->>'score')::numeric from admission_lead_scores where applicant_id = app $$;

-- =====================================================================================================
-- 1. CATEGORY BOUNDARIES (Hot 70-100, Warm 40-69, Cold 0-39)
-- =====================================================================================================
select public.t_check('boundaries 0/39 cold, 40/69 warm, 70/100 hot',
  (select array_agg(adm_score_category(s, adm_score_config(:SA)) order by s) = array['cold','cold','warm','warm','hot','hot']
     from unnest(array[0,39,40,69,70,100]) s));
select public.t_check('default weights are 30/25/25/20',
  (adm_score_config(:SA)->'weights') = '{"interest":30,"engagement":25,"readiness":25,"budget":20}'::jsonb);

-- =====================================================================================================
-- 2. CALCULATION, hand-computed. prior=15, weights 30/25/25/20. factor = (sum(w*s)+15*50)/(sum(w)+15)
-- =====================================================================================================
-- Lead A: referral, all 7 profile fields, sibling here, status under_review, created now, nothing else known.
--  Interest: channel 90(w20) repeat 50(w25) details 100(w20) sibling 100(w15) -> (1800+1250+2000+1500+750)/95 = 76.84
--  Readiness: status 40(w30); documents skipped (grace period); visit skipped -> (1200+750)/45 = 43.33
--  Engagement + Budget: no evidence -> excluded (NOT zero). Total = (30*76.84+25*43.33)/55 = 61.61 -> 62
insert into admission_applicants(id,intake_id,full_name,date_of_birth,gender,parent_name,parent_phone,parent_email,address,
   previous_school_name,previous_grade,previous_percentage,sibling_studying_here,source,recorded_by)
 values (:A,:IN1,'Lead A','2018-01-01','female','Pa','9000000001','a@x.test','1 Street','Old School','Grade 4',88,true,'referral',:PA);
select public.t_check('A: scored automatically on insert, 62 / warm', (select score=62 and computed_score=62 and category='warm' from t_s where applicant_id=:A));
select public.t_check('A: interest 76.84', public.t_f(:A,'interest') = 76.84);
select public.t_check('A: readiness 43.33 (no doc penalty inside grace period, no visit penalty)', public.t_f(:A,'readiness') = 43.33);
select public.t_check('A: engagement & budget unknown -> excluded, not zero',
  (select not (factors->'engagement'->>'available')::boolean and factors->'engagement'->>'score' is null
      and not (factors->'budget'->>'available')::boolean from t_s where applicant_id=:A));
select public.t_check('A: coverage 55% (only 2 of 4 factors had data)', (select coverage = 55 from t_s where applicant_id=:A));
select public.t_check('A: factor contributions add up to the score (+/-0.05)',
  (select abs((select sum((f->>'contribution')::numeric) from jsonb_each(factors) e(k,f) where (f->>'available')::boolean) - 61.61) < 0.05 from t_s where applicant_id=:A));
select public.t_check('A: first history row recorded (system, no old score)',
  (select count(*)=1 and bool_and(change_type='auto' and old_score is null and new_score=62 and created_by is null and trigger_source='applicant_created')
     from admission_lead_score_history where applicant_id=:A));

-- Fairness: a bare online enquiry (nothing known beyond the enquiry) must NOT be Cold.
--  Interest: channel 55(w20) repeat 50(w25) details 0/7=0(w20) -> (1100+1250+0+750)/80 = 38.75 ; Readiness 43.33
--  Total = (30*38.75+25*43.33)/55 = 40.83 -> 41
insert into admission_applicants(id,intake_id,full_name,parent_name,parent_phone,source,recorded_by) values (:AB,:IN1,'Bare enquiry','Pb','9000000002','online_enquiry',:PA);
select public.t_check('bare enquiry (missing info) is Warm 41, not Cold', (select score=41 and category='warm' from t_s where applicant_id=:AB));

-- Real negative evidence DOES make a lead Cold: 3 unanswered calls + a missed visit on the same bare enquiry.
--  Engagement: call_connect 0(w30) interactions 0(w15) recency 100(w15: agreeing to a visit is real contact) -> (1500+750)/75 = 30.00
--  Readiness: status 40(w30) visit 15(w35) -> (1200+525+750)/80 = 30.94 ; Interest 38.75
--  Total = (30*38.75+25*30.00+25*30.94)/80 = 33.58 -> 34
insert into admission_lead_events(school_id,applicant_id,event_type) select :SA,:AB,'call_not_answered' from generate_series(1,3);
insert into admission_lead_events(school_id,applicant_id,event_type) values (:SA,:AB,'visit_scheduled'),(:SA,:AB,'visit_missed');
select public.t_check('evidence of disengagement -> Cold 34', (select score=34 and category='cold' from t_s where applicant_id=:AB));
select public.t_check('unanswered calls count as zero connection and zero interactions',
  (select (select (s->>'score')::numeric from jsonb_array_elements(factors->'engagement'->'signals') s where s->>'key'='call_connect') = 0
      and (select (s->>'score')::numeric from jsonb_array_elements(factors->'engagement'->'signals') s where s->>'key'='interactions') = 0
   from t_s where applicant_id=:AB));

-- Documents: zero documents is only a negative once the lead is older than the grace period (14 days).
--  readiness = status 40(w30) + documents 0(w35) -> (1200+750)/80 = 24.38 ; inside grace it was 43.33
insert into admission_applicants(id,intake_id,full_name,parent_name,parent_phone,source,recorded_by,created_at) values (:AE,:IN1,'Old lead','Pe','9000000005','online_enquiry',:PA, now()-interval '20 days');
select public.adm_recalc_lead_score(:AE,'test');
select public.t_check('no documents after the grace period counts (24.38)', public.t_f(:AE,'readiness') = 24.38);

-- Rounding follows the displayed number: Lead A + 3 answered calls.
--  Engagement: connect 100(w30) interactions k=3 ->85(w15) recency 100(w15) -> (3000+1275+1500+750)/75 = 87.00
--  Total = (30*76.84+25*87+25*43.33)/80 = 69.54 -> displays 70 -> Hot
insert into admission_lead_events(school_id,applicant_id,event_type) select :SA,:A,'call_answered' from generate_series(1,3);
select public.t_check('A: calls answered raise engagement to 87.00 automatically', public.t_f(:A,'engagement') = 87.00);
select public.t_check('A: 69.54 rounds to 70 and is Hot (score shown == category)', (select score=70 and computed_score=70 and category='hot' from t_s where applicant_id=:A));
select public.t_check('A: the change is in the audit history exactly once (62 warm -> 70 hot; one statement = one recalculation result)',
  (select count(*)=2 and (array_agg(new_score order by created_at, new_score))=array[62,70] and (array_agg(new_category order by created_at, new_score))[2]='hot'
          and (array_agg(trigger_source order by created_at, new_score))[2]='interaction_logged' from admission_lead_score_history where applicant_id=:A));

-- Everything known (all four factors): messages, follow-ups, documents, visit, status, qualification.
insert into admission_lead_events(school_id,applicant_id,event_type) values
 (:SA,:A,'message_sent'),(:SA,:A,'message_sent'),(:SA,:A,'message_replied'),(:SA,:A,'message_replied'),
 (:SA,:A,'follow_up_note'),(:SA,:A,'follow_up_note'),(:SA,:A,'follow_up_note'),(:SA,:A,'visit_completed');
insert into admission_documents(applicant_id,document_type,file_path) values (:A,'report_card','p/1'),(:A,'birth_certificate','p/2'),(:A,'id_proof','p/3'),(:A,'photo','p/4');
update admission_applicants set status='shortlisted' where id=:A;
select public.adm_save_lead_qualification(:A, null, null, null, 'comfortable', 'immediate') where false; -- (auth-checked RPC is exercised in the permissions section)
insert into admission_lead_qualification(applicant_id,school_id,fee_affordability,admission_timeline) values (:A,:SA,'comfortable','immediate');
--  Engagement 5 signals all 100 -> (10000+750)/115 = 93.48 ; Readiness status70(w30) docs100(w35) visit100(w35) -> (9100+750)/115 = 85.65
--  Budget 100(w55) 100(w45) -> 93.48 ; Interest 76.84.  Total = (30*76.84+25*93.48+25*85.65+20*93.48)/100 = 86.53 -> 87
select public.t_check('A: engagement 93.48', public.t_f(:A,'engagement') = 93.48);
select public.t_check('A: readiness 85.65', public.t_f(:A,'readiness') = 85.65);
select public.t_check('A: budget & timeline 93.48', public.t_f(:A,'budget') = 93.48);
select public.t_check('A: total 87 hot, full coverage', (select score=87 and category='hot' and coverage=100 from t_s where applicant_id=:A));
select public.t_check('A: documents/events/status/qualification each triggered a recalculation',
  (select count(distinct trigger_source) >= 4 from admission_lead_score_history where applicant_id=:A));

-- Budget compared with a real intake fee: ratio >=1 ->100, >=.85 ->75, >=.7 ->45, else 15
insert into admission_applicants(id,intake_id,full_name,parent_name,parent_phone,source,recorded_by) values (:AF,:IN7,'Fee lead','Pf','9000000006','online_enquiry',:PA);
insert into admission_lead_qualification(applicant_id,school_id,annual_budget) values (:AF,:SA,80000);
select public.t_check('budget given but no fee set and no timeline -> budget factor unknown', (select not (factors->'budget'->>'available')::boolean from t_s where applicant_id=:AF));
update admission_intakes set annual_fee = 100000 where id=:IN7;   -- ratio 0.80 -> 45 ; (55*45+750)/70 = 46.07
select public.t_check('setting the intake fee re-scores its leads: 80% of fee -> 46.07', public.t_f(:AF,'budget') = 46.07);
update admission_intakes set annual_fee = 80000 where id=:IN7;    -- ratio 1.0 -> 100 ; (5500+750)/70 = 89.29
select public.t_check('fee change re-scores again: fully covered -> 89.29', public.t_f(:AF,'budget') = 89.29);

-- No-op updates do not churn the audit log.
select count(*) as n0 from admission_lead_score_history where applicant_id=:A \gset
update admission_applicants set meeting_notes='note only' where id=:A;       -- not a scoring input
select adm_recalc_lead_score(:A,'test');                                      -- same inputs
select public.t_check('unchanged inputs add no history rows', (select count(*) = :n0 from admission_lead_score_history where applicant_id=:A));

-- =====================================================================================================
-- 3. CONFIGURABLE WEIGHTS / THRESHOLDS (default behaviour proven above)
-- =====================================================================================================
select set_config('request.jwt.sub', :PA, false); set role authenticated;
select public.t_check('principal can retune weights; all school scores recalculated',
  (adm_set_score_config(:SA, '{"weights":{"interest":40,"engagement":20,"readiness":20,"budget":20}}')->>'recalculated')::int = 4);
reset role;
--  Lead A with 40/20/20/20: (40*76.84+20*93.48+20*85.65+20*93.48)/100 = 85.26 -> 85
select public.t_check('A rescored with the new weights (85)', (select score=85 from t_s where applicant_id=:A));
set role authenticated;
select public.t_denied('weights that do not total 100 are rejected', $$select adm_set_score_config('00000000-0000-0000-0000-0000000000a1','{"weights":{"interest":50,"engagement":20,"readiness":20,"budget":20}}')$$, '22023');
select public.t_denied('negative weight rejected', $$select adm_set_score_config('00000000-0000-0000-0000-0000000000a1','{"weights":{"interest":-10,"engagement":50,"readiness":30,"budget":30}}')$$, '22023');
select public.t_check('custom hot threshold applies (hot_min 90 -> 85 is Warm)',
  (adm_set_score_config(:SA, '{"hot_min":90}')->>'hot_min')::int = 90);
reset role;
select public.t_check('A is now Warm under hot_min=90', (select category='warm' from t_s where applicant_id=:A));
select set_config('request.jwt.sub', :PA, false); set role authenticated;
select adm_set_score_config(:SA, '{"hot_min":70,"weights":{"interest":30,"engagement":25,"readiness":25,"budget":20}}');
reset role; select set_config('request.jwt.sub', :TA, false); set role authenticated;
select public.t_denied('teacher cannot change configuration', $$select adm_set_score_config('00000000-0000-0000-0000-0000000000a1','{"hot_min":60}')$$, '42501');
reset role;
select public.t_check('defaults restored, A back to 87 hot', (select score=87 and category='hot' from t_s where applicant_id=:A));

-- =====================================================================================================
-- 4. MANUAL ADJUSTMENT + AUDIT
-- =====================================================================================================
select set_config('request.jwt.sub', :PA, false); set role authenticated;
select public.t_denied('reason is mandatory', format('select adm_set_lead_score_override(%L,50,%L)', :A, ''), '22023');
select public.t_denied('reason too short', format('select adm_set_lead_score_override(%L,50,%L)', :A, 'ok'), '22023');
select public.t_denied('score above 100 rejected', format('select adm_set_lead_score_override(%L,101,%L)', :A, 'valid reason'), '22023');
select public.t_denied('score below 0 rejected', format('select adm_set_lead_score_override(%L,-1,%L)', :A, 'valid reason'), '22023');
select public.t_denied('clearing when nothing is overridden is rejected', format('select adm_clear_lead_score_override(%L,%L)', :A, 'no override here'), '22023');
select adm_set_lead_score_override(:A, 39, 'Parent told us they are relocating abroad');
select public.t_check('override 39 -> Cold, calculation preserved at 87', (select score=39 and category='cold' and computed_score=87 and override_score=39 from t_s where applicant_id=:A));
select adm_set_lead_score_override(:A, 40, 'Re-checked: still interested but undecided');
select public.t_check('override 40 -> Warm', (select score=40 and category='warm' from t_s where applicant_id=:A));
select adm_set_lead_score_override(:A, 69, 'Visit went well, fee discussion pending');
select public.t_check('override 69 -> Warm', (select score=69 and category='warm' from t_s where applicant_id=:A));
select adm_set_lead_score_override(:A, 70, 'Confirmed seat verbally with the principal');
select public.t_check('override 70 -> Hot', (select score=70 and category='hot' from t_s where applicant_id=:A));
reset role;
select public.t_check('override records who, when and why',
  (select override_by = :PA::uuid and override_at is not null and override_reason = 'Confirmed seat verbally with the principal' from admission_lead_scores where applicant_id=:A));
-- Automatic recalculation continues underneath but must not silently drop the manual decision.
insert into admission_lead_events(school_id,applicant_id,event_type) values (:SA,:A,'call_not_answered');
select public.t_check('auto-recalc keeps the override; computed value still tracks reality',
  (select score=70 and override_score=70 and computed_score <> 87 from t_s where applicant_id=:A));
select set_config('request.jwt.sub', :PA, false); set role authenticated;
select adm_clear_lead_score_override(:A, 'Visit complete, back to the calculated score');
reset role;
select public.t_check('clearing returns to the calculated score', (select override_score is null and score=computed_score from t_s where applicant_id=:A));
select public.t_check('audit trail has every manual change with reason, actor and before/after',
  (select count(*) filter (where change_type='manual_override') = 4 and count(*) filter (where change_type='manual_clear') = 1
      and bool_and(change_type='auto' or (char_length(reason) >= 5 and created_by = :PA::uuid and old_score is not null))
      and exists (select 1 from admission_lead_score_history where applicant_id=:A and change_type='manual_override'
                    and old_score=87 and new_score=39 and old_category='hot' and new_category='cold' and computed_score=87)
   from admission_lead_score_history where applicant_id=:A));

-- =====================================================================================================
-- 5. PERMISSIONS & SCHOOL ISOLATION
-- =====================================================================================================
insert into admission_applicants(id,intake_id,full_name,parent_name,parent_phone,source,recorded_by) values (:BB,:INB,'School B lead','Pbb','9000000009','walk_in',:PB);
select public.t_check('scores exist for both schools', (select count(distinct school_id)=2 from admission_lead_scores));

-- principal of A
select set_config('request.jwt.sub', :PA, false); set role authenticated;
select public.t_check('A principal sees only school A scores', (select count(*) > 0 and bool_and(applicant_id <> :BB::uuid) from t_s));
select public.t_check('A principal sees only school A history', (select count(*) > 0 and bool_and(school_id = :SA::uuid) from admission_lead_score_history));
select public.t_denied('A principal cannot override a school B lead', format('select adm_set_lead_score_override(%L,90,%L)', :BB, 'cross school attempt'), '42501');
select public.t_denied('A principal cannot save qualification for a school B lead', format('select adm_save_lead_qualification(%L,%L,null,null,null,null)', :BB, 'high'), '42501');
select public.t_denied('cannot write a score directly', format('update admission_lead_scores set score=100, category=%L where applicant_id=%L', 'hot', :AB), '42501');
select public.t_denied('cannot insert a score directly', format('insert into admission_lead_scores(applicant_id,school_id,computed_score,score,category,coverage,factors) values (%L,%L,1,1,%L,1,%L)', :AB, :SA, 'cold', '{}'), '42501');
select public.t_denied('cannot edit audit history', 'update admission_lead_score_history set new_score = 0', '42501');
select public.t_denied('cannot delete audit history', 'delete from admission_lead_score_history', '42501');
select public.t_denied('cannot edit the calculation internals', format('select adm_compute_lead_score(%L)', :A), '42501');
select public.t_denied('cannot force a recalculation function directly', format('select adm_recalc_lead_score(%L)', :A), '42501');
select public.t_denied('cannot log an interaction on a school B lead (even with own school id)',
  format('insert into admission_lead_events(school_id,applicant_id,event_type,created_by) values (%L,%L,%L,%L)', :SA, :BB, 'call_answered', :PA), '42501');
select public.t_denied('cannot log an interaction as someone else',
  format('insert into admission_lead_events(school_id,applicant_id,event_type,created_by) values (%L,%L,%L,%L)', :SA, :A, 'call_answered', :TA), '42501');
select public.t_denied('cannot forge system event types (e.g. lead_created)',
  format('insert into admission_lead_events(school_id,applicant_id,event_type,created_by) values (%L,%L,%L,%L)', :SA, :A, 'lead_created', :PA), '42501');
insert into admission_lead_events(school_id,applicant_id,event_type,created_by,detail) values (:SA,:AB,'message_replied',:PA::uuid,'{}');   -- legitimate staff logging works
select public.t_check('staff can log an interaction on their own lead', true);
select adm_save_lead_qualification(:AB, 'high', 'Science stream', 90000, 'manageable', 'this_term');
select public.t_check('staff can save qualification', (select interest_level='high' and annual_budget=90000 from admission_lead_qualification where applicant_id=:AB));
select public.t_denied('invalid qualification values are rejected by constraints', format('select adm_save_lead_qualification(%L,%L,null,null,null,null)', :AB, 'extreme'));
reset role;
select public.t_check('qualification + interaction re-scored the lead (interest now includes staff view + course)',
  (select exists (select 1 from jsonb_array_elements(factors->'interest'->'signals') s where s->>'key'='staff_interest' and (s->>'score')::numeric=100)
      and exists (select 1 from jsonb_array_elements(factors->'interest'->'signals') s where s->>'key'='course')
   from t_s where applicant_id=:AB));

-- teacher WITHOUT erp access: no access at all
select set_config('request.jwt.sub', :TA, false); set role authenticated;
select public.t_check('teacher (no CRM access) sees no scores', (select count(*)=0 from t_s));
select public.t_check('teacher sees no history', (select count(*)=0 from admission_lead_score_history));
select public.t_denied('teacher cannot override a score', format('select adm_set_lead_score_override(%L,10,%L)', :A, 'not authorised at all'), '42501');
select public.t_denied('teacher cannot save qualification', format('select adm_save_lead_qualification(%L,%L,null,null,null,null)', :A, 'low'), '42501');
reset role;
-- teacher with erp_access = admissions staff
select set_config('request.jwt.sub', :EA, false); set role authenticated;
select public.t_check('ERP-access staff can view scores', (select count(*) > 0 from t_s));
select adm_set_lead_score_override(:AB, 55, 'ERP staff adjustment after phone call');
select public.t_check('ERP-access staff can adjust with a reason', (select score=55 and category='warm' from t_s where applicant_id=:AB));
reset role;

-- principal of B: sees only B
select set_config('request.jwt.sub', :PB, false); set role authenticated;
select public.t_check('B principal sees only school B', (select count(*)=1 and bool_and(applicant_id = :BB::uuid) from t_s));
select public.t_denied('B principal cannot read A config change', format('select adm_set_score_config(%L,%L)', :SA, '{"hot_min":10}'), '42501');
select public.t_denied('B principal cannot override A lead', format('select adm_set_lead_score_override(%L,5,%L)', :A, 'cross school attempt'), '42501');
reset role;
-- anonymous
set role anon;
select public.t_denied('anonymous cannot read scores', 'select * from public.admission_lead_scores', '42501');
select public.t_denied('anonymous cannot call overrides', format('select adm_set_lead_score_override(%L,5,%L)', :A, 'anonymous attempt'), '42501');
reset role;

-- =====================================================================================================
-- 6. REAL INGESTION FLOW, DELETES, AND FAILURE ISOLATION
-- =====================================================================================================
insert into admission_integrations(id,school_id,provider,name,created_by,default_intake_id) values
 ('00000000-0000-0000-0000-0000000002a1',:SA,'meta','Meta',:PA,:IN1);
grant execute on function public.ingest_admission_lead(uuid,jsonb,text,text,boolean) to service_role;
select ingest_admission_lead('00000000-0000-0000-0000-0000000002a1',
  '{"student_name":"Ishaan Rao","parent_name":"Kiran Rao","phone":"+91 90000 11111","email":"kiran@example.com","grade":"Grade 5"}','LS1');
select public.t_check('lead from an integration is scored automatically',
  (select count(*)=1 and bool_and(score between 0 and 100) from admission_lead_scores s join admission_applicants a on a.id=s.applicant_id where a.full_name='Ishaan Rao'));
select score as before_repeat from admission_lead_scores s join admission_applicants a on a.id=s.applicant_id where a.full_name='Ishaan Rao' \gset
select ingest_admission_lead('00000000-0000-0000-0000-0000000002a1',
  '{"student_name":"Ishaan Rao","parent_name":"Kiran Rao","phone":"+91 90000 11111","grade":"Grade 5"}','LS2');
select public.t_check('a repeat enquiry (merged duplicate) is read as stronger interest and re-scores the lead',
  (select exists (select 1 from jsonb_array_elements(s.factors->'interest'->'signals') x where x->>'key'='repeat_enquiries' and (x->>'score')::numeric=80)
      and s.score > :before_repeat
   from admission_lead_scores s join admission_applicants a on a.id=s.applicant_id where a.full_name='Ishaan Rao'));

delete from admission_applicants where id=:A;   -- has documents, events, qualification, a score and history; must not error
select public.t_check('deleting an applicant that has documents, events and a score works (cascade)', (select count(*)=0 from admission_applicants where id=:A));
select public.t_check('and leaves no orphans', (select count(*)=0 from admission_lead_scores where applicant_id=:A)
   and (select count(*)=0 from admission_lead_score_history where applicant_id=:A));

-- A scoring failure must never block admissions work: School C has a corrupt config, inserting a lead still succeeds.
alter table admission_score_config disable trigger all;
insert into admission_score_config(school_id,weights) values (:SC, '{"interest":"abc","engagement":25,"readiness":25,"budget":20}');
alter table admission_score_config enable trigger all;
insert into admission_intakes(id,school_id,academic_year,grade) values ('00000000-0000-0000-0000-0000000001c1',:SC,'2026-27','Grade 1');
insert into admission_applicants(id,intake_id,full_name,parent_name,parent_phone,source,recorded_by)
  values ('00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-0000000001c1','C lead','Pc','9000000010','walk_in',:PC);
select public.t_check('a scoring error does not block creating the applicant',
  (select count(*)=1 from admission_applicants where full_name='C lead') and (select count(*)=0 from admission_lead_scores where school_id=:SC));

-- Scheduled refresh picks up stale / missing scores (time-based signals age without row changes).
update admission_lead_scores set calculated_at = now() - interval '2 days' where applicant_id = :AB;
select adm_refresh_lead_scores(100) as refreshed \gset
select public.t_check('scheduled refresh skips the unscoreable lead but still refreshes the rest', :refreshed >= 1);
select public.t_check('stale score was recalculated', (select calculated_at > now() - interval '1 minute' from admission_lead_scores where applicant_id=:AB));

\echo ALL LEAD SCORING TESTS PASSED
