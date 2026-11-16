-- =============================================================================
-- APAS - Daily Practice Problems (DPP)
--
-- Design (reuses what already exists, creates no second engine):
--  * Questions come from the existing item bank (question_bank, status = 'active', i.e. teacher-reviewed)
--    or are written by teachers (MCQ, true/false, short answer, numeric, open-ended).
--  * Every question is SNAPSHOTTED into dpp_items when a set is built, so history never changes if the
--    bank item is later edited or retired. dpp_items holds the answer key and has NO student policy:
--    students only ever receive keyless questions through the dpp_* functions.
--  * Grading is server-side only (dpp_finalize_attempt). Scores can't be changed from the browser.
--  * Auto-assignment picks bank questions for the student's class, favouring weak concepts and a
--    difficulty near the student's mastery (existing student_mastery / IRT irt_b). Graded answers feed the
--    existing mastery engine via record_mastery_evidence(), so Adaptive Practice sees DPP results.
--  * "Today" is the school's own calendar day (dpp_school_settings.timezone, default Asia/Kolkata).
--  * Nothing existing is altered. IDs: profiles/students/question_bank are uuid; learning objectives and
--    subtopics are bigint (so those columns are bigint and carry NO foreign key to tables whose live shape
--    may differ from the repository migrations).
-- Idempotent: safe to run twice.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.dpp_my_school() returns uuid
language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function public.dpp_my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.dpp_is_admin_role() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.dpp_my_role() in ('admin', 'principal', 'school_admin', 'hod'), false)
$$;

create or replace function public.dpp_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.dpp_my_role() in ('teacher', 'admin', 'principal', 'school_admin', 'hod'), false)
$$;

-- "Class 5", "Grade 5", "5th", "05" all become "5" so profile.class_grade can be matched with books.class_name.
create or replace function public.dpp_class_key(p text) returns text
language sql immutable as $$
  select regexp_replace(
           ltrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '(class|grade|standard|std)', '', 'g'), '[^a-z0-9]', '', 'g'), '0'),
           '^([0-9]+)(st|nd|rd|th)$', '\1')
$$;

create or replace function public.dpp_normalize_text(p text) returns text
language sql immutable as $$
  select regexp_replace(lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '[\.\,\;\!\?\s]+$', '')
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.dpp_school_settings (
  school_id uuid primary key,
  timezone text not null default 'Asia/Kolkata',
  auto_assign boolean not null default true,
  daily_question_count int not null default 10 check (daily_question_count between 3 and 30),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.dpp_today(p_school uuid) returns date
language plpgsql stable security definer set search_path = public as $$
declare v_tz text;
begin
  select timezone into v_tz from public.dpp_school_settings where school_id = p_school;
  return (now() at time zone coalesce(v_tz, 'Asia/Kolkata'))::date;
end $$;

create table if not exists public.dpp_sets (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  description text,
  subject text not null check (length(btrim(subject)) > 0),
  class_level text,
  chapter text,
  difficulty text not null default 'mixed' check (difficulty in ('easy', 'medium', 'hard', 'mixed')),
  time_limit_minutes int check (time_limit_minutes is null or time_limit_minutes between 1 and 240),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  source text not null default 'teacher' check (source in ('teacher', 'auto')),
  student_id uuid references public.profiles(id) on delete cascade,   -- owner of an auto-generated set
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_dpp_sets_school on public.dpp_sets(school_id, status, created_at desc);
create index if not exists idx_dpp_sets_creator on public.dpp_sets(created_by);

create table if not exists public.dpp_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.dpp_sets(id) on delete cascade,
  position int not null default 0,
  question_type text not null default 'mcq'
    check (question_type in ('mcq', 'true_false', 'short_answer', 'numeric', 'open_ended')),
  stem text not null check (length(btrim(stem)) > 0),
  options jsonb,
  correct_answer text,
  accepted_answers jsonb not null default '[]'::jsonb,
  numeric_answer numeric,
  tolerance numeric not null default 0 check (tolerance >= 0),
  explanation text,
  marks numeric not null default 1 check (marks > 0 and marks <= 100),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  bank_item_id uuid,                -- question_bank.id this was copied from (no FK on purpose)
  learning_objective_id bigint,
  subtopic_id bigint,
  chapter text,
  created_at timestamptz not null default now(),
  unique (set_id, position),
  constraint dpp_items_choice_ok check (
    question_type not in ('mcq', 'true_false') or (options is not null and correct_answer in ('A', 'B', 'C', 'D'))),
  constraint dpp_items_numeric_ok check (question_type <> 'numeric' or numeric_answer is not null),
  constraint dpp_items_short_ok check (question_type <> 'short_answer' or jsonb_array_length(accepted_answers) > 0)
);
create index if not exists idx_dpp_items_set on public.dpp_items(set_id, position);
create index if not exists idx_dpp_items_bank on public.dpp_items(bank_item_id);

create table if not exists public.dpp_assignments (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.dpp_sets(id) on delete cascade,
  school_id uuid not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  assigned_for date not null,
  source text not null default 'teacher' check (source in ('teacher', 'auto')),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (set_id, student_id)
);
create index if not exists idx_dpp_assign_student on public.dpp_assignments(student_id, assigned_for desc);
create index if not exists idx_dpp_assign_school_date on public.dpp_assignments(school_id, assigned_for);

create table if not exists public.dpp_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.dpp_assignments(id) on delete cascade,   -- one attempt per assignment: no duplicate submissions
  set_id uuid not null references public.dpp_sets(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  school_id uuid not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  grading_status text not null default 'auto' check (grading_status in ('auto', 'pending_manual', 'complete')),
  started_at timestamptz not null default now(),
  last_saved_at timestamptz not null default now(),
  submitted_at timestamptz,
  time_taken_seconds int,
  auto_submitted boolean not null default false,
  score numeric,
  max_score numeric,
  percent numeric,
  correct_count int,
  incorrect_count int,
  unanswered_count int,
  pending_manual_count int not null default 0
);
create index if not exists idx_dpp_attempts_student on public.dpp_attempts(student_id, submitted_at desc);
create index if not exists idx_dpp_attempts_school on public.dpp_attempts(school_id, submitted_at desc);
create index if not exists idx_dpp_attempts_set on public.dpp_attempts(set_id);

create table if not exists public.dpp_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.dpp_attempts(id) on delete cascade,
  item_id uuid not null references public.dpp_items(id) on delete cascade,
  answer text,
  is_correct boolean,                 -- stays NULL until the attempt is graded (never leaks the key)
  marks_awarded numeric,
  graded_by text check (graded_by in ('auto', 'teacher')),
  teacher_feedback text,
  updated_at timestamptz not null default now(),
  unique (attempt_id, item_id)
);
create index if not exists idx_dpp_answers_attempt on public.dpp_answers(attempt_id);
create index if not exists idx_dpp_answers_item on public.dpp_answers(item_id);

create table if not exists public.dpp_streaks (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  school_id uuid,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_completed_date date,
  total_completed int not null default 0,
  updated_at timestamptz not null default now()
);


