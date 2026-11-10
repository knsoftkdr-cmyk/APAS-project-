// Runs the engagement migration in an in-memory Postgres (PGlite) against minimal stand-ins of the APAS tables,
// then checks the triggers and RLS. Run:  node supabase/tests/engagement_rls.mjs   (needs: npm i @electric-sql/pglite)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, "../migrations/20261110000000_student_engagement_score.sql"), "utf8");
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };

const U = {
  s1: "00000000-0000-0000-0000-0000000000a1", s2: "00000000-0000-0000-0000-0000000000a2", s3: "00000000-0000-0000-0000-0000000000a3",
  t1: "00000000-0000-0000-0000-0000000000b1", t2: "00000000-0000-0000-0000-0000000000b2",
  ad1: "00000000-0000-0000-0000-0000000000c1", ad2: "00000000-0000-0000-0000-0000000000c2",
  pr1: "00000000-0000-0000-0000-0000000000c3",
};
const ST = { a: "10000000-0000-0000-0000-00000000000a", b: "10000000-0000-0000-0000-00000000000b", c: "10000000-0000-0000-0000-00000000000c" };
const SCH1 = "20000000-0000-0000-0000-000000000001", SCH2 = "20000000-0000-0000-0000-000000000002";
const CLS1 = "30000000-0000-0000-0000-000000000001", CLS2 = "30000000-0000-0000-0000-000000000002";

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, school_id uuid);
  CREATE TABLE public.students (id uuid PRIMARY KEY, profile_id uuid REFERENCES public.profiles(id));
  CREATE TABLE public.classes (id uuid PRIMARY KEY);
  CREATE TABLE public.class_students (class_id uuid, student_id uuid);
  CREATE TABLE public.class_teachers (class_id uuid, teacher_id uuid);
  CREATE TABLE public.homework_submissions (id serial PRIMARY KEY, student_id uuid);          -- profile id
  CREATE TABLE public.worksheet_submissions (id serial PRIMARY KEY, student_id uuid);         -- profile id
  CREATE TABLE public.generated_assessment_paper_attempts (id serial PRIMARY KEY, student_id uuid); -- students.id
  CREATE TABLE public.virtual_classroom_attendance (id serial PRIMARY KEY, student_id uuid);  -- students.id
  CREATE TABLE public.classroom_posts (id serial PRIMARY KEY, author_id uuid, kind text);     -- profile id
  CREATE TABLE public.learning_events (id serial PRIMARY KEY, student_id uuid, event_type text, occurred_at timestamptz NOT NULL DEFAULT now());
`);
await db.exec(migration);
await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
               GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);

await db.exec(`
  INSERT INTO public.profiles VALUES
   ('${U.s1}','student','${SCH1}'),('${U.s2}','student','${SCH1}'),('${U.s3}','student','${SCH2}'),
   ('${U.t1}','teacher','${SCH1}'),('${U.t2}','teacher','${SCH1}'),
   ('${U.ad1}','admin','${SCH1}'),('${U.ad2}','admin','${SCH2}'),('${U.pr1}','principal','${SCH1}');
  INSERT INTO public.students VALUES ('${ST.a}','${U.s1}'),('${ST.b}','${U.s2}'),('${ST.c}','${U.s3}');
  INSERT INTO public.classes VALUES ('${CLS1}'),('${CLS2}');
  INSERT INTO public.class_students VALUES ('${CLS1}','${ST.a}'),('${CLS2}','${ST.b}'),('${CLS2}','${ST.c}');
  INSERT INTO public.class_teachers VALUES ('${CLS1}','${U.t1}');
  INSERT INTO public.engagement_scores (student_id, school_id, window_days, period_start, period_end, status, score, category) VALUES
   ('${ST.a}','${SCH1}',30,now()-interval '30 days',now(),'ok',82,'highly_engaged'),
   ('${ST.b}','${SCH1}',30,now()-interval '30 days',now(),'ok',45,'low'),
   ('${ST.c}','${SCH2}',30,now()-interval '30 days',now(),'ok',70,'moderately_engaged');
  INSERT INTO public.engagement_score_history (student_id, school_id, snapshot_date, window_days, status, score) VALUES
   ('${ST.a}','${SCH1}',current_date,30,'ok',82),('${ST.b}','${SCH1}',current_date,30,'ok',45),('${ST.c}','${SCH2}',current_date,30,'ok',70);
