import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
process.on("uncaughtException",e=>{console.log("ERR:",String(e.message).slice(0,400));process.exit(1)});
const migration = fs.readFileSync(process.argv[2], 'utf8');
await db.exec(fs.readFileSync('stubs.sql','utf8'));
await db.exec(migration);
await db.exec(migration); // idempotency: second run must not fail
await db.exec(`grant all on all tables in schema public to authenticated, service_role; grant execute on all functions in schema public to authenticated, service_role;`);
console.log('MIGRATION OK (applied twice)');
const S1='11111111-1111-1111-1111-111111111111', S2='22222222-2222-2222-2222-222222222222';
const ADMIN='a0000000-0000-0000-0000-000000000001', T1='a0000000-0000-0000-0000-000000000002', T2='a0000000-0000-0000-0000-000000000003', ST='a0000000-0000-0000-0000-000000000004', OTHER_ADMIN='a0000000-0000-0000-0000-000000000005';
for (const [id,n,r,s] of [[ADMIN,'Admin','admin',S1],[T1,'Teacher1','teacher',S1],[T2,'Teacher2','teacher',S1],[ST,'Student','student',S1],[OTHER_ADMIN,'Other','admin',S2]]) {
  await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query('insert into profiles(id,full_name,role,school_id) values($1,$2,$3,$4)',[id,n,r,s]);
}
let pass=0, fail=0;
const as = async (uid, sql, params=[]) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid??''}',false); set role authenticated;`); try { return await db.query(sql, params); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);"); } };
const ok = (name, cond) => { if (cond) {pass++; console.log('  PASS', name);} else {fail++; console.log('  FAIL', name);} };
const throws = async (name, fn, match) => { try { await fn(); fail++; console.log('  FAIL (no error)', name); } catch(e) { const m = String(e.message).includes(match); m?pass++:fail++; console.log(m?'  PASS':'  FAIL', name, m?'':e.message); } };

// admin creates session/semester/subject hierarchy
await db.exec(`reset role`);
const ay = (await db.query(`insert into academic_years(name,school_id) values('2026-2027',$1) returning id`,[S1])).rows[0].id;
const sem = (await db.query(`insert into academic_semesters(academic_year_id,name) values($1,'Semester 1') returning id`,[ay])).rows[0].id;
const c = (await as(T1, `insert into courses(school_id,title,subject,status,created_by,mentor_id,academic_year_id,semester_id) values($1,'Mathematics','Mathematics','published',$2,$2,$3,$4) returning id`,[S1,T1,ay,sem])).rows[0].id;
ok('teacher can create own subject', !!c);
await throws('teacher cannot create subject for another school', ()=>as(T1,`insert into courses(school_id,title,created_by) values($1,'X',$2)`,[S2,T1]), 'row-level security');
await throws('teacher cannot create subject owned by someone else', ()=>as(T1,`insert into courses(school_id,title,created_by) values($1,'X',$2)`,[S1,T2]), 'row-level security');
const m1 = (await as(T1,`insert into course_modules(course_id,title,status,order_index) values($1,'Algebra','published',0) returning id`,[c])).rows[0].id;
await throws('other teacher cannot add module to my subject', ()=>as(T2,`insert into course_modules(course_id,title) values($1,'Evil')`,[c]), 'row-level security');
const ch1 = (await as(T1,`insert into course_chapters(module_id,title,status,order_index) values($1,'Intro to Algebra','published',0) returning id`,[m1])).rows[0].id;
const ch2 = (await as(T1,`insert into course_chapters(module_id,title,status,order_index) values($1,'Linear Equations','published',1) returning id`,[m1])).rows[0].id;
const mkTopic = async (title, chapter, status='published', idx=0) => (await as(T1,`insert into course_topics(module_id,chapter_id,title,status,order_index) values($1,$2,$3,$4,$5) returning id`,[m1,chapter,title,status,idx])).rows[0].id;
const t1 = await mkTopic('Basic Concepts', ch1, 'published', 0);
const t2 = await mkTopic('Variables', ch1, 'published', 1);
const t3 = await mkTopic('Algebraic Expressions', ch1, 'published', 2);
const tDraft = await mkTopic('Hidden draft', ch1, 'draft', 3);
const tLE = await mkTopic('Solving x+1=2', ch2, 'published', 0);
ok('topics created in chapters', !!t1 && !!tLE);
await throws('topic chapter must belong to module', async()=>{ await db.exec('reset role'); const m2=(await db.query(`insert into course_modules(course_id,title,status) values($1,'Geometry','draft') returning id`,[c])).rows[0].id; await db.query(`insert into course_topics(module_id,chapter_id,title) values($1,$2,'bad')`,[m2,ch1]); }, 'CHAPTER_MODULE_MISMATCH');