-- Policy helpers (SECURITY DEFINER so policies on dpp_sets / dpp_assignments don't recurse into each other)
create or replace function public.dpp_is_assigned(p_set uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dpp_assignments a where a.set_id = p_set and a.student_id = auth.uid())
$$;
create or replace function public.dpp_set_visible_to_staff(p_set uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dpp_sets s where s.id = p_set and public.dpp_is_staff()
    and s.school_id is not distinct from public.dpp_my_school()
    and (public.dpp_is_admin_role() or s.created_by = auth.uid()))
$$;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security (reads only; every write goes through the functions below)
-- ---------------------------------------------------------------------------
alter table public.dpp_school_settings enable row level security;
alter table public.dpp_sets enable row level security;
alter table public.dpp_items enable row level security;
alter table public.dpp_assignments enable row level security;
alter table public.dpp_attempts enable row level security;
alter table public.dpp_answers enable row level security;
alter table public.dpp_streaks enable row level security;

drop policy if exists dpp_settings_read on public.dpp_school_settings;
create policy dpp_settings_read on public.dpp_school_settings for select to authenticated
  using (school_id is not distinct from public.dpp_my_school());

-- sets: staff of the school; a student only the sets assigned to them (title/subject, no questions)
drop policy if exists dpp_sets_read on public.dpp_sets;
create policy dpp_sets_read on public.dpp_sets for select to authenticated
  using (public.dpp_set_visible_to_staff(id) or public.dpp_is_assigned(id));

-- items hold the answer key: staff who may manage the set only. NO student policy.
drop policy if exists dpp_items_staff_read on public.dpp_items;
create policy dpp_items_staff_read on public.dpp_items for select to authenticated
  using (public.dpp_set_visible_to_staff(set_id));

drop policy if exists dpp_assign_read on public.dpp_assignments;
create policy dpp_assign_read on public.dpp_assignments for select to authenticated
  using (student_id = auth.uid() or public.dpp_set_visible_to_staff(set_id));

drop policy if exists dpp_attempts_read on public.dpp_attempts;
create policy dpp_attempts_read on public.dpp_attempts for select to authenticated
  using (student_id = auth.uid() or public.dpp_set_visible_to_staff(set_id));

drop policy if exists dpp_answers_read on public.dpp_answers;
create policy dpp_answers_read on public.dpp_answers for select to authenticated
  using (exists (select 1 from public.dpp_attempts t where t.id = dpp_answers.attempt_id
                  and (t.student_id = auth.uid() or public.dpp_set_visible_to_staff(t.set_id))));

drop policy if exists dpp_streaks_read on public.dpp_streaks;
create policy dpp_streaks_read on public.dpp_streaks for select to authenticated
  using (student_id = auth.uid()
         or (public.dpp_is_staff() and school_id is not distinct from public.dpp_my_school()));

-- no direct writes from the browser
revoke insert, update, delete, truncate on
  public.dpp_school_settings, public.dpp_sets, public.dpp_items, public.dpp_assignments,
  public.dpp_attempts, public.dpp_answers, public.dpp_streaks from anon, authenticated;
revoke all on
  public.dpp_school_settings, public.dpp_sets, public.dpp_items, public.dpp_assignments,
  public.dpp_attempts, public.dpp_answers, public.dpp_streaks from anon;

-- ---------------------------------------------------------------------------
-- 3. Grading (internal; not callable from the browser)
-- ---------------------------------------------------------------------------
create or replace function public.dpp_grade_item(p_item public.dpp_items, p_answer text, out is_correct boolean, out marks numeric)
language plpgsql immutable as $$
declare v_ans text := btrim(coalesce(p_answer, '')); v_clean text; v_ok boolean;
begin
  if v_ans = '' then is_correct := false; marks := 0; return; end if;
  if p_item.question_type in ('mcq', 'true_false') then
    v_ok := upper(v_ans) = upper(coalesce(p_item.correct_answer, ''));
  elsif p_item.question_type = 'short_answer' then
    v_ok := exists (select 1 from jsonb_array_elements_text(p_item.accepted_answers) a
                    where public.dpp_normalize_text(a) = public.dpp_normalize_text(v_ans));
  elsif p_item.question_type = 'numeric' then
    v_clean := replace(v_ans, ',', '');
    if v_clean ~ '^-?[0-9]+(\.[0-9]+)?$' then
      v_ok := abs(v_clean::numeric - p_item.numeric_answer) <= coalesce(p_item.tolerance, 0);
    else
      v_ok := false;
    end if;
  else
    is_correct := null; marks := null; return;           -- open_ended: a teacher marks it
  end if;
  is_correct := v_ok;
  marks := case when v_ok then p_item.marks else 0 end;
end $$;

create or replace function public.dpp_recompute_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_set uuid; v_max numeric; v_score numeric; v_ok int; v_bad int; v_none int; v_pending int; v_items int;
begin
  select set_id into v_set from public.dpp_attempts where id = p_attempt;
  select coalesce(sum(marks), 0), count(*) into v_max, v_items from public.dpp_items where set_id = v_set;
  select coalesce(sum(a.marks_awarded), 0),
         count(*) filter (where a.is_correct is true),
         count(*) filter (where a.is_correct is false and btrim(coalesce(a.answer, '')) <> ''),
         count(*) filter (where btrim(coalesce(a.answer, '')) = ''),
         count(*) filter (where a.is_correct is null and btrim(coalesce(a.answer, '')) <> '')
    into v_score, v_ok, v_bad, v_none, v_pending
    from public.dpp_answers a where a.attempt_id = p_attempt;
  update public.dpp_attempts
     set score = v_score, max_score = v_max,
         percent = case when v_max > 0 then round(100.0 * v_score / v_max, 1) else 0 end,
         correct_count = v_ok, incorrect_count = v_bad,
         unanswered_count = greatest(v_items - v_ok - v_bad - v_pending, 0),
         pending_manual_count = v_pending,
         grading_status = case when v_pending > 0 then 'pending_manual' else 'complete' end
   where id = p_attempt;
end $$;

-- Full result document, answer key included. Callers must have checked access and that the attempt is submitted.
create or replace function public.dpp_result_json(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_att public.dpp_attempts%rowtype; v_set public.dpp_sets%rowtype;
begin
  select * into v_att from public.dpp_attempts where id = p_attempt;
  select * into v_set from public.dpp_sets where id = v_att.set_id;
  return jsonb_build_object(
    'attempt_id', v_att.id, 'set_id', v_set.id, 'title', v_set.title, 'subject', v_set.subject, 'chapter', v_set.chapter,
    'status', v_att.status, 'grading_status', v_att.grading_status, 'auto_submitted', v_att.auto_submitted,
    'score', v_att.score, 'max_score', v_att.max_score, 'percent', v_att.percent,
    'correct', v_att.correct_count, 'incorrect', v_att.incorrect_count, 'unanswered', v_att.unanswered_count,
    'pending_manual', v_att.pending_manual_count,
    'accuracy', case when coalesce(v_att.correct_count, 0) + coalesce(v_att.incorrect_count, 0) > 0
                     then round(100.0 * v_att.correct_count / (v_att.correct_count + v_att.incorrect_count), 1) else 0 end,
    'time_taken_seconds', v_att.time_taken_seconds, 'submitted_at', v_att.submitted_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'answer_id', a.id, 'position', i.position, 'question_type', i.question_type, 'stem', i.stem,
        'options', i.options, 'marks', i.marks, 'difficulty', i.difficulty, 'chapter', i.chapter,
        'answer', a.answer, 'is_correct', a.is_correct, 'marks_awarded', a.marks_awarded,
        'pending', (a.is_correct is null and btrim(coalesce(a.answer, '')) <> ''),
        'correct_answer', case i.question_type
            when 'short_answer' then i.accepted_answers ->> 0
            when 'numeric' then i.numeric_answer::text
            when 'open_ended' then null
            else i.correct_answer end,
        'explanation', i.explanation, 'teacher_feedback', a.teacher_feedback
      ) order by i.position)
      from public.dpp_items i left join public.dpp_answers a on a.item_id = i.id and a.attempt_id = p_attempt
      where i.set_id = v_att.set_id), '[]'::jsonb));
end $$;

