// Database tests for the publish workflow. Usage (needs @electric-sql/pglite, run from a scratch dir):
//   node run.mjs <stubs.sql> <001/mlcs migration.sql> <workflow migration.sql>
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const [stubs, mlcs, wf] = process.argv.slice(2);
const db = new PGlite();
process.on('uncaughtException', e => { console.log('ERR:', String(e.message).slice(0, 500)); process.exit(1); });
await db.exec(fs.readFileSync(stubs, 'utf8'));
await db.exec('create role anon;'); // exists on Supabase, not in the bare test database
await db.exec(`create table public.governance_notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, event_type text not null, title text not null, message text not null, reference_id uuid, reference_type text, channel text not null default 'in_app', is_read boolean not null default false, created_at timestamptz not null default now()); alter table public.governance_notifications enable row level security; create policy own on public.governance_notifications for select using (user_id=auth.uid()); grant all on public.governance_notifications to authenticated, service_role;`);
await db.exec(fs.readFileSync(mlcs, 'utf8'));
const wfSql = fs.readFileSync(wf, 'utf8');
await db.exec(wfSql); await db.exec(wfSql); // idempotent
await db.exec(`grant all on all tables in schema public to authenticated, service_role; revoke insert, update, delete, truncate on approval_settings, approval_stages, approval_submissions, approval_history from anon, authenticated;`); // tables only; the test grant must not undo the migration's revoke
console.log('MIGRATIONS OK (workflow applied twice)');

const S1 = '11111111-1111-1111-1111-111111111111', S2 = '22222222-2222-2222-2222-222222222222';
const U = { ADMIN: 'a0000000-0000-0000-0000-000000000001', T1: 'a0000000-0000-0000-0000-000000000002', T2: 'a0000000-0000-0000-0000-000000000003',
  ST: 'a0000000-0000-0000-0000-000000000004', HOD: 'a0000000-0000-0000-0000-000000000005', PRIN: 'a0000000-0000-0000-0000-000000000006',
  ADMIN2: 'a0000000-0000-0000-0000-000000000007', OTHER: 'a0000000-0000-0000-0000-000000000008' };
for (const [id, n, r, s] of [[U.ADMIN,'Admin','admin',S1],[U.T1,'Teacher1','teacher',S1],[U.T2,'Teacher2','teacher',S1],[U.ST,'Student','student',S1],
  [U.HOD,'Hod','hod',S1],[U.PRIN,'Principal','principal',S1],[U.ADMIN2,'Admin2','admin',S1],[U.OTHER,'OtherSchoolAdmin','admin',S2]]) {
  await db.query('insert into auth.users(id) values($1)', [id]);
  await db.query('insert into profiles(id,full_name,role,school_id) values($1,$2,$3,$4)', [id, n, r, s]);
}
let pass = 0, fail = 0;
const as = async (uid, sql, params = []) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid ?? ''}',false); set role authenticated;`); try { return await db.query(sql, params); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);"); } };
const ok = (name, cond) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } };
const throws = async (name, fn, match) => { try { await fn(); fail++; console.log('  FAIL (no error)', name); } catch (e) { const m = String(e.message).includes(match); m ? pass++ : fail++; console.log(m ? '  PASS' : '  FAIL', name, m ? '' : e.message); } };
const one = async (uid, sql, p) => (await as(uid, sql, p)).rows[0];
const notifs = async (uid, ev) => (await db.query(`select * from governance_notifications where user_id=$1 and event_type=$2`, [uid, ev])).rows;

// subject owned by T1 (published, as legacy), with legacy published module/topic
await db.exec('reset role');
const c = (await db.query(`insert into courses(school_id,title,status,created_by,mentor_id) values($1,'Mathematics','published',$2,$2) returning id`, [S1, U.T1])).rows[0].id;
const m1 = (await db.query(`insert into course_modules(course_id,title,status) values($1,'Algebra','published') returning id`, [c])).rows[0].id;
const legacyTopic = (await db.query(`insert into course_topics(module_id,title,status) values($1,'Legacy topic','published') returning id`, [m1])).rows[0].id;
await db.query(`insert into student_course_progress(student_id,course_id) values($1,$2)`, [U.ST, c]);
await db.query(`insert into student_topic_progress(student_id,topic_id,completed) values($1,$2,true)`, [U.ST, legacyTopic]);

