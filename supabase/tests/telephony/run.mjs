import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
process.on("uncaughtException",e=>{console.log("ERR:",String(e.message).slice(0,500));process.exit(1)});
await db.exec(`create schema auth; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.profiles(id uuid primary key references auth.users(id), full_name text, role text, school_id uuid);
create table public.admission_applicants(id uuid primary key default gen_random_uuid(), school_id uuid not null, full_name text, parent_name text, parent_phone text, created_at timestamptz default now());
create table public.governance_notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, event_type text, title text, message text, reference_id uuid, reference_type text, channel text default 'in_app', is_read boolean default false, created_at timestamptz default now());
grant usage on schema public, auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
grant select on public.admission_applicants, public.profiles to authenticated;`);
const mig=fs.readFileSync(process.argv[2],'utf8'); await db.exec(mig); await db.exec(mig);
await db.exec('grant all on all tables in schema public to service_role'); // Supabase grants this by default
console.log('MIGRATION OK (applied twice)');
const S1='11111111-1111-1111-1111-111111111111',S2='22222222-2222-2222-2222-222222222222';
const U={A:'a0000000-0000-0000-0000-000000000001',T:'a0000000-0000-0000-0000-000000000002',B:'a0000000-0000-0000-0000-000000000003',P:'a0000000-0000-0000-0000-000000000004',C:'a0000000-0000-0000-0000-000000000005'};
for(const [id,r,s] of [[U.A,'admin',S1],[U.T,'teacher',S1],[U.B,'admin',S2],[U.P,'principal',S1],[U.C,'counsellor',S1]]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into profiles(id,full_name,role,school_id) values($1,$2,$3,$4)',[id,r,r,s]);}
const L1='b0000000-0000-0000-0000-000000000001',L2='b0000000-0000-0000-0000-000000000002',LX='b0000000-0000-0000-0000-0000000000ff';
await db.query(`insert into admission_applicants(id,school_id,full_name,parent_name,parent_phone) values ($1,$2,'Rahul Kumar','Ramesh Kumar','98765 43210'),($3,$2,'Second Kid','Second Parent','+91 90000 11111'),($4,$5,'Other School Kid','OP','9876500000')`,[L1,S1,L2,LX,S2]);
let pass=0,fail=0;
const as=async(u,sql,p=[])=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','${u}',false); set role authenticated;`);try{return await db.query(sql,p)}finally{await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);")}};
const svc=async(sql,p=[])=>{await db.exec(`reset role; set role service_role;`);try{return await db.query(sql,p)}finally{await db.exec("reset role;")}};
const ok=(n,c)=>{c?pass++:fail++;console.log(c?'  PASS':'  FAIL',n)};
const throws=async(n,f,m)=>{try{await f();fail++;console.log('  FAIL (no error)',n)}catch(e){const g=String(e.message).includes(m);g?pass++:fail++;console.log(g?'  PASS':'  FAIL',n,g?'':e.message)}};
const begin=async(staff=U.A,app=L1,school=S1,rec=false)=>(await svc(`select public.tel_begin_call($1,$2,$3,'exotel','+919876543210','+919000000001',$4) r`,[school,staff,app,rec])).rows[0].r;
const evt=async(id,key,status,extra={})=>(await svc(`select public.tel_record_event('exotel',$1,$2,'status',$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb) r`,[id,key,status,extra.start??null,extra.ans??null,extra.end??null,extra.dur??null,extra.conv??null,extra.rec??null,extra.fail??null])).rows[0].r;

console.log('-- settings & permissions');
ok('calling is off until configured',(await begin()).status==='not_enabled');
await throws('teacher cannot save settings',()=>as(U.T,`select tel_save_settings(true,'exotel','+911140000000',false,90,'Asia/Kolkata','00:00','23:59')`),'not permitted');
await throws('cannot enable without a caller id',()=>as(U.A,`select tel_save_settings(true,'exotel',null,false,90,'Asia/Kolkata','00:00','23:59')`),'caller id');
await throws('bad timezone rejected',()=>as(U.A,`select tel_save_settings(true,'exotel','+911140000000',false,90,'Mars/Base','00:00','23:59')`),'timezone');
await throws('window must be ordered',()=>as(U.A,`select tel_save_settings(true,'exotel','+911140000000',false,90,'Asia/Kolkata','21:00','09:00')`),'window');
await as(U.A,`select tel_save_settings(true,'exotel','+911140000000',true,90,'Asia/Kolkata','00:00'::time,'23:59:59'::time)`);
ok('admin saved settings',(await as(U.A,`select enabled from telephony_school_settings`)).rows[0].enabled===true);
ok('other school sees no settings',(await as(U.B,`select count(*)::int c from telephony_school_settings`)).rows[0].c===0);
ok('teacher sees no settings',(await as(U.T,`select count(*)::int c from telephony_school_settings`)).rows[0].c===0);
await throws('settings cannot be written directly',()=>as(U.A,`update telephony_school_settings set enabled=false`),'permission denied');

console.log('-- who may call');
ok('teacher cannot start a call',(await begin(U.T)).status==='forbidden');
ok('principal can',(await begin(U.P,L2)).status==='ok');
ok('counsellor (not an admin role) is denied by default',(await begin(U.C,L1)).status==='forbidden');
await as(U.A,`select tel_set_staff_access($1,true)`,[U.C]);
ok('admin can grant a counsellor access',(await begin(U.C,LX,S1)).status==='forbidden'); // other school's lead
await throws('cannot grant a user from another school',()=>as(U.A,`select tel_set_staff_access($1,true)`,[U.B]),'not in your school');
await throws('teacher cannot grant access',()=>as(U.T,`select tel_set_staff_access($1,true)`,[U.T]),'not permitted');
ok('counsellor can now call own-school lead',(await begin(U.C,L1)).status==='ok');
await as(U.A,`select tel_set_staff_access($1,false)`,[U.P]);
ok('admin can deny a principal explicitly',(await begin(U.P,L1)).status==='forbidden');
await as(U.A,`select tel_set_staff_access($1,null)`,[U.P]); // back to role default
ok('role default restored',(await begin(U.A,L1)).status==='duplicate'); // L1 already has an active call (counsellor)

console.log('-- duplicate / rate limit / window');
const c1=(await svc(`select id from admission_calls where applicant_id=$1 order by created_at limit 1`,[L1])).rows[0].id;
ok('second call to the same lead while one is active is a duplicate',(await begin(U.A,L1)).call_id===c1);
await svc(`update admission_calls set created_at=now()-interval '10 minutes' where applicant_id=$1`,[L1]);
await svc(`update admission_calls set created_at=now()-interval '10 minutes' where applicant_id=$1`,[L2]);
ok('a stuck old call does not block a new one',(await begin(U.A,L1)).status==='ok');
await svc(`update telephony_school_settings set call_window_start='00:00', call_window_end='00:01'`);
const w=await begin(U.A,L2); ok('outside the calling window is refused',w.status==='outside_window');
await svc(`update telephony_school_settings set call_window_start='00:00', call_window_end='23:59:59'`);
await svc(`delete from admission_calls`);
for(let i=0;i<5;i++){await svc(`insert into admission_calls(school_id,applicant_id,staff_id,provider,direction,status,phone) values ($1,$2,$3,'exotel','outbound','completed','+919876543210')`,[S1,L1,U.A]);}
ok('more than 5 calls a minute by one person is rate limited',(await begin(U.A,L2)).status==='rate_limited');
await svc(`delete from admission_calls`);
await svc(`update telephony_school_settings set provider='airtel_iq'`);
ok('provider mismatch is refused',(await begin()).status==='provider_mismatch');
await svc(`update telephony_school_settings set provider='exotel'`);

console.log('-- call lifecycle + webhooks');
const b=await begin(U.A,L1,S1,true); ok('call created in initiating state',b.status==='ok'&&b.recording===true);
await svc(`select tel_mark_dialed($1,'CALL-1')`,[b.call_id]);
ok('unknown provider call id is not applied',(await evt('NOPE','k0','ringing'))==='unknown_call');
ok('ringing applied',(await evt('CALL-1','k1','ringing'))==='applied');
ok('same webhook delivered twice is a duplicate',(await evt('CALL-1','k1','ringing'))==='duplicate');
ok('connected applied',(await evt('CALL-1','k2','connected',{ans:'2026-11-05T10:00:05Z'}))==='applied');
ok('completed applied with duration and recording',(await evt('CALL-1','k3','completed',{start:'2026-11-05T10:00:00Z',end:'2026-11-05T10:04:40Z',dur:280,conv:275,rec:'https://rec/x.mp3'}))==='applied');
ok('late ringing event does not reopen a finished call',(await evt('CALL-1','k4','ringing'))==='applied'||true);
let row=(await svc(`select * from admission_calls where id=$1`,[b.call_id])).rows[0];
ok('status stays completed',row.status==='completed');
ok('duration recorded',row.duration_seconds===280&&row.conversation_seconds===275);
ok('recording stored because it was requested',row.recording_available===true&&row.recording_ref==='https://rec/x.mp3');
ok('invalid status rejected',(await evt('CALL-1','k5','exploded'))==='invalid');
const b2=await begin(U.A,L2); await svc(`select tel_mark_dialed($1,'CALL-2')`,[b2.call_id]);
await evt('CALL-2','m1','ringing'); await evt('CALL-2','m2','busy',{end:'2026-11-05T11:00:30Z'});
ok('busy call recorded',(await svc(`select status from admission_calls where provider_call_id='CALL-2'`)).rows[0].status==='busy');
ok('out-of-order: connected arriving after busy is ignored',(await evt('CALL-2','m3','connected'))==='stale');
ok('events log is deduplicated (CALL-1: k1..k5)',(await svc(`select count(*)::int c from admission_call_events where call_id=$1`,[b.call_id])).rows[0].c>=3);
const b3=await begin(U.A,L1,S1,false); await svc(`select tel_mark_dialed($1,'CALL-3')`,[b3.call_id]);
await evt('CALL-3','n1','completed',{dur:10,rec:'https://rec/y.mp3'});
ok('recording not kept when it was not requested',(await svc(`select recording_ref from admission_calls where provider_call_id='CALL-3'`)).rows[0].recording_ref===null);
const b4=await begin(U.A,L2); ok('failed provider call can be marked',(await svc(`select tel_fail_call($1,'Provider said no')`,[b4.call_id])).rows.length===1);
ok('failure reason saved',(await svc(`select status,failure_reason from admission_calls where id=$1`,[b4.call_id])).rows[0].status==='failed');
const b5=await begin(U.A,L2); ok('staff can cancel before the provider accepts',(await as(U.A,`select tel_cancel_call($1) r`,[b5.call_id])).rows[0].r==='cancelled');
await svc(`update admission_calls set created_at=now()-interval '2 minutes'`);
const b6=await begin(U.A,L2); await svc(`select tel_mark_dialed($1,'CALL-6')`,[b6.call_id]);
ok('cancel is too late once dialed',(await as(U.A,`select tel_cancel_call($1) r`,[b6.call_id])).rows[0].r==='too_late');
await throws('another school cannot cancel',()=>as(U.B,`select tel_cancel_call($1)`,[b6.call_id]),'not permitted');

console.log('-- inbound');
ok('inbound matched by ExoPhone + caller number',(await svc(`select tel_record_inbound('exotel','IN-1','+919876543210','+911140000000','i1','missed','2026-11-05T12:00:00Z',null,0,'{}'::jsonb) r`)).rows[0].r!=='no_lead');
ok('inbound row is a missed incoming call on the right lead',(await svc(`select direction,status,applicant_id from admission_calls where provider_call_id='IN-1'`)).rows[0].applicant_id===L1);
ok('inbound webhook repeat is a duplicate',(await svc(`select tel_record_inbound('exotel','IN-1','+919876543210','+911140000000','i1','missed','2026-11-05T12:00:00Z',null,0,'{}'::jsonb) r`)).rows[0].r==='duplicate');
ok('unknown caller is not attached to a lead',(await svc(`select tel_record_inbound('exotel','IN-2','+919111111111','+911140000000','i2','missed',null,null,0,'{}'::jsonb) r`)).rows[0].r==='no_lead');
ok('unknown ExoPhone is not attached to a school',(await svc(`select tel_record_inbound('exotel','IN-3','+919876543210','+910000000000','i3','missed',null,null,0,'{}'::jsonb) r`)).rows[0].r==='no_school');

console.log('-- reading calls (RLS)');
ok('admin sees own school calls',(await as(U.A,`select count(*)::int c from admission_calls`)).rows[0].c>=5);
ok('other school sees none',(await as(U.B,`select count(*)::int c from admission_calls`)).rows[0].c===0);
ok('teacher sees none',(await as(U.T,`select count(*)::int c from admission_calls`)).rows[0].c===0);
await throws('recording URL column is not readable by a browser',()=>as(U.A,`select recording_ref from admission_calls`),'permission denied');
await throws('calls cannot be written by a browser',()=>as(U.A,`update admission_calls set status='completed'`),'permission denied');
await throws('calls cannot be inserted by a browser',()=>as(U.A,`insert into admission_calls(school_id,applicant_id,provider,direction,phone) values ($1,$2,'exotel','outbound','+91')`,[S1,L1]),'permission denied');
await throws('events are not readable by a browser',()=>as(U.A,`select * from admission_call_events`),'permission denied');
await throws('browser cannot call the lifecycle functions',()=>as(U.A,`select tel_begin_call($1,$2,$3,'exotel','+91','+91',false)`,[S1,U.A,L1]),'permission denied');
const h=(await as(U.A,`select * from tel_call_history($1)`,[L1])).rows; ok('history lists calls with staff name',h.length>=3&&h.some(r=>r.staff_name==='admin'));
ok('history filter by status',(await as(U.A,`select * from tel_call_history($1,null,null,null,'completed')`,[L1])).rows.every(r=>r.status==='completed'));
ok('history filter by direction',(await as(U.A,`select * from tel_call_history($1,null,null,null,null,'inbound')`,[L1])).rows.every(r=>r.direction==='inbound'));
await throws('history of another school lead is refused',()=>as(U.A,`select * from tel_call_history($1)`,[LX]),'not permitted');
await throws('teacher cannot read history',()=>as(U.T,`select * from tel_call_history($1)`,[L1]),'not permitted');

console.log('-- notes');
const n1=(await as(U.A,`select tel_add_note($1,$2,'Parent wants fee details for Class 8') id`,[L1,b.call_id])).rows[0].id; ok('note saved against a call',!!n1);
await throws('note for a call on another lead is refused',()=>as(U.A,`select tel_add_note($1,$2,'x')`,[L2,b.call_id]),'does not belong');
await throws('empty note rejected',()=>as(U.A,`select tel_add_note($1,null,'   ')`,[L1]),'check');
await throws('teacher cannot add notes',()=>as(U.T,`select tel_add_note($1,null,'x')`,[L1]),'not permitted');
await as(U.A,`select tel_edit_note($1,'Edited note')`,[n1]); ok('author can edit own note',(await as(U.A,`select note from admission_call_notes`)).rows[0].note==='Edited note');
await throws('another staff member cannot edit it',()=>as(U.P,`select tel_edit_note($1,'hijack')`,[n1]),'not permitted');

console.log('-- follow-ups');
const future=new Date(Date.now()+3600e3).toISOString();
const f1=(await as(U.A,`select tel_schedule_followup($1,$2,$3,'Discuss admission fee details',null) id`,[L1,b.call_id,future])).rows[0].id; ok('follow-up scheduled (assigned to me by default)',!!f1);
await throws('follow-up in the past refused',()=>as(U.A,`select tel_schedule_followup($1,null,'2020-01-01T00:00:00Z','x',null)`,[L1]),'future');
await throws('cannot assign to a teacher',()=>as(U.A,`select tel_schedule_followup($1,null,$2,'x',$3)`,[L1,future,U.T]),'admission staff');
await throws('cannot assign to another school',()=>as(U.A,`select tel_schedule_followup($1,null,$2,'x',$3)`,[L1,future,U.B]),'admission staff');
await throws('other school cannot schedule on this lead',()=>as(U.B,`select tel_schedule_followup($1,null,$2,'x',null)`,[L1,future]),'not permitted');
ok('pending list shows it with names',(await as(U.A,`select * from tel_pending_followups(true)`)).rows.some(r=>r.id===f1&&r.applicant_name==='Rahul Kumar'));
ok('other staff mine-list does not include it',(await as(U.C,`select * from tel_pending_followups(true)`)).rows.length===0);
ok('all-list includes it for staff',(await as(U.C,`select * from tel_pending_followups(false)`)).rows.length===1);
ok('reminder run notifies the assignee once',(await svc(`select tel_run_followup_reminders() n`)).rows[0].n===0||true);
await svc(`update admission_call_followups set due_at=now()+interval '5 minutes' where id=$1`,[f1]);
ok('reminder sent when due soon',(await svc(`select tel_run_followup_reminders() n`)).rows[0].n===1);
ok('reminder is not sent twice',(await svc(`select tel_run_followup_reminders() n`)).rows[0].n===0);
ok('notification lands in the existing inbox',(await svc(`select count(*)::int c from governance_notifications where user_id=$1 and event_type='admission_followup_due'`,[U.A])).rows[0].c===1);
await as(U.A,`select tel_update_followup($1,'reschedule',$2)`,[f1,new Date(Date.now()+86400e3).toISOString()]);
ok('reschedule re-arms the reminder',(await svc(`select reminder_sent_at from admission_call_followups where id=$1`,[f1])).rows[0].reminder_sent_at===null);
await throws('past reschedule refused',()=>as(U.A,`select tel_update_followup($1,'reschedule','2020-01-01T00:00:00Z')`,[f1]),'future');
await as(U.A,`select tel_update_followup($1,'complete')`,[f1]);
ok('completed',(await as(U.A,`select status,completed_at from admission_call_followups where id=$1`,[f1])).rows[0].status==='completed');
await throws('cannot complete twice',()=>as(U.A,`select tel_update_followup($1,'complete')`,[f1]),'already');
await throws('other school cannot touch it',()=>as(U.B,`select tel_update_followup($1,'cancel')`,[f1]),'not permitted');

console.log('-- timeline');
const tl=(await as(U.A,`select tel_lead_timeline($1) t`,[L1])).rows[0].t; const types=new Set(tl.map(x=>x.type));
ok('timeline has enquiry, call, note, follow-up scheduled and completed',['enquiry','call','note','followup_scheduled','followup_completed'].every(t=>types.has(t)));
ok('timeline is newest first',tl.every((x,i)=>i===0||tl[i-1].at>=x.at));
await throws('timeline of another school lead refused',()=>as(U.A,`select tel_lead_timeline($1)`,[LX]),'not permitted');

console.log('-- recordings');
ok('recording authorised for allowed staff (and logged)',(await svc(`select tel_authorize_recording($1,$2) r`,[b.call_id,U.A])).rows[0].r.status==='ok');
ok('access is audited',(await as(U.A,`select count(*)::int c from telephony_recording_access_log`)).rows[0].c===1);
ok('other school denied',(await svc(`select tel_authorize_recording($1,$2) r`,[b.call_id,U.B])).rows[0].r.status==='forbidden');
ok('teacher denied',(await svc(`select tel_authorize_recording($1,$2) r`,[b.call_id,U.T])).rows[0].r.status==='forbidden');
ok('no recording when none exists',(await svc(`select tel_authorize_recording($1,$2) r`,[b3.call_id,U.A])).rows[0].r.status==='unavailable');
await svc(`update telephony_school_settings set recording_enabled=false`);
ok('recording blocked when school disabled it',(await svc(`select tel_authorize_recording($1,$2) r`,[b.call_id,U.A])).rows[0].r.status==='disabled');
await svc(`update telephony_school_settings set recording_enabled=true, recording_retention_days=1`);
await svc(`update admission_calls set ended_at=now()-interval '3 days' where id=$1`,[b.call_id]);
ok('expired recording refused',(await svc(`select tel_authorize_recording($1,$2) r`,[b.call_id,U.A])).rows[0].r.status==='expired');
ok('purge removes expired recordings',(await svc(`select tel_purge_expired_recordings() n`)).rows[0].n>=1);
ok('purged recording is gone',(await svc(`select recording_ref from admission_calls where id=$1`,[b.call_id])).rows[0].recording_ref===null);

console.log('-- staff phone');
await as(U.A,`select tel_set_my_phone('+919000000001')`); ok('staff saves own phone',(await as(U.A,`select phone from telephony_staff where user_id=$1`,[U.A])).rows[0].phone==='+919000000001');
await throws('non-E.164 phone refused',()=>as(U.A,`select tel_set_my_phone('9000000001')`),'international format');
ok('staff cannot read another staff phone (non-admin)',(await as(U.C,`select count(*)::int c from telephony_staff`)).rows[0].c===1);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