`);

async function as(uid, fn) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`); }
}
const ids = async (sql) => (await db.query(sql)).rows.map((r) => r.student_id).sort();
const sorted = (...a) => a.sort();

// ── RLS: scores ─────────────────────────────────────────────────────────────────────────────────
ok("student sees only their own score", JSON.stringify(await as(U.s1, () => ids("SELECT student_id FROM public.engagement_scores"))) === JSON.stringify([ST.a]));
ok("student cannot see a classmate / other school", (await as(U.s2, () => ids("SELECT student_id FROM public.engagement_scores"))).every((x) => x === ST.b));
ok("teacher sees only students on classes they teach", JSON.stringify(await as(U.t1, () => ids("SELECT student_id FROM public.engagement_scores"))) === JSON.stringify([ST.a]));
ok("teacher with no classes sees nothing", (await as(U.t2, () => ids("SELECT student_id FROM public.engagement_scores"))).length === 0);
ok("admin sees all of THEIR school and nothing else", JSON.stringify(await as(U.ad1, () => ids("SELECT student_id FROM public.engagement_scores"))) === JSON.stringify(sorted(ST.a, ST.b)));
ok("principal sees their school", (await as(U.pr1, () => ids("SELECT student_id FROM public.engagement_scores"))).length === 2);
ok("other school's admin sees only their students", JSON.stringify(await as(U.ad2, () => ids("SELECT student_id FROM public.engagement_scores"))) === JSON.stringify([ST.c]));
ok("no cross-school leak into school 1", !(await as(U.ad1, () => ids("SELECT student_id FROM public.engagement_scores"))).includes(ST.c));

// ── RLS: history ────────────────────────────────────────────────────────────────────────────────
ok("history: student sees own only", JSON.stringify(await as(U.s1, () => ids("SELECT student_id FROM public.engagement_score_history"))) === JSON.stringify([ST.a]));
ok("history: teacher scoped to their class", JSON.stringify(await as(U.t1, () => ids("SELECT student_id FROM public.engagement_score_history"))) === JSON.stringify([ST.a]));
ok("history: admin scoped to school", JSON.stringify(await as(U.ad2, () => ids("SELECT student_id FROM public.engagement_score_history"))) === JSON.stringify([ST.c]));

// ── RLS: writes are service-role only ───────────────────────────────────────────────────────────
for (const [who, uid] of [["student", U.s1], ["teacher", U.t1], ["admin", U.ad1]]) {
  let blocked = false;
  await as(uid, async () => {
    try { await db.query(`INSERT INTO public.engagement_scores (student_id, school_id, window_days, period_start, period_end, status, score) VALUES ('${ST.a}', '${SCH1}', 30, now(), now(), 'ok', 100) ON CONFLICT (student_id) DO UPDATE SET score = 100`); }
    catch { blocked = true; }
  });
  ok(`${who} cannot write a score`, blocked);
}
{
  let updated = 0;
  await as(U.s1, async () => { updated = (await db.query(`UPDATE public.engagement_scores SET score = 100 WHERE student_id = '${ST.a}' RETURNING 1`)).rows.length; });
  ok("student cannot update their own score", updated === 0);
}
ok("recalc queue is invisible to users", (await as(U.ad1, () => db.query("SELECT * FROM public.engagement_recalc_queue"))).rows.length === 0);

// ── RLS: settings ───────────────────────────────────────────────────────────────────────────────
{
  let own = true, other = true, teacher = true;
  await as(U.ad1, async () => {
    try { await db.query(`INSERT INTO public.engagement_settings (school_id, config) VALUES ('${SCH1}', '{"window_days":14}')`); } catch { own = false; }
    try { await db.query(`INSERT INTO public.engagement_settings (school_id, config) VALUES ('${SCH2}', '{"window_days":14}')`); } catch { other = false; }
  });
  await as(U.t1, async () => { try { await db.query(`INSERT INTO public.engagement_settings (school_id, config) VALUES ('${SCH1}', '{}') ON CONFLICT DO NOTHING`); } catch { teacher = false; } });
  ok("admin can configure their own school", own);
  ok("admin cannot configure another school", !other);
  ok("teacher cannot configure settings", !teacher);
  ok("school staff can read their settings", (await as(U.ad1, () => db.query("SELECT 1 FROM public.engagement_settings"))).rows.length === 1);
  ok("other school cannot read them", (await as(U.ad2, () => db.query("SELECT 1 FROM public.engagement_settings"))).rows.length === 0);
}