-- Grades an attempt exactly once: answers, totals, streak, and mastery evidence for the existing engine.
create or replace function public.dpp_finalize_attempt(p_attempt uuid, p_auto boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_att public.dpp_attempts%rowtype; v_limit int; v_today date; v_streak public.dpp_streaks%rowtype;
  v_sid uuid; r record; v_graded record; v_tz text; v_elapsed int; v_item public.dpp_items%rowtype; v_given text;
begin
  select * into v_att from public.dpp_attempts where id = p_attempt for update;
  if not found or v_att.status = 'submitted' then return; end if;

  -- grade every question (answered or not)
  for v_item in select * from public.dpp_items where set_id = v_att.set_id loop
    select a.answer into v_given from public.dpp_answers a where a.attempt_id = p_attempt and a.item_id = v_item.id;
    select * into v_graded from public.dpp_grade_item(v_item, v_given);
    insert into public.dpp_answers (attempt_id, item_id, answer, is_correct, marks_awarded, graded_by, updated_at)
    values (p_attempt, v_item.id, nullif(btrim(coalesce(v_given, '')), ''),
            v_graded.is_correct, v_graded.marks,
            case when v_graded.is_correct is null then null else 'auto' end, now())
    on conflict (attempt_id, item_id) do update
      set is_correct = excluded.is_correct, marks_awarded = excluded.marks_awarded,
          graded_by = excluded.graded_by, updated_at = now();
  end loop;

  select time_limit_minutes into v_limit from public.dpp_sets where id = v_att.set_id;
  v_elapsed := greatest(0, extract(epoch from (now() - v_att.started_at))::int);
  if v_limit is not null then v_elapsed := least(v_elapsed, v_limit * 60); end if;

  update public.dpp_attempts
     set status = 'submitted', submitted_at = now(), time_taken_seconds = v_elapsed, auto_submitted = p_auto
   where id = p_attempt;
  perform public.dpp_recompute_attempt(p_attempt);

  -- daily streak on the school's own calendar day
  v_today := public.dpp_today(v_att.school_id);
  select * into v_streak from public.dpp_streaks where student_id = v_att.student_id for update;
  if not found then
    insert into public.dpp_streaks (student_id, school_id, current_streak, longest_streak, last_completed_date, total_completed)
    values (v_att.student_id, v_att.school_id, 1, 1, v_today, 1);
  else
    update public.dpp_streaks
       set current_streak = case when last_completed_date = v_today then current_streak
                                 when last_completed_date = v_today - 1 then current_streak + 1 else 1 end,
           longest_streak = greatest(longest_streak, case when last_completed_date = v_today then current_streak
                                 when last_completed_date = v_today - 1 then current_streak + 1 else 1 end),
           last_completed_date = v_today, total_completed = total_completed + 1,
           school_id = coalesce(school_id, v_att.school_id), updated_at = now()
     where student_id = v_att.student_id;
  end if;

  -- feed the existing mastery engine (Adaptive Practice, CAT, Next Best Action all read student_mastery).
  -- 'mcq' is the engine's own label for graded objective questions; a failure here never blocks the submission.
  begin
    select id into v_sid from public.students where profile_id = v_att.student_id;
    if v_sid is not null then
      for r in
        select i.learning_objective_id as lo, a.is_correct
          from public.dpp_answers a join public.dpp_items i on i.id = a.item_id
         where a.attempt_id = p_attempt and i.learning_objective_id is not null
           and a.is_correct is not null and btrim(coalesce(a.answer, '')) <> ''
      loop
        perform public.record_mastery_evidence(v_sid, r.lo, r.is_correct, 'mcq', p_attempt);
      end loop;
    end if;
  exception when others then
    raise warning 'dpp mastery evidence skipped: %', sqlerrm;
  end;
end $$;

-- If the time limit ran out while the student was away, grade what was saved.
create or replace function public.dpp_expired(p_attempt public.dpp_attempts) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_limit int;
begin
  select time_limit_minutes into v_limit from public.dpp_sets where id = p_attempt.set_id;
  return v_limit is not null and p_attempt.status = 'in_progress'
         and now() > p_attempt.started_at + make_interval(mins => v_limit) + interval '60 seconds';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Automatic daily assignment (adaptive: weak concepts first, difficulty near the student's mastery)
-- ---------------------------------------------------------------------------
create or replace function public.dpp_ensure_auto(p_student uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_school uuid; v_class text; v_auto boolean; v_n int; v_today date; v_sid uuid; v_avg numeric;
  v_target numeric; v_grade text; v_key text; v_set uuid; v_count int; v_subjects int; v_subject text;
begin
  select school_id, class_grade into v_school, v_class from public.profiles where id = p_student and role = 'student';
  if v_school is null then return; end if;
  select auto_assign, daily_question_count into v_auto, v_n from public.dpp_school_settings where school_id = v_school;
  if not found then v_auto := true; v_n := 10; end if;
  if not v_auto then return; end if;
  v_today := public.dpp_today(v_school);

  perform pg_advisory_xact_lock(hashtext('dpp_auto:' || p_student::text || v_today::text));
  if exists (select 1 from public.dpp_assignments a where a.student_id = p_student and a.source = 'auto' and a.assigned_for = v_today) then
    return;
  end if;

  select id, grade into v_sid, v_grade from public.students where profile_id = p_student;
  v_class := coalesce(nullif(btrim(v_class), ''), v_grade);
  v_key := public.dpp_class_key(v_class);
  if v_key = '' then return; end if;

  select coalesce(avg(p_mastery), 0.40) into v_avg from public.student_mastery where student_id = v_sid;
  v_target := greatest(-1.5, least(1.5, (v_avg - 0.5) * 2.5));      -- low mastery -> easier items, high -> harder

  insert into public.dpp_sets (school_id, title, subject, class_level, difficulty, status, source, student_id)
  values (v_school, 'Daily Practice - ' || to_char(v_today, 'DD Mon'), 'Mixed', v_class, 'mixed', 'published', 'auto', p_student)
  returning id into v_set;

  insert into public.dpp_items (set_id, position, question_type, stem, options, correct_answer, explanation, marks,
                                difficulty, bank_item_id, learning_objective_id, subtopic_id, chapter)
  select v_set, row_number() over (order by c.rn, c.sc)::int, 'mcq', c.stem, c.options, c.correct_option, c.explanation, 1,
         case when c.irt_b < -0.5 then 'easy' when c.irt_b > 0.5 then 'hard' else 'medium' end,
         c.id, c.learning_objective_id, c.subtopic_id, c.chapter_name
    from (
      select s.*, row_number() over (partition by s.subject order by s.sc) as rn
        from (
          select qb.id, qb.stem, qb.options, qb.correct_option, qb.explanation, qb.irt_b, qb.learning_objective_id,
                 qb.subtopic_id, ch.chapter_name, b.subject,
                 coalesce(sm.p_mastery, 0.30) * 1.5 + abs(qb.irt_b - v_target) + random() * 0.5 as sc
            from public.question_bank qb
            join public.subtopics st on st.id = qb.subtopic_id
            join public.topics tp on tp.id = st.topic_id
            join public.curriculum_chapters ch on ch.id = tp.chapter_id
            join public.units u on u.id = ch.unit_id
            join public.books b on b.id = u.book_id
            left join public.student_mastery sm on sm.student_id = v_sid and sm.learning_objective_id = qb.learning_objective_id
           where qb.status = 'active'
             and coalesce(qb.review_flag, 'ok') <> 'review_key'
             and coalesce(b.is_active, true)
             and (b.school_id is null or b.school_id = v_school)
             and public.dpp_class_key(b.class_name) = v_key
             and not exists (
               select 1 from public.dpp_items di join public.dpp_assignments da on da.set_id = di.set_id
                where da.student_id = p_student and di.bank_item_id = qb.id and da.assigned_for > v_today - 30)
        ) s
    ) c
   order by c.rn, c.sc
   limit v_n;
  get diagnostics v_count = row_count;

  if v_count < 3 then              -- not enough reviewed questions for this class: assign nothing today
    delete from public.dpp_sets where id = v_set;
    return;
  end if;

  select count(distinct b.subject) into v_subjects
    from public.dpp_items i join public.question_bank qb on qb.id = i.bank_item_id
    join public.subtopics st on st.id = qb.subtopic_id join public.topics tp on tp.id = st.topic_id
    join public.curriculum_chapters ch on ch.id = tp.chapter_id join public.units u on u.id = ch.unit_id
    join public.books b on b.id = u.book_id where i.set_id = v_set;
  if v_subjects = 1 then
    select b.subject into v_subject
      from public.dpp_items i join public.question_bank qb on qb.id = i.bank_item_id
      join public.subtopics st on st.id = qb.subtopic_id join public.topics tp on tp.id = st.topic_id
      join public.curriculum_chapters ch on ch.id = tp.chapter_id join public.units u on u.id = ch.unit_id
      join public.books b on b.id = u.book_id where i.set_id = v_set limit 1;
    update public.dpp_sets set subject = coalesce(v_subject, 'Mixed') where id = v_set;
  end if;

  insert into public.dpp_assignments (set_id, school_id, student_id, assigned_for, source)
  values (v_set, v_school, p_student, v_today, 'auto');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Student functions
-- ---------------------------------------------------------------------------
create or replace function public.dpp_student_today() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_school uuid; v_today date; v_list jsonb; v_streak jsonb; v_exp uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if public.dpp_my_role() <> 'student' then raise exception 'FORBIDDEN: Daily Practice is for students'; end if;
  v_school := public.dpp_my_school();
  -- attempts whose time limit ran out while the student was away are graded now
  for v_exp in select t.id from public.dpp_attempts t where t.student_id = v_uid and t.status = 'in_progress' and public.dpp_expired(t) loop
    perform public.dpp_finalize_attempt(v_exp, true);
  end loop;
  perform public.dpp_ensure_auto(v_uid);
  v_today := public.dpp_today(v_school);

  select coalesce(jsonb_agg(row_j order by sort_date desc, created_at desc), '[]'::jsonb) into v_list from (
    select jsonb_build_object(
             'assignment_id', a.id, 'set_id', s.id, 'title', s.title, 'description', s.description, 'subject', s.subject,
             'chapter', s.chapter, 'difficulty', s.difficulty, 'time_limit_minutes', s.time_limit_minutes, 'source', a.source,
             'assigned_for', a.assigned_for,
             'question_count', (select count(*) from public.dpp_items i where i.set_id = s.id),
             'total_marks', (select coalesce(sum(i.marks), 0) from public.dpp_items i where i.set_id = s.id),
             'status', case when t.status = 'submitted' then 'submitted' when t.id is not null then 'in_progress' else 'not_started' end,
             'attempt_id', t.id, 'percent', t.percent, 'score', t.score, 'max_score', t.max_score, 'submitted_at', t.submitted_at,
             'grading_status', t.grading_status,
             'overdue', (a.assigned_for < v_today and t.status is distinct from 'submitted')
           ) as row_j, a.assigned_for as sort_date, a.created_at
      from public.dpp_assignments a
      join public.dpp_sets s on s.id = a.set_id and s.status = 'published'
      left join public.dpp_attempts t on t.assignment_id = a.id
     where a.student_id = v_uid and a.assigned_for <= v_today
       and ((a.assigned_for = v_today) or (t.status is distinct from 'submitted' and a.assigned_for >= v_today - 14))
  ) x;

  select jsonb_build_object('current', case when last_completed_date >= v_today - 1 then current_streak else 0 end,
                            'longest', longest_streak, 'total_completed', total_completed,
                            'done_today', last_completed_date = v_today)
    into v_streak from public.dpp_streaks where student_id = v_uid;

  return jsonb_build_object('today', v_today, 'assignments', v_list,
    'streak', coalesce(v_streak, jsonb_build_object('current', 0, 'longest', 0, 'total_completed', 0, 'done_today', false)));
end $$;

create or replace function public.dpp_start_attempt(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_a public.dpp_assignments%rowtype; v_set public.dpp_sets%rowtype;
  v_att public.dpp_attempts%rowtype; v_today date; v_remaining int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_a from public.dpp_assignments where id = p_assignment and student_id = v_uid;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
  select * into v_set from public.dpp_sets where id = v_a.set_id and status = 'published';
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
  v_today := public.dpp_today(v_a.school_id);
  if v_a.assigned_for > v_today then raise exception 'NOT_AVAILABLE_YET: this practice opens on %', v_a.assigned_for; end if;

  insert into public.dpp_attempts (assignment_id, set_id, student_id, school_id)
  values (v_a.id, v_a.set_id, v_uid, v_a.school_id) on conflict (assignment_id) do nothing;
  select * into v_att from public.dpp_attempts where assignment_id = v_a.id;

  if v_att.status = 'submitted' then raise exception 'ALREADY_SUBMITTED: %', v_att.id; end if;
  if public.dpp_expired(v_att) then
    perform public.dpp_finalize_attempt(v_att.id, true);
    return jsonb_build_object('time_up', true, 'attempt_id', v_att.id);
  end if;

  v_remaining := case when v_set.time_limit_minutes is null then null
                      else greatest(0, (v_set.time_limit_minutes * 60 - extract(epoch from (now() - v_att.started_at))::int)) end;
  return jsonb_build_object(
    'attempt_id', v_att.id, 'set_id', v_set.id, 'title', v_set.title, 'subject', v_set.subject,
    'time_limit_minutes', v_set.time_limit_minutes, 'remaining_seconds', v_remaining, 'started_at', v_att.started_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.id, 'position', i.position, 'question_type', i.question_type,
                                          'stem', i.stem, 'options', i.options, 'marks', i.marks, 'difficulty', i.difficulty)
                       order by i.position)
        from public.dpp_items i where i.set_id = v_set.id), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_object_agg(a.item_id::text, a.answer) from public.dpp_answers a
       where a.attempt_id = v_att.id and a.answer is not null), '{}'::jsonb));