// prerequisites
await as(T1,`insert into topic_prerequisites(topic_id,prerequisite_topic_id) values($1,$2)`,[t2,t1]);
await as(T1,`insert into topic_prerequisites(topic_id,prerequisite_topic_id) values($1,$2)`,[t3,t2]);
await throws('direct cycle rejected', ()=>as(T1,`insert into topic_prerequisites(topic_id,prerequisite_topic_id) values($1,$2)`,[t1,t2]), 'PREREQ_CYCLE');
await throws('transitive cycle rejected', ()=>as(T1,`insert into topic_prerequisites(topic_id,prerequisite_topic_id) values($1,$2)`,[t1,t3]), 'PREREQ_CYCLE');
await throws('self prerequisite rejected', ()=>as(T1,`insert into topic_prerequisites(topic_id,prerequisite_topic_id) values($1,$1)`,[t1]), 'PREREQ_CYCLE');
await throws('other teacher cannot edit prerequisites', ()=>as(T2,`insert into topic_prerequisites(topic_id,prerequisite_topic_id) values($1,$2)`,[tLE,t1]), 'row-level security');

// materials
const mat = (await as(T1,`insert into topic_materials(topic_id,title,material_type,content_body,status) values($1,'Notes','notes','x is a variable','published') returning id`,[t1])).rows[0].id;
await as(T1,`insert into topic_materials(topic_id,title,material_type,content_body,status) values($1,'Draft notes','notes','hidden','draft')`,[t1]);
await throws('material needs content', ()=>as(T1,`insert into topic_materials(topic_id,title) values($1,'empty')`,[t1]), 'topic_materials_has_content');

// student view
const struct = (await as(ST,`select get_student_course_structure($1) j`,[c])).rows[0].j;
const mod = struct.modules.find(x=>x.id===m1);
ok('student sees only published module (Geometry draft)', struct.modules.length===1);
ok('student sees 2 chapters', mod.chapters.length===2);
const ch1j = mod.chapters.find(x=>x.id===ch1);
ok('draft topic hidden from student', ch1j.topics.length===3 && !ch1j.topics.some(t=>t.title==='Hidden draft'));
const st = Object.fromEntries(ch1j.topics.map(t=>[t.title,t]));
ok('first topic available', st['Basic Concepts'].state==='available');
ok('Variables locked by prereq', st['Variables'].state==='locked');
ok('locked reason explains', st['Variables'].locked_reason==='Complete "Basic Concepts" first.');
ok('next recommended = first topic', struct.next_topic_id===t1);
ok('material count excludes drafts', st['Basic Concepts'].materials_count===1);
const direct = await as(ST,`select id from course_topics where id=$1`,[tDraft]);
ok('RLS hides draft topic from student', direct.rows.length===0);
const dm = await as(ST,`select id from topic_materials where topic_id=$1`,[t1]);
ok('RLS hides draft material', dm.rows.length===1);
await throws('locked topic cannot be completed via RPC', ()=>as(ST,`select complete_topic($1,true)`,[t2]), 'TOPIC_LOCKED');
await throws('locked topic cannot be completed via DIRECT upsert (legacy client path)', ()=>as(ST,`insert into student_topic_progress(student_id,topic_id,completed) values($1,$2,true)`,[ST,t2]), 'TOPIC_LOCKED');
await throws('locked topic content refused', async()=>{ const r=(await as(ST,`select get_student_topic($1) j`,[t2])).rows[0].j; if(!r.locked) return; throw new Error('TOPIC_LOCKED returned locked flag'); }, 'TOPIC_LOCKED');
const topicView = (await as(ST,`select get_student_topic($1) j`,[t1])).rows[0].j;
ok('topic view has materials', topicView.materials.length===1 && topicView.locked===false);
await as(ST,`select record_topic_activity($1, 120, $2, 50, false)`,[t1, mat]);
const r1 = (await as(ST,`select complete_topic($1,true) j`,[t1])).rows[0].j;
ok('complete topic returns next = Variables', r1.next_topic_id===t2);
const scp0 = await as(ST,`select progress_percent,status,started_at from student_course_progress where course_id=$1`,[c]);
ok('course progress updated via trigger (no enrollment row yet -> none)', scp0.rows.length===0);
// enrollment exists (ensure_course_enrollment in live db) -> simulate
await as(ST,`insert into student_course_progress(student_id,course_id,status) values($1,$2,'available')`,[ST,c]);
await as(ST,`select complete_topic($1,true)`,[t2]);
const scp1 = (await as(ST,`select progress_percent,status from student_course_progress where course_id=$1`,[c])).rows[0];
ok('course progress = 2 of 4 published topics = 50%', scp1.progress_percent===50 && scp1.status==='in_progress');
const prog = (await as(ST,`select time_spent_seconds from student_topic_progress where topic_id=$1`,[t1])).rows[0];
ok('time spent recorded', prog.time_spent_seconds===120);
await as(ST,`select complete_topic($1,true)`,[t3]); await as(ST,`select complete_topic($1,true)`,[tLE]);
const scp2 = (await as(ST,`select progress_percent,status,completed_at from student_course_progress where course_id=$1`,[c])).rows[0];
ok('course completes at 100%', scp2.progress_percent===100 && scp2.status==='completed' && scp2.completed_at);
await as(ST,`select complete_topic($1,false)`,[t3]);
// uncompleting prerequisite does not retro-lock completed work but recomputes
const scp3 = (await as(ST,`select progress_percent from student_course_progress where course_id=$1`,[c])).rows[0];
ok('un-complete lowers percent', scp3.progress_percent===75);