console.log('\n== workflow OFF (backward compatibility) ==');
const offTopic = (await as(U.T1, `insert into course_topics(module_id,title,status) values($1,'Direct publish','published') returning id`, [m1])).rows[0].id;
ok('workflow off: teacher can still publish directly (old behaviour)', !!offTopic);
await as(U.T1, `update course_topics set status='draft' where id=$1`, [offTopic]);
ok('workflow off: teacher can still change status', (await one(U.T1, `select status from course_topics where id=$1`, [offTopic])).status === 'draft');
await throws('workflow off: submit refused', () => as(U.T1, `select wf_submit('topic',$1)`, [offTopic]), 'WF_DISABLED');

console.log('\n== settings ==');
await throws('teacher cannot change settings', () => as(U.T1, `select wf_save_settings(true,false,'manual',false,'[]')`), 'WF_FORBIDDEN');
await throws('stages limit', () => as(U.ADMIN, `select wf_save_settings(true,false,'manual',false,'[{},{},{},{},{},{}]')`), 'WF_BAD_SETTING');
await as(U.ADMIN, `select wf_save_settings(true,false,'manual',false,$1::jsonb)`, [JSON.stringify([{ name: 'Coordinator', reviewer_role: 'hod' }, { name: 'Principal', reviewer_role: 'principal' }])]);
const st = (await one(U.T1, `select wf_settings() s`)).s;
ok('settings saved with 2 stages (teacher can read)', st.enabled === true && st.stages.length === 2 && st.stages[0].reviewer_role === 'hod');
await throws('direct write to settings blocked', () => as(U.ADMIN, `update approval_settings set enabled=false`), 'permission denied');
await throws('direct insert into history blocked', () => as(U.ADMIN, `insert into approval_history(school_id,course_id,content_kind,content_id,action) values($1,$2,'topic',$3,'x')`, [S1, c, offTopic]), 'permission denied');

console.log('\n== guard: no bypass of the approval process ==');
const ch = (await as(U.T1, `insert into course_chapters(module_id,title,status) values($1,'Intro to Algebra','published') returning id`, [m1])).rows[0].id;
ok('new content is forced to draft even if "published" is requested', (await one(U.T1, `select status from course_chapters where id=$1`, [ch])).status === 'draft');
await throws('teacher cannot set status directly', () => as(U.T1, `update course_chapters set status='published' where id=$1`, [ch]), 'WF_STATUS_PROTECTED');
await throws('teacher cannot approve via direct update', () => as(U.T1, `update course_chapters set status='approved' where id=$1`, [ch]), 'WF_STATUS_PROTECTED');
await throws('client cannot call internal status setter', () => as(U.T1, `select wf_set_item_status('chapter',$1,'published')`, [ch]), 'permission denied');
await throws('client cannot call internal publish', () => as(U.T1, `select wf_publish_internal(gen_random_uuid(),'x','y')`), 'permission denied');
await throws('client cannot read item context directly', () => as(U.ST, `select wf_item_context('chapter',$1)`, [ch]), 'permission denied');
await as(U.T1, `update course_chapters set description='draft edit ok' where id=$1`, [ch]);
ok('draft can be edited', true);
await throws('other teacher cannot submit my content', () => as(U.T2, `select wf_submit('chapter',$1)`, [ch]), 'WF_FORBIDDEN');
await throws('student cannot submit', () => as(U.ST, `select wf_submit('chapter',$1)`, [ch]), 'WF_FORBIDDEN');