end $$;

create or replace function public.dpp_save_answer(p_attempt uuid, p_item uuid, p_answer text) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_att public.dpp_attempts%rowtype; v_clean text := left(btrim(coalesce(p_answer, '')), 2000);
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_att from public.dpp_attempts where id = p_attempt and student_id = v_uid for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_att.status <> 'in_progress' then raise exception 'ALREADY_SUBMITTED: %', v_att.id; end if;
  if public.dpp_expired(v_att) then
    perform public.dpp_finalize_attempt(v_att.id, true);     -- time ran out: grade what was saved (not rolled back: no exception)
    return 'time_up';
  end if;
  if not exists (select 1 from public.dpp_items where id = p_item and set_id = v_att.set_id) then
    raise exception 'ITEM_NOT_FOUND';
  end if;
  if v_clean = '' then
    delete from public.dpp_answers where attempt_id = p_attempt and item_id = p_item;
  else
    insert into public.dpp_answers (attempt_id, item_id, answer, updated_at) values (p_attempt, p_item, v_clean, now())
    on conflict (attempt_id, item_id) do update set answer = excluded.answer, updated_at = now();
  end if;
  update public.dpp_attempts set last_saved_at = now() where id = p_attempt;
  return 'saved';
end $$;

create or replace function public.dpp_submit_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_att public.dpp_attempts%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_att from public.dpp_attempts where id = p_attempt and student_id = v_uid;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  perform public.dpp_finalize_attempt(p_attempt, public.dpp_expired(v_att));   -- no-op when already submitted
  return public.dpp_result_json(p_attempt);
end $$;

-- A finished attempt with the answer key. Owner, or staff who manage the set.
create or replace function public.dpp_get_result(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_att public.dpp_attempts%rowtype; v_json jsonb; v_name text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_att from public.dpp_attempts where id = p_attempt;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if v_att.student_id <> v_uid and not (
       public.dpp_is_staff() and v_att.school_id is not distinct from public.dpp_my_school()
       and (public.dpp_is_admin_role() or exists (select 1 from public.dpp_sets s where s.id = v_att.set_id and s.created_by = v_uid))) then
    raise exception 'ATTEMPT_NOT_FOUND';
  end if;
  if v_att.status <> 'submitted' then raise exception 'NOT_SUBMITTED'; end if;
  v_json := public.dpp_result_json(p_attempt);
  select full_name into v_name from public.profiles where id = v_att.student_id;
  return v_json || jsonb_build_object('student_name', v_name, 'student_id', v_att.student_id);
end $$;

-- Aggregates used by the student dashboard and the parent view.
create or replace function public.dpp_summary_json(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid; v_today date; v_tz text; v_week jsonb; v_subj jsonb; v_diff jsonb; v_improve jsonb; v_tot jsonb; v_streak jsonb;
begin
  select school_id into v_school from public.profiles where id = p_student;
  v_today := public.dpp_today(v_school);
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from public.dpp_school_settings where school_id = v_school;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  select jsonb_build_object('attempts', count(*), 'avg_percent', coalesce(round(avg(percent), 1), 0),
                            'correct', coalesce(sum(correct_count), 0), 'incorrect', coalesce(sum(incorrect_count), 0),
                            'questions', coalesce(sum(correct_count + incorrect_count + unanswered_count), 0),
                            'time_seconds', coalesce(sum(time_taken_seconds), 0))
    into v_tot from public.dpp_attempts where student_id = p_student and status = 'submitted';

  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'attempts', coalesce(x.n, 0), 'percent', x.pct) order by d), '[]'::jsonb)
    into v_week
    from generate_series(v_today - 6, v_today, interval '1 day') g(d0)
    cross join lateral (select g.d0::date as d) dd
    left join lateral (
      select count(*) as n, round(avg(t.percent), 1) as pct from public.dpp_attempts t
       where t.student_id = p_student and t.status = 'submitted' and (t.submitted_at at time zone v_tz)::date = dd.d) x on true;

  select coalesce(jsonb_agg(jsonb_build_object('subject', subject, 'answered', answered, 'correct', correct,
           'accuracy', round(100.0 * correct / nullif(answered, 0), 1)) order by subject), '[]'::jsonb)
    into v_subj from (
      select s.subject, count(*) filter (where btrim(coalesce(a.answer, '')) <> '') as answered, count(*) filter (where a.is_correct) as correct
        from public.dpp_answers a join public.dpp_attempts t on t.id = a.attempt_id and t.status = 'submitted'
        join public.dpp_items i on i.id = a.item_id join public.dpp_sets s on s.id = i.set_id
       where t.student_id = p_student group by s.subject) q;

  select coalesce(jsonb_agg(jsonb_build_object('difficulty', difficulty, 'answered', answered, 'correct', correct,
           'accuracy', round(100.0 * correct / nullif(answered, 0), 1)) order by difficulty), '[]'::jsonb)
    into v_diff from (
      select i.difficulty, count(*) filter (where btrim(coalesce(a.answer, '')) <> '') as answered, count(*) filter (where a.is_correct) as correct
        from public.dpp_answers a join public.dpp_attempts t on t.id = a.attempt_id and t.status = 'submitted'
        join public.dpp_items i on i.id = a.item_id where t.student_id = p_student group by i.difficulty) q;

  select coalesce(jsonb_agg(jsonb_build_object('subject', subject, 'chapter', chapter, 'answered', answered,
           'accuracy', round(100.0 * correct / nullif(answered, 0), 1)) order by correct::numeric / nullif(answered, 0)), '[]'::jsonb)
    into v_improve from (
      select s.subject, coalesce(i.chapter, 'General') as chapter,
             count(*) filter (where btrim(coalesce(a.answer, '')) <> '') as answered, count(*) filter (where a.is_correct) as correct
        from public.dpp_answers a join public.dpp_attempts t on t.id = a.attempt_id and t.status = 'submitted'
        join public.dpp_items i on i.id = a.item_id join public.dpp_sets s on s.id = i.set_id
       where t.student_id = p_student group by s.subject, coalesce(i.chapter, 'General')
      having count(*) filter (where btrim(coalesce(a.answer, '')) <> '') >= 3
         and count(*) filter (where a.is_correct)::numeric / nullif(count(*) filter (where btrim(coalesce(a.answer, '')) <> ''), 0) < 0.6
       limit 5) q;

  select jsonb_build_object('current', case when last_completed_date >= v_today - 1 then current_streak else 0 end,
                            'longest', longest_streak, 'total_completed', total_completed, 'done_today', last_completed_date = v_today)
    into v_streak from public.dpp_streaks where student_id = p_student;

  return jsonb_build_object('totals', v_tot, 'week', v_week, 'by_subject', v_subj, 'by_difficulty', v_diff, 'improve', v_improve,
    'streak', coalesce(v_streak, jsonb_build_object('current', 0, 'longest', 0, 'total_completed', 0, 'done_today', false)));