// sequential mode
await db.exec(`reset role; update courses set learning_path_mode='sequential' where id='${c}'`);
await db.exec(`reset role; update student_topic_progress set completed=false where student_id='${ST}'`);
const s2 = (await as(ST,`select get_student_course_structure($1) j`,[c])).rows[0].j;
const flat = s2.modules.find(x=>x.id===m1).chapters.flatMap(ch=>ch.topics);
ok('sequential: only first topic open', flat.filter(t=>t.state!=='locked').length===1);
ok('sequential: chapter 2 first topic locked until chapter 1 done', flat.find(t=>t.id===tLE).state==='locked');

// legacy: course with modules only, no topics/chapters
await db.exec('reset role');
const c2 = (await db.query(`insert into courses(school_id,title,status,created_by) values($1,'Legacy','published',$2) returning id`,[S1,T1])).rows[0].id;
const lm = (await db.query(`insert into course_modules(course_id,title) values($1,'L1'),($1,'L2') returning id`,[c2])).rows.map(r=>r.id);
await as(ST,`insert into student_course_progress(student_id,course_id,status) values($1,$2,'available')`,[ST,c2]);
await as(ST,`insert into student_module_progress(student_id,module_id,completed) values($1,$2,true)`,[ST,lm[0]]);
const lp = (await as(ST,`select progress_percent from student_course_progress where course_id=$1`,[c2])).rows[0];
ok('legacy module-only course still 50% after 1 of 2 modules', lp.progress_percent===50);
const ls = (await as(ST,`select get_student_course_structure($1) j`,[c2])).rows[0].j;
ok('legacy modules (no chapters/topics) still returned', ls.modules.length===2 && ls.total_topics===0);

// isolation
await throws('other-school admin cannot read my subject structure', ()=>as(OTHER_ADMIN,`select get_student_course_structure($1)`,[c]), 'COURSE_NOT_FOUND');
const oc = await as(OTHER_ADMIN,`select id from course_chapters`);
ok('other-school admin sees no chapters', oc.rows.length===0);
await throws('teacher2 cannot read stats of teacher1 subject', ()=>as(T2,`select get_course_completion_stats($1)`,[c]), 'FORBIDDEN');
const stats = (await as(T1,`select get_course_completion_stats($1) j`,[c])).rows[0].j;
ok('teacher stats: learners & topics', stats.learners===1 && stats.topics.length===5);
const adminStats = (await as(ADMIN,`select get_course_completion_stats($1) j`,[c])).rows[0].j;
ok('admin can see stats', adminStats.learners===1);
// reorder
await as(T1,`select mlcs_reorder('topic', $1::uuid[])`,[`{${t3},${t2},${t1}}`]);
const ord = (await as(T1,`select id from course_topics where id in ($1,$2,$3) order by order_index`,[t1,t2,t3])).rows.map(r=>r.id);
ok('reorder applied', ord[0]===t3 && ord[2]===t1);
await as(T2,`select mlcs_reorder('topic', $1::uuid[])`,[`{${t1},${t2},${t3}}`]);
const ord2 = (await as(T1,`select id from course_topics where id in ($1,$2,$3) order by order_index`,[t1,t2,t3])).rows.map(r=>r.id);
ok('other teacher reorder is a no-op (RLS)', ord2[0]===t3);
// tutor context
await db.exec(`reset role; update courses set learning_path_mode='flexible' where id='${c}'`);
const ctx = (await db.query(`select get_topic_tutor_context($1,$2) j`,[ST,t1])).rows[0].j;
ok('tutor context has session/semester/subject/module/chapter/topic', ctx.academic_year==='2026-2027' && ctx.semester==='Semester 1' && ctx.subject==='Mathematics' && ctx.module==='Algebra' && ctx.chapter==='Intro to Algebra' && ctx.topic.title==='Basic Concepts');
ok('tutor context includes published material notes only', ctx.materials.length===1);
await db.exec(`reset role; update student_topic_progress set completed=false where student_id='${ST}'`);
await db.exec(`reset role; update courses set learning_path_mode='sequential' where id='${c}'`);
const ctxLocked = (await db.query(`select get_topic_tutor_context($1,$2) j`,[ST,tLE])).rows[0].j;
ok('tutor context withheld for locked topic', ctxLocked===null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