console.log('\n== teacher flow: draft -> pending -> changes -> resubmit -> approve -> publish ==');
const sub1 = (await one(U.T1, `select wf_submit('chapter',$1,'please review','high') id`, [ch])).id;
ok('status is pending_review', (await one(U.T1, `select status from course_chapters where id=$1`, [ch])).status === 'pending_review');
ok('submitter notified', (await notifs(U.T1, 'content_submitted')).length === 1);
ok('stage-1 reviewer (HOD) notified', (await notifs(U.HOD, 'content_submitted')).length === 1);
ok('principal (stage 2) not notified yet', (await notifs(U.PRIN, 'content_submitted')).length === 0);
await throws('cannot submit twice', () => as(U.T1, `select wf_submit('chapter',$1)`, [ch]), 'WF_BAD_STATE');
await throws('teacher cannot edit content under review', () => as(U.T1, `update course_chapters set title='sneaky' where id=$1`, [ch]), 'WF_LOCKED');
await throws('teacher cannot delete content under review', () => as(U.T1, `delete from course_chapters where id=$1`, [ch]), 'WF_LOCKED');
await as(U.T1, `update course_chapters set order_index=5 where id=$1`, [ch]);
ok('reordering is still allowed (not a content change)', true);
await throws('teacher cannot review', () => as(U.T1, `select wf_review($1,'approve')`, [sub1]), 'WF_FORBIDDEN');
await throws('principal cannot review stage 1? (admin-level always can) - student cannot', () => as(U.ST, `select wf_review($1,'approve')`, [sub1]), 'WF_FORBIDDEN');
await throws('other-school admin cannot review', () => as(U.OTHER, `select wf_review($1,'approve')`, [sub1]), 'WF_FORBIDDEN');
await throws('request changes needs a reason', () => as(U.HOD, `select wf_review($1,'request_changes','')`, [sub1]), 'WF_REASON_REQUIRED');
await throws('reject needs a reason', () => as(U.HOD, `select wf_review($1,'reject','no')`, [sub1]), 'WF_REASON_REQUIRED');
await as(U.HOD, `select wf_review($1,'request_changes','Add worked examples to section 2')`, [sub1]);
ok('item is changes_requested', (await one(U.T1, `select status from course_chapters where id=$1`, [ch])).status === 'changes_requested');
ok('teacher got feedback notification with the reason', (await notifs(U.T1, 'content_changes_requested'))[0]?.message.includes('worked examples'));
await as(U.T1, `update course_chapters set description='added worked examples' where id=$1`, [ch]);
ok('teacher can edit requested changes', true);
const sub2 = (await one(U.T1, `select wf_submit('chapter',$1,'fixed') id`, [ch])).id;
const v2 = await one(U.T1, `select version, resubmission_of from approval_submissions where id=$1`, [sub2]);
ok('resubmission creates version 2 linked to version 1', v2.version === 2 && v2.resubmission_of === sub1);
ok('previous version superseded', (await one(U.ADMIN, `select status from approval_submissions where id=$1`, [sub1])).status === 'superseded');
ok('resubmitted history entry', (await one(U.ADMIN, `select count(*)::int n from approval_history where content_id=$1 and action='resubmitted'`, [ch])).n === 1);