end $$;

create or replace function public.dpp_student_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return public.dpp_summary_json(auth.uid());
end $$;

create or replace function public.dpp_history(p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('attempt_id', t.id, 'title', s.title, 'subject', s.subject, 'submitted_at', t.submitted_at,
             'percent', t.percent, 'score', t.score, 'max_score', t.max_score, 'correct', t.correct_count,
             'incorrect', t.incorrect_count, 'time_taken_seconds', t.time_taken_seconds, 'grading_status', t.grading_status)
           order by t.submitted_at desc)
      from (select * from public.dpp_attempts where student_id = v_uid and status = 'submitted'
             order by submitted_at desc limit greatest(1, least(coalesce(p_limit, 30), 100))) t
      join public.dpp_sets s on s.id = t.set_id), '[]'::jsonb);
end $$;

-- Weak concepts from this student's graded DPP answers, to launch the existing Adaptive Practice on them.
create or replace function public.dpp_recommendations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('subtopic_id', subtopic_id, 'name', name, 'chapter', chapter, 'subject', subject,
                                         'answered', answered, 'accuracy', acc) order by acc)
      from (
        select i.subtopic_id, max(coalesce(st.subtopic_name, i.chapter, 'Concept')) as name, max(i.chapter) as chapter, max(s.subject) as subject,
               count(*) as answered, round(100.0 * count(*) filter (where a.is_correct) / count(*), 1) as acc
          from public.dpp_answers a
          join public.dpp_attempts t on t.id = a.attempt_id and t.status = 'submitted' and t.student_id = v_uid
          join public.dpp_items i on i.id = a.item_id join public.dpp_sets s on s.id = i.set_id
          left join public.subtopics st on st.id = i.subtopic_id
         where i.subtopic_id is not null and btrim(coalesce(a.answer, '')) <> ''
         group by i.subtopic_id
        having count(*) >= 2 and 100.0 * count(*) filter (where a.is_correct) / count(*) < 60
         order by 6 limit 5) w), '[]'::jsonb);
end $$;

-- AI Tutor context for one DPP question. The answer key and explanation are released only AFTER the attempt is
-- submitted; during an active attempt the tutor gets the question only and must give hints, never the answer.
create or replace function public.dpp_tutor_context(p_student uuid, p_attempt uuid, p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_att public.dpp_attempts%rowtype; v_i public.dpp_items%rowtype; v_a public.dpp_answers%rowtype; v_set public.dpp_sets%rowtype;
begin
  if auth.uid() is not null and auth.uid() <> p_student then raise exception 'FORBIDDEN'; end if;
  select * into v_att from public.dpp_attempts where id = p_attempt and student_id = p_student;
  if not found then return null; end if;
  select * into v_i from public.dpp_items where id = p_item and set_id = v_att.set_id;
  if not found then return null; end if;
  select * into v_set from public.dpp_sets where id = v_att.set_id;
  select * into v_a from public.dpp_answers where attempt_id = p_attempt and item_id = p_item;
  if v_att.status <> 'submitted' then
    return jsonb_build_object('locked', true, 'subject', v_set.subject, 'chapter', v_i.chapter, 'stem', v_i.stem, 'options', v_i.options,
                              'question_type', v_i.question_type);
  end if;
  return jsonb_build_object('locked', false, 'subject', v_set.subject, 'chapter', v_i.chapter, 'stem', v_i.stem, 'options', v_i.options,
    'question_type', v_i.question_type, 'student_answer', v_a.answer, 'is_correct', v_a.is_correct,
    'correct_answer', case v_i.question_type when 'short_answer' then v_i.accepted_answers ->> 0 when 'numeric' then v_i.numeric_answer::text
                                             when 'open_ended' then null else v_i.correct_answer end,
    'explanation', v_i.explanation);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Teacher / admin functions
-- ---------------------------------------------------------------------------
create or replace function public.dpp_can_manage_set(p_set uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dpp_sets s
     where s.id = p_set and public.dpp_is_staff() and s.school_id is not distinct from public.dpp_my_school()
       and (public.dpp_is_admin_role() or s.created_by = auth.uid()))
$$;

create or replace function public.dpp_staff_options() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.dpp_my_school();
begin
  if not public.dpp_is_staff() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object('class_level', cl, 'section', sec, 'students', n) order by cl, sec)
        from (select class_grade as cl, coalesce(section, '') as sec, count(*) as n from public.profiles
               where school_id = v_school and role = 'student' and class_grade is not null
               group by class_grade, coalesce(section, '')) q), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(distinct b.subject) from public.books b
       where (b.school_id = v_school or b.school_id is null) and b.subject is not null and coalesce(b.is_active, true)), '[]'::jsonb),
    'timezone', coalesce((select timezone from public.dpp_school_settings where school_id = v_school), 'Asia/Kolkata'));
end $$;

-- Reviewed (active) bank questions a teacher can pick from, with the key (staff only).
create or replace function public.dpp_pick_bank_items(p_subject text, p_class_level text, p_chapter text default null, p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.dpp_my_school();
begin
  if not public.dpp_is_staff() then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('bank_item_id', id, 'stem', stem, 'options', options, 'correct_answer', correct_option,
             'explanation', explanation, 'learning_objective_id', learning_objective_id, 'subtopic_id', subtopic_id,
             'chapter', chapter_name, 'subject', subject,
             'difficulty', case when irt_b < -0.5 then 'easy' when irt_b > 0.5 then 'hard' else 'medium' end))
      from (
        select qb.id, qb.stem, qb.options, qb.correct_option, qb.explanation, qb.learning_objective_id, qb.subtopic_id, qb.irt_b,
               ch.chapter_name, b.subject
          from public.question_bank qb
          join public.subtopics st on st.id = qb.subtopic_id join public.topics tp on tp.id = st.topic_id
          join public.curriculum_chapters ch on ch.id = tp.chapter_id join public.units u on u.id = ch.unit_id
          join public.books b on b.id = u.book_id
           and (b.school_id is null or b.school_id = v_school) and coalesce(b.is_active, true)
           and (nullif(btrim(p_subject), '') is null or lower(b.subject) = lower(btrim(p_subject)))
           and (nullif(btrim(p_class_level), '') is null or public.dpp_class_key(b.class_name) = public.dpp_class_key(p_class_level))
           and (nullif(btrim(p_chapter), '') is null or ch.chapter_name ilike '%' || btrim(p_chapter) || '%')
         order by random() limit greatest(1, least(coalesce(p_limit, 30), 100))) q), '[]'::jsonb);
end $$;

