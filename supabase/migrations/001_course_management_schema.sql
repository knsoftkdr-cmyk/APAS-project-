-- ============================================================================
-- Adds: mentor_id on courses, content_body/content_url on course_modules,
-- course_topics table (Modules -> Topics), and student_topic_progress.
-- Builds on top of 001_course_management_schema.sql
-- ============================================================================

-- 1. Mentor field on courses
alter table courses
  add column if not exists mentor_id uuid references profiles(id);

create index if not exists idx_courses_mentor on courses(mentor_id);

-- 2. Rich content fields on course_modules (module-level overview/attachment)
alter table course_modules
  add column if not exists content_body text,
  add column if not exists content_url text;

-- Note: course_modules already had content_url in 001 for some rows/environments;
-- "add column if not exists" makes this safe to re-run.

-- 3. Course topics (the layer under modules: each tagged learn/practice)
create table if not exists course_topics (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references course_modules(id) on delete cascade,
  title text not null,
  topic_type text not null default 'learn' check (topic_type in ('learn','practice')),
  content_body text,
  content_url text,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_course_topics_module on course_topics(module_id, order_index);

alter table course_topics enable row level security;

create policy if not exists "students_view_topics" on course_topics
  for select
  using (
    exists (
      select 1
      from course_modules cm
      join courses c on c.id = cm.course_id
      where cm.id = course_topics.module_id
        and c.status = 'published'
        and c.school_id = (select school_id from profiles where id = auth.uid())
    )
  );

create policy if not exists "staff_manage_topics" on course_topics
  for all
  using (get_user_role(auth.uid()) in ('teacher','admin','principal'))
  with check (get_user_role(auth.uid()) in ('teacher','admin','principal'));

-- 4. Student topic progress (per-topic completion, feeding module/course progress)
create table if not exists student_topic_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references course_topics(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  unique(student_id, topic_id)
);

alter table student_topic_progress enable row level security;

create policy if not exists "students_view_own_topic_progress" on student_topic_progress
  for select using (student_id = auth.uid());

create policy if not exists "students_upsert_own_topic_progress" on student_topic_progress
  for insert with check (student_id = auth.uid());

create policy if not exists "students_update_own_topic_progress" on student_topic_progress
  for update using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy if not exists "staff_view_all_topic_progress" on student_topic_progress
  for select
  using (get_user_role(auth.uid()) in ('teacher','admin','principal'));