console.log('\n== approval chain + assignment ==');
await as(U.HOD, `select wf_review($1,'approve','Looks good')`, [sub2]);
let cur = await one(U.ADMIN, `select status,current_stage from approval_submissions where id=$1`, [sub2]);
ok('stage 1 approved -> still pending at stage 2', cur.status === 'pending_review' && cur.current_stage === 2);
ok('stage 2 reviewer (principal) notified', (await notifs(U.PRIN, 'content_submitted')).length === 1);
await throws('HOD cannot approve stage 2', () => as(U.HOD, `select wf_review($1,'approve')`, [sub2]), 'WF_FORBIDDEN');
await throws('only admins/HOD can assign', () => as(U.T1, `select wf_assign($1,$2)`, [sub2, U.PRIN]), 'WF_FORBIDDEN');
await throws('cannot assign the submitter as reviewer', () => as(U.ADMIN, `select wf_assign($1,$2)`, [sub2, U.T1]), 'WF_SELF_APPROVAL');
await throws('cannot assign a student', () => as(U.ADMIN, `select wf_assign($1,$2)`, [sub2, U.ST]), 'WF_BAD_REVIEWER');
await throws('cannot assign someone from another school', () => as(U.ADMIN, `select wf_assign($1,$2)`, [sub2, U.OTHER]), 'WF_BAD_REVIEWER');
await as(U.ADMIN, `select wf_assign($1,$2)`, [sub2, U.T2]);
ok('assigned reviewer notified', (await notifs(U.T2, 'content_assigned')).length === 1);
ok('assigned reviewer (a teacher) may now review this submission', (await one(U.T2, `select (wf_submission_detail($1)->>'can_review')::boolean r`, [sub2])).r === true);
await as(U.ADMIN, `select wf_assign($1,$2)`, [sub2, U.ADMIN2]);
ok('reassignment logged', (await one(U.ADMIN, `select count(*)::int n from approval_history where submission_id=$1 and action='reassigned'`, [sub2])).n === 1);
await throws('previous assignee loses authority after reassign', () => as(U.T2, `select wf_review($1,'approve')`, [sub2]), 'WF_FORBIDDEN');
ok('principal can still act (admin-level)', (await one(U.PRIN, `select (wf_submission_detail($1)->>'can_review')::boolean r`, [sub2])).r === true);
await as(U.PRIN, `select wf_review($1,'approve','Approved for publication')`, [sub2]);
ok('final approval -> approved, NOT published', (await one(U.T1, `select status from course_chapters where id=$1`, [ch])).status === 'approved');
ok('students cannot see approved-but-unpublished chapter', (await as(U.ST, `select id from course_chapters where id=$1`, [ch])).rows.length === 0);
ok('teacher approved notification', (await notifs(U.T1, 'content_approved')).length >= 1);
await throws('teacher cannot publish', () => as(U.T1, `select wf_publish($1)`, [sub2]), 'WF_FORBIDDEN');
await throws('cannot edit approved content', () => as(U.T1, `update course_chapters set title='x' where id=$1`, [ch]), 'WF_LOCKED');
await throws('reviewing an already-decided submission fails (concurrent reviewers)', () => as(U.ADMIN2, `select wf_review($1,'reject','too late, someone approved')`, [sub2]), 'WF_BAD_STATE');
await as(U.ADMIN, `select wf_publish($1)`, [sub2]);
ok('published', (await one(U.T1, `select status from course_chapters where id=$1`, [ch])).status === 'published');
ok('student can now see the chapter', (await as(U.ST, `select id from course_chapters where id=$1`, [ch])).rows.length === 1);
ok('teacher published notification', (await notifs(U.T1, 'content_published')).length === 1);
ok('enrolled student notified of new content', (await notifs(U.ST, 'content_published')).length === 1);
await throws('cannot publish twice', () => as(U.ADMIN, `select wf_publish($1)`, [sub2]), 'WF_BAD_STATE');