create or replace function public.dpp_save_set(p_set_id uuid, p_set jsonb, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_school uuid := public.dpp_my_school(); v_id uuid := p_set_id; it jsonb; v_pos int := 0;
  v_type text; v_opts jsonb; v_correct text; v_title text := left(btrim(coalesce(p_set ->> 'title', '')), 200);
  v_subject text := left(btrim(coalesce(p_set ->> 'subject', '')), 100); v_limit int; v_diff text;
  v_accepted jsonb; v_marks numeric; v_idifficulty text;
begin
  if v_uid is null or not public.dpp_is_staff() then raise exception 'FORBIDDEN'; end if;
  if v_school is null then raise exception 'NO_SCHOOL'; end if;
  if v_title = '' then raise exception 'INVALID: title is required'; end if;
  if v_subject = '' then raise exception 'INVALID: subject is required'; end if;
  v_limit := nullif(p_set ->> 'time_limit_minutes', '')::int;
  if v_limit is not null and (v_limit < 1 or v_limit > 240) then raise exception 'INVALID: time limit must be 1-240 minutes'; end if;
  v_diff := coalesce(nullif(p_set ->> 'difficulty', ''), 'mixed');
  if v_diff not in ('easy', 'medium', 'hard', 'mixed') then raise exception 'INVALID: difficulty'; end if;

  if v_id is null then
    insert into public.dpp_sets (school_id, title, description, subject, class_level, chapter, difficulty, time_limit_minutes, status, source, created_by)
    values (v_school, v_title, nullif(btrim(coalesce(p_set ->> 'description', '')), ''), v_subject,
            nullif(btrim(coalesce(p_set ->> 'class_level', '')), ''), nullif(btrim(coalesce(p_set ->> 'chapter', '')), ''),
            v_diff, v_limit, 'draft', 'teacher', v_uid) returning id into v_id;
  else
    if not public.dpp_can_manage_set(v_id) then raise exception 'FORBIDDEN'; end if;
    if exists (select 1 from public.dpp_sets where id = v_id and source = 'auto') then raise exception 'INVALID: automatic sets cannot be edited'; end if;
    update public.dpp_sets
       set title = v_title, description = nullif(btrim(coalesce(p_set ->> 'description', '')), ''), subject = v_subject,
           class_level = nullif(btrim(coalesce(p_set ->> 'class_level', '')), ''), chapter = nullif(btrim(coalesce(p_set ->> 'chapter', '')), ''),
           difficulty = v_diff, time_limit_minutes = v_limit, updated_at = now()
     where id = v_id;
  end if;

  if p_items is not null then
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
      raise exception 'INVALID: a set needs 1 to 50 questions';
    end if;
    if exists (select 1 from public.dpp_attempts where set_id = v_id) then
      raise exception 'SET_LOCKED: students have already started this set; create a new set instead';
    end if;
    delete from public.dpp_items where set_id = v_id;
    for it in select * from jsonb_array_elements(p_items) loop
      v_pos := v_pos + 1;
      v_type := coalesce(it ->> 'question_type', 'mcq');
      if v_type not in ('mcq', 'true_false', 'short_answer', 'numeric', 'open_ended') then raise exception 'INVALID: question % has an unknown type', v_pos; end if;
      if length(btrim(coalesce(it ->> 'stem', ''))) = 0 then raise exception 'INVALID: question % has no text', v_pos; end if;
      v_marks := coalesce(nullif(it ->> 'marks', '')::numeric, 1);
      if v_marks <= 0 or v_marks > 100 then raise exception 'INVALID: question % marks must be between 0 and 100', v_pos; end if;
      v_idifficulty := coalesce(nullif(it ->> 'difficulty', ''), 'medium');
      if v_idifficulty not in ('easy', 'medium', 'hard') then v_idifficulty := 'medium'; end if;
      v_opts := null; v_correct := null; v_accepted := '[]'::jsonb;
      if v_type = 'mcq' then
        v_opts := it -> 'options';
        v_correct := upper(coalesce(it ->> 'correct_answer', ''));
        if v_opts is null or jsonb_typeof(v_opts) <> 'object' or not (v_opts ? 'A') or not (v_opts ? 'B') then
          raise exception 'INVALID: question % needs at least options A and B', v_pos;
        end if;
        if not (v_opts ? v_correct) or v_correct not in ('A', 'B', 'C', 'D') then raise exception 'INVALID: question % has no valid correct option', v_pos; end if;
      elsif v_type = 'true_false' then
        v_opts := '{"A":"True","B":"False"}'::jsonb;
        v_correct := upper(coalesce(it ->> 'correct_answer', ''));
        if v_correct not in ('A', 'B') then raise exception 'INVALID: question % must be True (A) or False (B)', v_pos; end if;
      elsif v_type = 'short_answer' then
        v_accepted := coalesce(it -> 'accepted_answers', '[]'::jsonb);
        if jsonb_typeof(v_accepted) <> 'array' or jsonb_array_length(v_accepted) = 0 then raise exception 'INVALID: question % needs at least one accepted answer', v_pos; end if;
      elsif v_type = 'numeric' then
        if nullif(it ->> 'numeric_answer', '') is null then raise exception 'INVALID: question % needs a numeric answer', v_pos; end if;
      end if;
      insert into public.dpp_items (set_id, position, question_type, stem, options, correct_answer, accepted_answers, numeric_answer, tolerance,
                                    explanation, marks, difficulty, bank_item_id, learning_objective_id, subtopic_id, chapter)
      values (v_id, v_pos, v_type, left(btrim(it ->> 'stem'), 2000), v_opts, v_correct, v_accepted,
              nullif(it ->> 'numeric_answer', '')::numeric, coalesce(nullif(it ->> 'tolerance', '')::numeric, 0),
              nullif(btrim(coalesce(it ->> 'explanation', '')), ''), v_marks, v_idifficulty,
              nullif(it ->> 'bank_item_id', '')::uuid, nullif(it ->> 'learning_objective_id', '')::bigint,
              nullif(it ->> 'subtopic_id', '')::bigint, nullif(btrim(coalesce(it ->> 'chapter', '')), ''));
    end loop;
  end if;
  return v_id;
end $$;

create or replace function public.dpp_archive_set(p_set uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.dpp_can_manage_set(p_set) then raise exception 'FORBIDDEN'; end if;
  update public.dpp_sets set status = 'archived', updated_at = now() where id = p_set;
end $$;

-- Publishes the set and creates an assignment for each target student (a class/section, or specific students).
create or replace function public.dpp_assign_set(p_set uuid, p_class_level text default null, p_section text default null,
                                                  p_student_ids uuid[] default null, p_assigned_for date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_school uuid := public.dpp_my_school(); v_set public.dpp_sets%rowtype; v_today date;
        v_for date; v_assigned int := 0; v_targets int := 0; v_ids uuid[];
begin
  if v_uid is null or not public.dpp_can_manage_set(p_set) then raise exception 'FORBIDDEN'; end if;
  select * into v_set from public.dpp_sets where id = p_set;
  if v_set.status = 'archived' then raise exception 'INVALID: this set is archived'; end if;
  if v_set.source = 'auto' then raise exception 'INVALID: automatic sets cannot be assigned'; end if;
  if not exists (select 1 from public.dpp_items where set_id = p_set) then raise exception 'INVALID: add questions before assigning'; end if;
  v_today := public.dpp_today(v_school);
  v_for := coalesce(p_assigned_for, v_today);
  if v_for < v_today or v_for > v_today + 60 then raise exception 'INVALID: choose a date from today up to 60 days ahead'; end if;

  if p_student_ids is not null and cardinality(p_student_ids) > 0 then
    select array_agg(id) into v_ids from public.profiles where id = any (p_student_ids) and role = 'student' and school_id = v_school;
  elsif nullif(btrim(p_class_level), '') is not null then
    select array_agg(id) into v_ids from public.profiles
     where role = 'student' and school_id = v_school and public.dpp_class_key(class_grade) = public.dpp_class_key(p_class_level)
       and (nullif(btrim(p_section), '') is null or lower(btrim(coalesce(section, ''))) = lower(btrim(p_section)));
  else
    raise exception 'INVALID: choose a class or students';
  end if;
  v_targets := coalesce(cardinality(v_ids), 0);
  if v_targets = 0 then raise exception 'INVALID: no students found for that selection'; end if;

  update public.dpp_sets set status = 'published', updated_at = now() where id = p_set and status = 'draft';
  insert into public.dpp_assignments (set_id, school_id, student_id, assigned_for, source, assigned_by)
  select p_set, v_school, s, v_for, 'teacher', v_uid from unnest(v_ids) s on conflict (set_id, student_id) do nothing;
  get diagnostics v_assigned = row_count;

  begin
    if v_assigned > 0 and v_for <= v_today and to_regclass('public.governance_notifications') is not null then
      insert into public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
      select a.student_id, 'dpp_assigned', 'New Daily Practice', '"' || v_set.title || '" (' || v_set.subject || ') is ready.', a.id, 'dpp_assignment'
        from public.dpp_assignments a where a.set_id = p_set and a.assigned_for = v_for and a.created_at >= now() - interval '5 seconds';
    end if;
  exception when others then
    raise warning 'dpp notification skipped: %', sqlerrm;
  end;
  return jsonb_build_object('assigned', v_assigned, 'already_assigned', v_targets - v_assigned, 'assigned_for', v_for);
end $$;

create or replace function public.dpp_teacher_overview(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_school uuid := public.dpp_my_school(); v_since timestamptz; v_admin boolean := public.dpp_is_admin_role();
begin
  if not public.dpp_is_staff() then raise exception 'FORBIDDEN'; end if;
  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  return jsonb_build_object(
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
          'set_id', s.id, 'title', s.title, 'subject', s.subject, 'class_level', s.class_level, 'difficulty', s.difficulty,
          'status', s.status, 'time_limit_minutes', s.time_limit_minutes, 'created_at', s.created_at,
          'questions', (select count(*) from public.dpp_items i where i.set_id = s.id),
          'assigned', (select count(*) from public.dpp_assignments a where a.set_id = s.id),
          'started', (select count(*) from public.dpp_attempts t where t.set_id = s.id),
          'submitted', (select count(*) from public.dpp_attempts t where t.set_id = s.id and t.status = 'submitted'),
          'avg_percent', (select round(avg(t.percent), 1) from public.dpp_attempts t where t.set_id = s.id and t.status = 'submitted'),
          'pending_manual', (select coalesce(sum(t.pending_manual_count), 0) from public.dpp_attempts t where t.set_id = s.id and t.status = 'submitted')
        ) order by s.created_at desc)
        from (select * from public.dpp_sets where school_id = v_school and source = 'teacher' and status <> 'archived'
                 and (v_admin or created_by = v_uid) order by created_at desc limit 60) s), '[]'::jsonb),
    'weak_students', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', student_id, 'name', name, 'class', cls, 'attempts', n, 'avg_percent', avg_p) order by avg_p)
        from (select t.student_id, p.full_name as name, trim(coalesce(p.class_grade, '') || ' ' || coalesce(p.section, '')) as cls,
                     count(*) as n, round(avg(t.percent), 1) as avg_p
                from public.dpp_attempts t join public.dpp_sets s on s.id = t.set_id join public.profiles p on p.id = t.student_id
               where t.status = 'submitted' and t.submitted_at >= v_since and s.school_id = v_school and s.source = 'teacher'
                 and (v_admin or s.created_by = v_uid)
               group by t.student_id, p.full_name, p.class_grade, p.section having avg(t.percent) < 50
               order by avg(t.percent) limit 15) w), '[]'::jsonb),
    'difficult_questions', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', item_id, 'stem', left(stem, 140), 'set_title', title, 'answered', n, 'correct_percent', pct) order by pct)
        from (select i.id as item_id, i.stem, s.title, count(*) as n, round(100.0 * count(*) filter (where a.is_correct) / count(*), 1) as pct
                from public.dpp_answers a join public.dpp_attempts t on t.id = a.attempt_id and t.status = 'submitted'
                join public.dpp_items i on i.id = a.item_id join public.dpp_sets s on s.id = i.set_id
               where s.school_id = v_school and s.source = 'teacher' and (v_admin or s.created_by = v_uid) and t.submitted_at >= v_since
                 and a.is_correct is not null
               group by i.id, i.stem, s.title having count(*) >= 3 and 100.0 * count(*) filter (where a.is_correct) / count(*) < 40
               order by 5 limit 15) d), '[]'::jsonb),
    'pending_manual', (select coalesce(sum(t.pending_manual_count), 0) from public.dpp_attempts t join public.dpp_sets s on s.id = t.set_id
                        where t.status = 'submitted' and s.school_id = v_school and s.source = 'teacher' and (v_admin or s.created_by = v_uid)));