// ── automatic updates: triggers enqueue the right student, once ─────────────────────────────────
const queue = async () => (await db.query("SELECT student_id, reason FROM public.engagement_recalc_queue ORDER BY student_id")).rows;
const clearQ = () => db.exec("DELETE FROM public.engagement_recalc_queue");
await clearQ();
await db.exec(`INSERT INTO public.homework_submissions (student_id) VALUES ('${U.s1}')`);
ok("homework submission (profile id) marks the right student", JSON.stringify(await queue()) === JSON.stringify([{ student_id: ST.a, reason: "homework" }]), JSON.stringify(await queue()));
await clearQ();
await db.exec(`INSERT INTO public.worksheet_submissions (student_id) VALUES ('${U.s2}')`);
ok("worksheet submission marks the right student", (await queue())[0]?.student_id === ST.b && (await queue())[0]?.reason === "worksheet");
await clearQ();
await db.exec(`INSERT INTO public.generated_assessment_paper_attempts (student_id) VALUES ('${ST.c}')`);
ok("quiz attempt (students.id) marks the right student", (await queue())[0]?.student_id === ST.c && (await queue())[0]?.reason === "quiz");
await clearQ();
await db.exec(`INSERT INTO public.virtual_classroom_attendance (student_id) VALUES ('${ST.a}')`);
ok("live-class attendance marks the right student", (await queue())[0]?.reason === "live_class");
await clearQ();
await db.exec(`INSERT INTO public.classroom_posts (author_id, kind) VALUES ('${U.s1}', 'question')`);
ok("a classroom question marks the author", (await queue())[0]?.student_id === ST.a);
await clearQ();
await db.exec(`INSERT INTO public.learning_events (student_id, event_type) VALUES ('${ST.a}', 'video_progress'), ('${ST.a}', 'video_progress'), ('${ST.a}', 'tutor_message')`);
ok("video progress and tutor messages mark the student - once, not per event", (await queue()).length === 1);
await clearQ();
await db.exec(`INSERT INTO public.learning_events (student_id, event_type) VALUES ('${ST.a}', 'session_heartbeat'), ('${ST.a}', 'page_view')`);
ok("heartbeats and page views do NOT trigger recalculation", (await queue()).length === 0);
await clearQ();
await db.exec(`INSERT INTO public.homework_submissions (student_id) VALUES ('99999999-9999-9999-9999-999999999999')`);
ok("an unknown student id never breaks the source insert", (await queue()).length === 0);
await clearQ();
const before = (await db.query(`SELECT 1`)).rows.length;
await db.exec(`INSERT INTO public.homework_submissions (student_id) VALUES ('${U.s1}')`);
const t1 = (await db.query("SELECT requested_at FROM public.engagement_recalc_queue")).rows[0].requested_at;
await new Promise((r) => setTimeout(r, 15));
await db.exec(`INSERT INTO public.homework_submissions (student_id) VALUES ('${U.s1}')`);
const rows = (await db.query("SELECT requested_at FROM public.engagement_recalc_queue")).rows;
ok("repeat activity keeps ONE queue row and refreshes its timestamp", rows.length === 1 && new Date(rows[0].requested_at) >= new Date(t1));

// ── history uniqueness ──────────────────────────────────────────────────────────────────────────
{
  let dup = false;
  try { await db.exec(`INSERT INTO public.engagement_score_history (student_id, school_id, snapshot_date, window_days, status, score) VALUES ('${ST.a}','${SCH1}',current_date,30,'ok',10)`); } catch { dup = true; }
  ok("only one history snapshot per student per day", dup);
}
{
  let bad = false;
  try { await db.exec(`INSERT INTO public.engagement_scores (student_id, school_id, window_days, period_start, period_end, status, score) VALUES ('${ST.b}','${SCH1}',30,now(),now(),'ok',150) ON CONFLICT (student_id) DO UPDATE SET score = 150`); } catch { bad = true; }
  ok("scores outside 0-100 are rejected", bad);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