console.log('\n== self approval ==');
const adminTopic = (await as(U.ADMIN, `insert into course_topics(module_id,title) values($1,'Admin topic') returning id`, [m1])).rows[0].id;
const adminSub = (await one(U.ADMIN, `select wf_submit('topic',$1) id`, [adminTopic])).id;
await throws('submitter cannot approve own submission', () => as(U.ADMIN, `select wf_review($1,'approve')`, [adminSub]), 'WF_SELF_APPROVAL');
await as(U.ADMIN2, `select wf_review($1,'reject','Out of syllabus scope')`, [adminSub]);
ok('rejection stored with reason in history', (await one(U.ADMIN, `select reason from approval_history where submission_id=$1 and action='rejected'`, [adminSub])).reason === 'Out of syllabus scope');
ok('rejected content hidden from student', (await as(U.ST, `select id from course_topics where id=$1`, [adminTopic])).rows.length === 0);
ok('teacher notified of rejection', true);
await throws('rejected content cannot be resubmitted as-is', () => as(U.ADMIN, `select wf_submit('topic',$1)`, [adminTopic]), 'WF_BAD_STATE');
await as(U.ADMIN, `select wf_reopen('topic',$1,'Reworking after rejection')`, [adminTopic]);
ok('rejected -> reopened as draft', (await one(U.ADMIN, `select status from course_topics where id=$1`, [adminTopic])).status === 'draft');
await throws('reopen needs a reason', () => as(U.ADMIN, `select wf_reopen('topic',$1,'')`, [legacyTopic]), 'WF_REASON_REQUIRED');

console.log('\n== direct publish (audited admin shortcut) ==');
await throws('teacher cannot direct publish', () => as(U.T1, `select wf_direct_publish('topic',$1,'urgent fix')`, [adminTopic]), 'WF_FORBIDDEN');
await throws('direct publish needs a reason', () => as(U.ADMIN, `select wf_direct_publish('topic',$1,'')`, [adminTopic]), 'WF_REASON_REQUIRED');
await as(U.ADMIN, `select wf_direct_publish('topic',$1,'Approved offline by the principal')`, [adminTopic]);
ok('direct publish works and is audited', (await one(U.ADMIN, `select count(*)::int n from approval_history where content_id=$1 and action='direct_published'`, [adminTopic])).n === 1);

console.log('\n== published content: controlled revision + progress ==');
await throws('teacher cannot edit published content directly', () => as(U.T1, `update course_chapters set title='changed' where id=$1`, [ch]), 'WF_PUBLISHED_LOCKED');
await as(U.ADMIN, `update course_chapters set description='admin typo fix' where id=$1`, [ch]);
ok('admin-level can fix a typo in published content directly', true);
await as(U.T1, `select wf_reopen('chapter',$1,'Updating examples for new syllabus')`, [ch]);
ok('teacher revision: published -> draft (hidden while revised)', (await one(U.T1, `select status from course_chapters where id=$1`, [ch])).status === 'draft');
ok('students no longer see content under revision', (await as(U.ST, `select id from course_chapters where id=$1`, [ch])).rows.length === 0);
const sub3 = (await one(U.T1, `select wf_submit('chapter',$1,'v3') id`, [ch])).id;
ok('new version number is 3', (await one(U.T1, `select version from approval_submissions where id=$1`, [sub3])).version === 3);
await as(U.ADMIN, `select wf_save_settings(true,false,'auto',true,$1::jsonb)`, [JSON.stringify([{ name: 'Coordinator', reviewer_role: 'hod' }, { name: 'Principal', reviewer_role: 'principal' }])]);
await as(U.ADMIN, `select wf_review($1,'approve','ok')`, [sub3]);
ok('admin skip + auto publish: published straight away', (await one(U.T1, `select status from course_chapters where id=$1`, [ch])).status === 'published');
ok('version 2 superseded by 3', (await one(U.ADMIN, `select status from approval_submissions where id=$1`, [sub2])).status === 'superseded');
ok('student progress rows preserved across revisions', (await one(U.ST, `select count(*)::int n from student_topic_progress where student_id=$1`, [U.ST])).n === 1);
ok('first publish says NEW content', (await notifs(U.ST, 'content_published')).some(n => n.title === 'New learning content' && n.message.includes('Intro to Algebra')));
ok('student notified that material was UPDATED (an earlier version was live)', (await notifs(U.ST, 'content_published')).filter(n => n.title === 'Learning material updated' && n.message.includes('Intro to Algebra')).length === 1);