end $$;

create or replace function public.dpp_set_detail(p_set uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_set public.dpp_sets%rowtype;
begin
  if not public.dpp_can_manage_set(p_set) then raise exception 'FORBIDDEN'; end if;
  select * into v_set from public.dpp_sets where id = p_set;
  return jsonb_build_object(
    'set', to_jsonb(v_set) - 'student_id',
    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'created_at' order by i.position) from public.dpp_items i where i.set_id = p_set), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', a.student_id, 'name', p.full_name,
               'class', trim(coalesce(p.class_grade, '') || ' ' || coalesce(p.section, '')), 'assigned_for', a.assigned_for,
               'status', case when t.status = 'submitted' then 'submitted' when t.id is not null then 'in_progress' else 'not_started' end,
               'attempt_id', t.id, 'percent', t.percent, 'score', t.score, 'max_score', t.max_score,
               'time_taken_seconds', t.time_taken_seconds, 'submitted_at', t.submitted_at, 'pending_manual', coalesce(t.pending_manual_count, 0))
             order by p.full_name)
        from public.dpp_assignments a join public.profiles p on p.id = a.student_id
        left join public.dpp_attempts t on t.assignment_id = a.id where a.set_id = p_set), '[]'::jsonb),
    'question_stats', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', q.item_id, 'position', q.position, 'answered', q.answered, 'correct', q.correct,
               'correct_percent', round(100.0 * q.correct / nullif(q.graded, 0), 1)) order by q.position)
        from (
          select i.id as item_id, i.position,
                 count(a.id) filter (where btrim(coalesce(a.answer, '')) <> '') as answered,
                 count(a.id) filter (where a.is_correct) as correct,
                 count(a.id) filter (where a.is_correct is not null) as graded
            from public.dpp_items i
            left join public.dpp_answers a on a.item_id = i.id
                 and exists (select 1 from public.dpp_attempts t where t.id = a.attempt_id and t.status = 'submitted')
           where i.set_id = p_set group by i.id, i.position) q), '[]'::jsonb));
end $$;

-- Open-ended answers waiting for a teacher mark.
create or replace function public.dpp_pending_manual() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_school uuid := public.dpp_my_school(); v_admin boolean := public.dpp_is_admin_role();
begin
  if not public.dpp_is_staff() then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('answer_id', a.id, 'attempt_id', t.id, 'student', p.full_name, 'set_title', s.title, 'stem', i.stem,
             'answer', a.answer, 'marks', i.marks, 'explanation', i.explanation, 'submitted_at', t.submitted_at) order by t.submitted_at)
      from public.dpp_answers a join public.dpp_attempts t on t.id = a.attempt_id and t.status = 'submitted'
      join public.dpp_items i on i.id = a.item_id join public.dpp_sets s on s.id = i.set_id join public.profiles p on p.id = t.student_id
     where s.school_id = v_school and (v_admin or s.created_by = v_uid)
       and i.question_type = 'open_ended' and a.is_correct is null and btrim(coalesce(a.answer, '')) <> ''), '[]'::jsonb);
end $$;

create or replace function public.dpp_grade_answer(p_answer uuid, p_marks numeric, p_feedback text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_a public.dpp_answers%rowtype; v_i public.dpp_items%rowtype; v_set uuid; v_att uuid;
begin
  select * into v_a from public.dpp_answers where id = p_answer;
  if not found then raise exception 'ANSWER_NOT_FOUND'; end if;
  select * into v_i from public.dpp_items where id = v_a.item_id;
  v_set := v_i.set_id; v_att := v_a.attempt_id;
  if not public.dpp_can_manage_set(v_set) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.dpp_attempts where id = v_att and status = 'submitted') then raise exception 'NOT_SUBMITTED'; end if;
  if v_i.question_type <> 'open_ended' then raise exception 'INVALID: only open-ended answers are marked by hand'; end if;
  if p_marks is null or p_marks < 0 or p_marks > v_i.marks then raise exception 'INVALID: marks must be between 0 and %', v_i.marks; end if;
  update public.dpp_answers
     set marks_awarded = p_marks, is_correct = (p_marks >= v_i.marks), graded_by = 'teacher',
         teacher_feedback = left(nullif(btrim(coalesce(p_feedback, '')), ''), 1000), updated_at = now()
   where id = p_answer;
  perform public.dpp_recompute_attempt(v_att);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Parent and admin views
-- ---------------------------------------------------------------------------
create or replace function public.dpp_parent_overview(p_child uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_school uuid; v_today date; v_name text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from public.parent_students ps where ps.parent_id = v_uid and ps.student_id = p_child) then
    raise exception 'FORBIDDEN: this child is not linked to your account';
  end if;
  select school_id, full_name into v_school, v_name from public.profiles where id = p_child;
  v_today := public.dpp_today(v_school);
  return public.dpp_summary_json(p_child) || jsonb_build_object(
    'child_name', v_name, 'today', v_today,
    'assigned', coalesce((
      select jsonb_agg(jsonb_build_object('title', s.title, 'subject', s.subject, 'assigned_for', a.assigned_for,
               'questions', (select count(*) from public.dpp_items i where i.set_id = s.id),
               'status', case when t.status = 'submitted' then 'submitted' when t.id is not null then 'in_progress' else 'pending' end,
               'percent', t.percent, 'submitted_at', t.submitted_at) order by a.assigned_for desc)
        from public.dpp_assignments a join public.dpp_sets s on s.id = a.set_id and s.status = 'published'
        left join public.dpp_attempts t on t.assignment_id = a.id
       where a.student_id = p_child and a.assigned_for <= v_today and a.assigned_for >= v_today - 14), '[]'::jsonb),
    'pending_count', (select count(*) from public.dpp_assignments a join public.dpp_sets s on s.id = a.set_id and s.status = 'published'
                       left join public.dpp_attempts t on t.assignment_id = a.id
                       where a.student_id = p_child and a.assigned_for <= v_today and t.status is distinct from 'submitted'));
end $$;

create or replace function public.dpp_admin_overview(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.dpp_my_school(); v_days int := greatest(1, least(coalesce(p_days, 30), 60)); v_today date; v_tz text; v_since date;
begin
  if not public.dpp_is_admin_role() then raise exception 'FORBIDDEN'; end if;
  v_today := public.dpp_today(v_school);
  v_tz := coalesce((select timezone from public.dpp_school_settings where school_id = v_school), 'Asia/Kolkata');
  v_since := v_today - (v_days - 1);
  return jsonb_build_object(
    'today', v_today, 'days', v_days,
    'totals', jsonb_build_object(
      'students', (select count(*) from public.profiles where school_id = v_school and role = 'student'),
      'participants', (select count(distinct t.student_id) from public.dpp_attempts t
                        where t.school_id = v_school and t.status = 'submitted' and (t.submitted_at at time zone v_tz)::date >= v_since),
      'assigned', (select count(*) from public.dpp_assignments a where a.school_id = v_school and a.assigned_for between v_since and v_today),
      'submitted', (select count(*) from public.dpp_attempts t where t.school_id = v_school and t.status = 'submitted' and (t.submitted_at at time zone v_tz)::date >= v_since),
      'avg_percent', (select round(avg(t.percent), 1) from public.dpp_attempts t where t.school_id = v_school and t.status = 'submitted' and (t.submitted_at at time zone v_tz)::date >= v_since),
      'pending', (select count(*) from public.dpp_assignments a join public.dpp_sets s on s.id = a.set_id and s.status = 'published'
                   left join public.dpp_attempts t on t.assignment_id = a.id
                  where a.school_id = v_school and a.assigned_for <= v_today and t.status is distinct from 'submitted')),
    'by_class', coalesce((
      select jsonb_agg(jsonb_build_object('class', cls, 'assigned', assigned, 'submitted', submitted,
               'completion', round(100.0 * submitted / nullif(assigned, 0), 1), 'avg_percent', avg_p) order by cls)
        from (select trim(coalesce(p.class_grade, 'Unassigned') || ' ' || coalesce(p.section, '')) as cls,
                     count(*) as assigned, count(t.id) filter (where t.status = 'submitted') as submitted,
                     round(avg(t.percent) filter (where t.status = 'submitted'), 1) as avg_p
                from public.dpp_assignments a join public.profiles p on p.id = a.student_id left join public.dpp_attempts t on t.assignment_id = a.id
               where a.school_id = v_school and a.assigned_for between v_since and v_today group by 1) c), '[]'::jsonb),
    'by_subject', coalesce((
      select jsonb_agg(jsonb_build_object('subject', subject, 'attempts', n, 'avg_percent', avg_p, 'answers', answered, 'weak', (answered >= 10 and avg_p < 50)) order by avg_p)
        from (select s.subject, count(distinct t.id) as n, round(avg(t.percent), 1) as avg_p,
                     (select count(*) from public.dpp_answers a join public.dpp_items i on i.id = a.item_id join public.dpp_sets s2 on s2.id = i.set_id
                       join public.dpp_attempts t2 on t2.id = a.attempt_id and t2.status = 'submitted'
                       where s2.subject = s.subject and s2.school_id = v_school and (t2.submitted_at at time zone v_tz)::date >= v_since
                         and btrim(coalesce(a.answer, '')) <> '') as answered
                from public.dpp_attempts t join public.dpp_sets s on s.id = t.set_id
               where t.school_id = v_school and t.status = 'submitted' and (t.submitted_at at time zone v_tz)::date >= v_since
               group by s.subject) q), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'assigned', (select count(*) from public.dpp_assignments a where a.school_id = v_school and a.assigned_for = d),
               'submitted', (select count(*) from public.dpp_attempts t where t.school_id = v_school and t.status = 'submitted' and (t.submitted_at at time zone v_tz)::date = d),
               'avg_percent', (select round(avg(t.percent), 1) from public.dpp_attempts t where t.school_id = v_school and t.status = 'submitted' and (t.submitted_at at time zone v_tz)::date = d))
             order by d)
        from (select g::date as d from generate_series(v_since, v_today, interval '1 day') g) days), '[]'::jsonb),
    'teachers', coalesce((
      select jsonb_agg(jsonb_build_object('teacher_id', u.created_by, 'name', p.full_name, 'sets', u.sets, 'assignments', u.assignments, 'submissions', u.submissions) order by u.sets desc)
        from (select s.created_by, count(distinct s.id) as sets,
                     count(a.id) as assignments, count(t.id) filter (where t.status = 'submitted') as submissions
                from public.dpp_sets s left join public.dpp_assignments a on a.set_id = s.id and a.assigned_for >= v_since
                left join public.dpp_attempts t on t.assignment_id = a.id
               where s.school_id = v_school and s.source = 'teacher' and s.created_at >= v_since::timestamptz - interval '1 day' group by s.created_by) u
        left join public.profiles p on p.id = u.created_by), '[]'::jsonb));
end $$;

create or replace function public.dpp_get_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.dpp_my_school();
begin
  if not public.dpp_is_staff() then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_build_object('timezone', timezone, 'auto_assign', auto_assign, 'daily_question_count', daily_question_count)
                     from public.dpp_school_settings where school_id = v_school),
                  jsonb_build_object('timezone', 'Asia/Kolkata', 'auto_assign', true, 'daily_question_count', 10));
end $$;

create or replace function public.dpp_save_settings(p_timezone text, p_auto_assign boolean, p_count int) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.dpp_my_school();
begin
  if not public.dpp_is_admin_role() then raise exception 'FORBIDDEN'; end if;
  if v_school is null then raise exception 'NO_SCHOOL'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then raise exception 'INVALID: unknown time zone'; end if;
  if p_count is null or p_count < 3 or p_count > 30 then raise exception 'INVALID: questions per day must be 3-30'; end if;
  insert into public.dpp_school_settings (school_id, timezone, auto_assign, daily_question_count, updated_by, updated_at)
  values (v_school, p_timezone, coalesce(p_auto_assign, true), p_count, auth.uid(), now())
  on conflict (school_id) do update
    set timezone = excluded.timezone, auto_assign = excluded.auto_assign, daily_question_count = excluded.daily_question_count,
        updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants: browser-callable functions only; internal ones stay private
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'dpp\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname in ('dpp_student_today', 'dpp_start_attempt', 'dpp_save_answer', 'dpp_submit_attempt', 'dpp_get_result',
                     'dpp_student_stats', 'dpp_history', 'dpp_recommendations', 'dpp_staff_options', 'dpp_pick_bank_items',
                     'dpp_save_set', 'dpp_archive_set', 'dpp_assign_set', 'dpp_teacher_overview', 'dpp_set_detail',
                     'dpp_pending_manual', 'dpp_grade_answer', 'dpp_parent_overview', 'dpp_admin_overview',
                     'dpp_get_settings', 'dpp_save_settings') then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    elsif f.proname in ('dpp_is_assigned', 'dpp_set_visible_to_staff', 'dpp_my_school', 'dpp_my_role', 'dpp_is_admin_role', 'dpp_is_staff') then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);   -- used inside RLS policies; only reveal the caller's own context
    elsif f.proname = 'dpp_tutor_context' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);   -- guards itself: caller must be p_student
    else
      execute format('grant execute on function %s to service_role', f.sig);   -- helpers used inside the functions above
    end if;
  end loop;
end $$;

grant select on public.dpp_school_settings, public.dpp_sets, public.dpp_items, public.dpp_assignments,
  public.dpp_attempts, public.dpp_answers, public.dpp_streaks to authenticated;