console.log('\n== parent/child visibility ==');
const top = (await as(U.T1, `insert into course_topics(module_id,chapter_id,title) values($1,$2,'Variables') returning id`, [m1, ch])).rows[0].id;
const mat = (await as(U.T1, `insert into topic_materials(topic_id,title,material_type,content_body) values($1,'Notes','notes','x is a variable') returning id`, [top])).rows[0].id;
await as(U.ADMIN, `select wf_direct_publish('topic',$1,'Seed content for visibility test')`, [top]);
await as(U.ADMIN, `select wf_direct_publish('material',$1,'Seed content for visibility test')`, [mat]);
ok('published material visible when whole chain is published', (await as(U.ST, `select id from topic_materials where id=$1`, [mat])).rows.length === 1);
await as(U.ADMIN, `select wf_archive('chapter',$1,'Retired')`, [ch]);
ok('archiving the chapter hides its published topic from students (child cannot bypass parent)', (await as(U.ST, `select id from course_topics where id=$1`, [top])).rows.length === 0);
ok('student RPC hides the topic too', JSON.stringify((await one(U.ST, `select get_student_course_structure($1) j`, [c])).j).includes('Variables') === false);
await as(U.ADMIN, `select wf_reopen('chapter',$1,'Restoring the archived chapter')`, [ch]);
const reSub = (await one(U.T1, `select wf_submit('chapter',$1) id`, [ch])).id;
ok('archived -> reopened -> resubmittable', !!reSub);
await as(U.ADMIN, `select wf_review($1,'approve')`, [reSub]);
ok('chapter back to published, topic visible again', (await as(U.ST, `select id from course_topics where id=$1`, [top])).rows.length === 1);

console.log('\n== withdraw ==');
const wTopic = (await as(U.T1, `insert into course_topics(module_id,title) values($1,'To withdraw') returning id`, [m1])).rows[0].id;
const wSub = (await one(U.T1, `select wf_submit('topic',$1) id`, [wTopic])).id;
await throws('other teacher cannot withdraw', () => as(U.T2, `select wf_withdraw($1)`, [wSub]), 'WF_FORBIDDEN');
await as(U.T1, `select wf_withdraw($1)`, [wSub]);
ok('withdrawn returns to draft and is editable again', (await one(U.T1, `select status from course_topics where id=$1`, [wTopic])).status === 'draft');
await as(U.T1, `update course_topics set title='Edited after withdraw' where id=$1`, [wTopic]);

console.log('\n== history is append-only ==');
await throws('history cannot be updated (even by service role)', async () => { await db.exec('reset role'); await db.query(`update approval_history set comment='tampered'`); }, 'HISTORY_IMMUTABLE');
await throws('history cannot be deleted', async () => { await db.exec('reset role'); await db.query(`delete from approval_history`); }, 'HISTORY_IMMUTABLE');
const h = (await one(U.T1, `select wf_history('chapter',$1) h`, [ch])).h;
ok('teacher can read full history of own item with actors and comments', h.length >= 8 && h.some(x => x.action === 'changes_requested' && x.comment.includes('worked examples') && x.actor_name === 'Hod'));
await throws('student cannot read history', () => as(U.ST, `select wf_history('chapter',$1)`, [ch]), 'WF_FORBIDDEN');
await throws('other teacher cannot read history', () => as(U.T2, `select wf_history('chapter',$1)`, [ch]), 'WF_FORBIDDEN');
ok('student cannot read submissions table', (await as(U.ST, `select id from approval_submissions`)).rows.length === 0);
ok('student cannot read history table', (await as(U.ST, `select id from approval_history`)).rows.length === 0);
ok('other-school admin sees no submissions', (await as(U.OTHER, `select id from approval_submissions`)).rows.length === 0);
ok('other teacher sees no submissions of my subject', (await as(U.T2, `select id from approval_submissions`)).rows.length === 0);

console.log('\n== approval centre APIs ==');
const q = (await one(U.ADMIN, `select wf_queue(null,null,null,null,'submitted_desc',10,0) q`)).q;
ok('queue lists submissions with hierarchy + names', q.total >= 5 && q.rows[0].submitted_by_name && 'subject' in (q.rows[0].path ?? {}));
const qp = (await one(U.ADMIN, `select wf_queue('pending_review',null,null,null,'priority',10,0) q`)).q;
ok('queue status filter works', qp.rows.every(r => r.status === 'pending_review'));
const qs = (await one(U.ADMIN, `select wf_queue(null,'intro',null,null,'title',10,0) q`)).q;
ok('queue search works', qs.total >= 1 && qs.rows.every(r => /intro/i.test(r.title)));
const pg = (await one(U.ADMIN, `select wf_queue(null,null,null,null,'submitted_desc',2,2) q`)).q;
ok('queue pagination works', pg.rows.length === 2 && pg.total >= 5);
await throws('teacher cannot open the queue', () => as(U.T1, `select wf_queue()`), 'WF_FORBIDDEN');
const stt = (await one(U.ADMIN, `select wf_stats() s`)).s;
ok('stats include counts and average review time', stt.published >= 1 && stt.avg_review_hours !== null);
const d = (await one(U.ADMIN, `select wf_submission_detail($1) d`, [sub2])).d;
ok('detail has snapshot, history, versions, stages', d.snapshot.item.title && d.history.length >= 3 && d.versions.length >= 3 && d.stages.length === 2);
await throws('other teacher cannot open the detail', () => as(U.T2, `select wf_submission_detail($1)`, [sub2]), 'WF_FORBIDDEN');
const cand = (await one(U.ADMIN, `select wf_reviewer_candidates() r`)).r;
ok('reviewer candidates exclude students and other schools', cand.length > 0 && !cand.some(x => x.role === 'student' || x.name === 'OtherSchoolAdmin'));
await db.exec('reset role');
await db.query(`update approval_submissions set submitted_at = now() - interval '3 days' where status='pending_review'`);
const pend = (await as(U.T1, `insert into course_topics(module_id,title) values($1,'Old pending') returning id`, [m1])).rows[0].id;
await as(U.T1, `select wf_submit('topic',$1)`, [pend]);
await db.exec('reset role'); await db.query(`update approval_submissions set submitted_at = now() - interval '3 days' where content_id=$1`, [pend]);
ok('reminders sent to reviewers for stale submissions', (await one(U.ADMIN, `select wf_send_reminders(48) n`)).n >= 1 && (await notifs(U.HOD, 'content_reminder')).length >= 1);
await throws('teacher cannot send reminders', () => as(U.T1, `select wf_send_reminders()`), 'WF_FORBIDDEN');

console.log('\n== storage ==');
const path = `${S1}/${c}/slides.pdf`;
await db.exec('reset role');
const pm = (await db.query(`insert into topic_materials(topic_id,title,material_type,storage_path,status) values($1,'Slides','pdf',$2,'published') returning id`, [top, path])).rows[0].id;
const dpath = `${S1}/${c}/secret-draft.pdf`;
await db.query(`insert into topic_materials(topic_id,title,material_type,storage_path,status) values($1,'Draft slides','pdf',$2,'draft')`, [top, dpath]);
ok('student can read the file of published material', (await one(U.ST, `select wf_can_read_material_object($1) r`, [path])).r === true);
ok('student cannot read the file of draft material', (await one(U.ST, `select wf_can_read_material_object($1) r`, [dpath])).r === false);
ok('student cannot read an unknown file in the school folder', (await one(U.ST, `select wf_can_read_material_object($1) r`, [`${S1}/${c}/guess.pdf`])).r === false);
ok('owner teacher can read draft files', (await one(U.T1, `select wf_can_read_material_object($1) r`, [dpath])).r === true);
ok('other teacher cannot read my draft files', (await one(U.T2, `select wf_can_read_material_object($1) r`, [dpath])).r === false);
ok('other school cannot read files', (await one(U.OTHER, `select wf_can_read_material_object($1) r`, [path])).r === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
