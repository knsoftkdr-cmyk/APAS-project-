-- ============================================================================
-- Multi-Level Course Structure
--   Academic Session -> Semester -> Subject(course) -> Module -> Chapter -> Topic -> Materials
--
-- ADDITIVE ONLY. It extends the existing course layer (courses, course_modules,
-- course_topics, student_topic_progress, student_module_progress,
-- student_course_progress) and re-uses academic_years / semesters. Nothing is
-- dropped except two permissive RLS policies on course_topics that are replaced
-- by school-scoped versions (see section 3).
--
-- Backward compatibility: every new `status` column defaults to 'published' so
-- all existing modules / topics stay visible to students exactly as before.
-- Content created through the new manager is created as 'draft'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper functions (SECURITY DEFINER so RLS on profiles/courses can't recurse)
-- ---------------------------------------------------------------------------
create or replace function public.mlcs_my_school()
returns uuid language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function public.mlcs_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.mlcs_course_of_module(p_module uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select course_id from public.course_modules where id = p_module
$$;

create or replace function public.mlcs_course_of_topic(p_topic uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.course_id from public.course_topics t
  join public.course_modules m on m.id = t.module_id where t.id = p_topic
$$;

-- Staff who may edit a subject's content: admins / principals / HODs / school admins of the
-- same school, and teachers who created or mentor that subject.
create or replace function public.mlcs_can_manage_course(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.courses c
    join public.profiles p on p.id = auth.uid()
    where c.id = p_course
      and p.school_id is not distinct from c.school_id
      and (
        p.role in ('admin', 'principal', 'school_admin', 'hod')
        or (p.role = 'teacher' and (c.created_by = p.id or c.mentor_id = p.id))
      )
  )
$$;

-- Students (and any signed-in user of the same school) may read published subjects.
create or replace function public.mlcs_can_view_course(p_course uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mlcs_can_manage_course(p_course) or exists (
    select 1 from public.courses c
    where c.id = p_course and c.status = 'published'
      and c.school_id is not distinct from public.mlcs_my_school()
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. Extend existing tables
-- ---------------------------------------------------------------------------
-- 1a. courses (= Subject offering): link to academic session + semester, path mode
alter table public.courses add column if not exists academic_year_id uuid;
alter table public.courses add column if not exists semester_id uuid;
alter table public.courses add column if not exists learning_path_mode text not null default 'flexible';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courses_learning_path_mode_check') then
    alter table public.courses add constraint courses_learning_path_mode_check
      check (learning_path_mode in ('flexible', 'sequential'));
  end if;
  if to_regclass('public.academic_years') is not null
     and not exists (select 1 from pg_constraint where conname = 'courses_academic_year_fk') then
    alter table public.courses add constraint courses_academic_year_fk
      foreign key (academic_year_id) references public.academic_years(id) on delete set null;
  end if;
  if to_regclass('public.academic_semesters') is not null
     and not exists (select 1 from pg_constraint where conname = 'courses_semester_fk') then
    alter table public.courses add constraint courses_semester_fk
      foreign key (semester_id) references public.academic_semesters(id) on delete set null;
  end if;
end $$;
create index if not exists idx_courses_academic_year on public.courses(academic_year_id);
create index if not exists idx_courses_semester on public.courses(semester_id);
create index if not exists idx_courses_school_status on public.courses(school_id, status);

-- 1b. course_modules: publish status
alter table public.course_modules add column if not exists status text not null default 'published';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'course_modules_status_check') then
    alter table public.course_modules add constraint course_modules_status_check
      check (status in ('draft', 'published', 'archived'));
  end if;
end $$;

-- 1c. chapters (new layer between module and topic)
create table if not exists public.course_chapters (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  title text not null,
  description text,
  order_index int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_course_chapters_module on public.course_chapters(module_id, order_index);

-- 1d. course_topics: chapter link + richer metadata. chapter_id is NULLABLE so
-- existing Module -> Topic rows keep working unchanged.
alter table public.course_topics add column if not exists chapter_id uuid references public.course_chapters(id) on delete set null;
alter table public.course_topics add column if not exists description text;
alter table public.course_topics add column if not exists learning_objectives text;
alter table public.course_topics add column if not exists estimated_minutes int;
alter table public.course_topics add column if not exists status text not null default 'published';
alter table public.course_topics add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'course_topics_status_check') then
    alter table public.course_topics add constraint course_topics_status_check
      check (status in ('draft', 'published', 'archived'));
  end if;
end $$;
create index if not exists idx_course_topics_chapter on public.course_topics(chapter_id, order_index);

-- A topic's chapter must belong to the same module.
create or replace function public.mlcs_topic_chapter_guard()
returns trigger language plpgsql as $$
begin
  if new.chapter_id is not null and not exists (
    select 1 from public.course_chapters ch where ch.id = new.chapter_id and ch.module_id = new.module_id
  ) then
    raise exception 'CHAPTER_MODULE_MISMATCH: the chapter does not belong to the topic''s module';
  end if;
  return new;
end $$;
drop trigger if exists trg_mlcs_topic_chapter_guard on public.course_topics;
create trigger trg_mlcs_topic_chapter_guard before insert or update of chapter_id, module_id
  on public.course_topics for each row execute function public.mlcs_topic_chapter_guard();

-- 1e. student_topic_progress: learning-time + last position
alter table public.student_topic_progress add column if not exists time_spent_seconds int not null default 0;
alter table public.student_topic_progress add column if not exists started_at timestamptz;
alter table public.student_topic_progress add column if not exists last_accessed_at timestamptz;
create index if not exists idx_stp_student_last on public.student_topic_progress(student_id, last_accessed_at desc);

-- ---------------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------------
-- 2a. learning materials attached to a topic (PDF / PPT / video / notes ...)
create table if not exists public.topic_materials (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.course_topics(id) on delete cascade,
  title text not null,
  material_type text not null default 'document'
    check (material_type in ('pdf', 'ppt', 'document', 'video', 'image', 'notes', 'link')),
  file_url text,              -- external link / video URL
  storage_path text,          -- path inside the private `course-materials` bucket
  file_name text,
  file_size bigint,
  mime_type text,
  content_body text,          -- inline notes (plain text / markdown)
  order_index int not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_materials_has_content check (
    file_url is not null or storage_path is not null or content_body is not null
  )
);
create index if not exists idx_topic_materials_topic on public.topic_materials(topic_id, order_index);

-- 2b. topic prerequisites (topic A requires topic B)
create table if not exists public.course_topic_prerequisites (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.course_topics(id) on delete cascade,
  prerequisite_topic_id uuid not null references public.course_topics(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (topic_id, prerequisite_topic_id),
  constraint topic_prereq_not_self check (topic_id <> prerequisite_topic_id)
);
create index if not exists idx_ctp_topic on public.course_topic_prerequisites(topic_id);
create index if not exists idx_ctp_prereq on public.course_topic_prerequisites(prerequisite_topic_id);

-- Prerequisites must stay inside one subject and may never form a cycle.
create or replace function public.mlcs_topic_prereq_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.mlcs_course_of_topic(new.topic_id) is distinct from public.mlcs_course_of_topic(new.prerequisite_topic_id) then
    raise exception 'PREREQ_CROSS_COURSE: prerequisites must belong to the same subject';
  end if;
  -- adding edge topic -> prerequisite is circular if topic is already reachable from prerequisite
  if exists (
    with recursive reach(id) as (
      select new.prerequisite_topic_id
      union
      select p.prerequisite_topic_id from public.course_topic_prerequisites p join reach r on p.topic_id = r.id
    )
    select 1 from reach where id = new.topic_id
  ) then
    raise exception 'PREREQ_CYCLE: this prerequisite would create a circular dependency';
  end if;
  return new;
end $$;
drop trigger if exists trg_mlcs_topic_prereq_guard on public.course_topic_prerequisites;
create trigger trg_mlcs_topic_prereq_guard before insert or update
  on public.course_topic_prerequisites for each row execute function public.mlcs_topic_prereq_guard();

-- 2c. existing homework / worksheets / assessment papers attached to a topic
create table if not exists public.topic_assessment_links (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.course_topics(id) on delete cascade,
  link_type text not null check (link_type in ('homework', 'worksheet', 'assessment')),
  ref_id uuid not null,
  title text,
  due_date timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (topic_id, link_type, ref_id)
);
create index if not exists idx_topic_links_topic on public.topic_assessment_links(topic_id);

-- 2d. per-material learning progress
create table if not exists public.student_material_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid not null references public.topic_materials(id) on delete cascade,
  completed boolean not null default false,
  progress_percent int not null default 0 check (progress_percent between 0 and 100),
  time_spent_seconds int not null default 0,
  last_accessed_at timestamptz not null default now(),
  unique (student_id, material_id)
);
create index if not exists idx_smp_student on public.student_material_progress(student_id);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.course_chapters enable row level security;
alter table public.topic_materials enable row level security;
alter table public.course_topic_prerequisites enable row level security;
alter table public.topic_assessment_links enable row level security;
alter table public.student_material_progress enable row level security;

-- 3a. courses / course_modules: ADDITIVE policies only (existing ones stay untouched).
drop policy if exists mlcs_courses_staff_select on public.courses;
create policy mlcs_courses_staff_select on public.courses for select to authenticated
  using (public.mlcs_can_manage_course(id));

drop policy if exists mlcs_courses_staff_insert on public.courses;
create policy mlcs_courses_staff_insert on public.courses for insert to authenticated
  with check (
    school_id is not distinct from public.mlcs_my_school()
    and public.mlcs_my_role() in ('admin', 'principal', 'school_admin', 'hod', 'teacher')
    and (public.mlcs_my_role() <> 'teacher' or created_by = auth.uid())
  );

drop policy if exists mlcs_courses_staff_update on public.courses;
create policy mlcs_courses_staff_update on public.courses for update to authenticated
  using (public.mlcs_can_manage_course(id))
  with check (school_id is not distinct from public.mlcs_my_school());

drop policy if exists mlcs_courses_staff_delete on public.courses;
create policy mlcs_courses_staff_delete on public.courses for delete to authenticated
  using (public.mlcs_can_manage_course(id) and public.mlcs_my_role() in ('admin', 'principal', 'school_admin', 'hod'));

drop policy if exists mlcs_modules_staff_all on public.course_modules;
create policy mlcs_modules_staff_all on public.course_modules for all to authenticated
  using (public.mlcs_can_manage_course(course_id))
  with check (public.mlcs_can_manage_course(course_id));

-- 3b. course_topics: replace the two cross-school, status-blind policies from 001.
drop policy if exists "students_view_topics" on public.course_topics;
drop policy if exists "staff_manage_topics" on public.course_topics;
drop policy if exists mlcs_topics_student_select on public.course_topics;
drop policy if exists mlcs_topics_staff_all on public.course_topics;

drop policy if exists mlcs_topics_student_select on public.course_topics;
create policy mlcs_topics_student_select on public.course_topics for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.course_modules m
      join public.courses c on c.id = m.course_id
      where m.id = course_topics.module_id and m.status = 'published'
        and c.status = 'published' and c.school_id is not distinct from public.mlcs_my_school()
    )
    and (
      chapter_id is null
      or exists (select 1 from public.course_chapters ch where ch.id = course_topics.chapter_id and ch.status = 'published')
    )
  );
drop policy if exists mlcs_topics_staff_all on public.course_topics;
create policy mlcs_topics_staff_all on public.course_topics for all to authenticated
  using (public.mlcs_can_manage_course(public.mlcs_course_of_module(module_id)))
  with check (public.mlcs_can_manage_course(public.mlcs_course_of_module(module_id)));

-- 3c. chapters
drop policy if exists mlcs_chapters_student_select on public.course_chapters;
create policy mlcs_chapters_student_select on public.course_chapters for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.course_modules m
      join public.courses c on c.id = m.course_id
      where m.id = course_chapters.module_id and m.status = 'published'
        and c.status = 'published' and c.school_id is not distinct from public.mlcs_my_school()
    )
  );
drop policy if exists mlcs_chapters_staff_all on public.course_chapters;
create policy mlcs_chapters_staff_all on public.course_chapters for all to authenticated
  using (public.mlcs_can_manage_course(public.mlcs_course_of_module(module_id)))
  with check (public.mlcs_can_manage_course(public.mlcs_course_of_module(module_id)));

-- 3d. materials
drop policy if exists mlcs_materials_student_select on public.topic_materials;
create policy mlcs_materials_student_select on public.topic_materials for select to authenticated
  using (
    status = 'published'
    and exists (select 1 from public.course_topics t where t.id = topic_materials.topic_id)  -- re-uses topic RLS
  );
drop policy if exists mlcs_materials_staff_all on public.topic_materials;
create policy mlcs_materials_staff_all on public.topic_materials for all to authenticated
  using (public.mlcs_can_manage_course(public.mlcs_course_of_topic(topic_id)))
  with check (public.mlcs_can_manage_course(public.mlcs_course_of_topic(topic_id)));

-- 3e. prerequisites + assessment links (readable wherever the topic is readable)
drop policy if exists mlcs_prereq_select on public.course_topic_prerequisites;
create policy mlcs_prereq_select on public.course_topic_prerequisites for select to authenticated
  using (exists (select 1 from public.course_topics t where t.id = course_topic_prerequisites.topic_id));
drop policy if exists mlcs_prereq_staff_all on public.course_topic_prerequisites;
create policy mlcs_prereq_staff_all on public.course_topic_prerequisites for all to authenticated
  using (public.mlcs_can_manage_course(public.mlcs_course_of_topic(topic_id)))
  with check (public.mlcs_can_manage_course(public.mlcs_course_of_topic(topic_id)));

drop policy if exists mlcs_links_select on public.topic_assessment_links;
create policy mlcs_links_select on public.topic_assessment_links for select to authenticated
  using (exists (select 1 from public.course_topics t where t.id = topic_assessment_links.topic_id));
drop policy if exists mlcs_links_staff_all on public.topic_assessment_links;
create policy mlcs_links_staff_all on public.topic_assessment_links for all to authenticated
  using (public.mlcs_can_manage_course(public.mlcs_course_of_topic(topic_id)))
  with check (public.mlcs_can_manage_course(public.mlcs_course_of_topic(topic_id)));

-- 3f. material progress
drop policy if exists mlcs_smp_student_own on public.student_material_progress;
create policy mlcs_smp_student_own on public.student_material_progress for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists mlcs_smp_staff_select on public.student_material_progress;
create policy mlcs_smp_staff_select on public.student_material_progress for select to authenticated
  using (exists (
    select 1 from public.topic_materials mt
    where mt.id = student_material_progress.material_id
      and public.mlcs_can_manage_course(public.mlcs_course_of_topic(mt.topic_id))
  ));

-- 3g. topic progress: teachers of THIS subject (not any teacher) may read it.
drop policy if exists mlcs_stp_staff_select on public.student_topic_progress;
create policy mlcs_stp_staff_select on public.student_topic_progress for select to authenticated
  using (public.mlcs_can_manage_course(public.mlcs_course_of_topic(topic_id)));

-- ---------------------------------------------------------------------------
-- 4. Learning-path engine
-- ---------------------------------------------------------------------------
-- One row per PUBLISHED topic of a subject, with the student's state and why it is locked.
create or replace function public.mlcs_topic_states(p_student uuid, p_course uuid)
returns table (
  topic_id uuid, module_id uuid, chapter_id uuid, seq int,
  completed boolean, started boolean, locked boolean,
  missing jsonb, time_spent_seconds int, last_accessed_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with ordered as (
    select t.id as topic_id, t.module_id, t.chapter_id,
           row_number() over (order by m.order_index, m.created_at, coalesce(ch.order_index, -1), ch.created_at nulls first, t.order_index, t.created_at)::int as seq
    from public.course_topics t
    join public.course_modules m on m.id = t.module_id
    left join public.course_chapters ch on ch.id = t.chapter_id
    where m.course_id = p_course and m.status = 'published' and t.status = 'published'
      and (t.chapter_id is null or ch.status = 'published')
  ), mode as (
    select learning_path_mode from public.courses where id = p_course
  ), prog as (
    select * from public.student_topic_progress where student_id = p_student
  ), base as (
    select o.*, coalesce(pr.completed, false) as completed,
           (pr.id is not null and (pr.started_at is not null or pr.time_spent_seconds > 0 or pr.completed)) as started,
           coalesce(pr.time_spent_seconds, 0) as time_spent_seconds, pr.last_accessed_at
    from ordered o left join prog pr on pr.topic_id = o.topic_id
  ), missing as (
    -- explicit prerequisites that are published and not yet completed
    select b.topic_id, jsonb_agg(jsonb_build_object('id', pb.topic_id, 'title', pt.title) order by pb.seq) as items
    from base b
    join public.course_topic_prerequisites tp on tp.topic_id = b.topic_id
    join base pb on pb.topic_id = tp.prerequisite_topic_id and not pb.completed
    join public.course_topics pt on pt.id = pb.topic_id
    group by b.topic_id
    union all
    -- sequential subjects: the previous topic must be done
    select b.topic_id, jsonb_build_array(jsonb_build_object('id', pb.topic_id, 'title', pt.title))
    from base b
    join base pb on pb.seq = b.seq - 1 and not pb.completed
    join public.course_topics pt on pt.id = pb.topic_id
    where (select learning_path_mode from mode) = 'sequential'
  ), merged as (
    select topic_id, jsonb_agg(distinct item) as items
    from missing, jsonb_array_elements(items) item
    group by topic_id
  )
  select b.topic_id, b.module_id, b.chapter_id, b.seq, b.completed, b.started,
         (not b.completed and m.items is not null) as locked,
         coalesce(m.items, '[]'::jsonb) as missing,
         b.time_spent_seconds, b.last_accessed_at
  from base b left join merged m on m.topic_id = b.topic_id
  order by b.seq
$$;

-- Recompute subject progress. A "unit" is a published topic, or a published module that has no
-- published topics and no published chapters (legacy modules, completed through student_module_progress).
create or replace function public.mlcs_recompute_course_progress(p_student uuid, p_course uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_done int; v_percent int; v_started boolean; v_complete boolean;
begin
  select
    (select count(*) from public.mlcs_topic_states(p_student, p_course))
    + (select count(*) from public.course_modules m
        where m.course_id = p_course and m.status = 'published'
          and not exists (select 1 from public.course_topics t where t.module_id = m.id and t.status = 'published')
          and not exists (select 1 from public.course_chapters ch where ch.module_id = m.id and ch.status = 'published')),
    (select count(*) from public.mlcs_topic_states(p_student, p_course) s where s.completed)
    + (select count(*) from public.course_modules m
        join public.student_module_progress smp on smp.module_id = m.id and smp.student_id = p_student and smp.completed
        where m.course_id = p_course and m.status = 'published'
          and not exists (select 1 from public.course_topics t where t.module_id = m.id and t.status = 'published')
          and not exists (select 1 from public.course_chapters ch where ch.module_id = m.id and ch.status = 'published')),
    exists (select 1 from public.mlcs_topic_states(p_student, p_course) s where s.started)
  into v_total, v_done, v_started;

  if v_total = 0 then return 0; end if;
  v_percent := round(100.0 * v_done / v_total);
  v_complete := v_done = v_total;

  update public.student_course_progress
     set progress_percent = v_percent,
         status = case when v_complete then 'completed' when v_done > 0 or v_started then 'in_progress' else status end,
         started_at = case when v_done > 0 or v_started then coalesce(started_at, now()) else started_at end,
         completed_at = case when v_complete then coalesce(completed_at, now()) else null end,
         updated_at = now()
   where student_id = p_student and course_id = p_course and status <> 'locked';
  return v_percent;
end $$;

-- Server-side enforcement: a student cannot mark a locked topic complete, whatever client they use.
create or replace function public.mlcs_topic_progress_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_locked boolean;
begin
  if auth.uid() is null or auth.uid() <> new.student_id then return new; end if;  -- service role / admin tooling
  v_course := public.mlcs_course_of_topic(new.topic_id);
  select s.locked into v_locked from public.mlcs_topic_states(new.student_id, v_course) s where s.topic_id = new.topic_id;
  if coalesce(v_locked, false) then
    raise exception 'TOPIC_LOCKED: complete the prerequisite topics first';
  end if;
  if new.completed and (tg_op = 'INSERT' or not coalesce(old.completed, false)) then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  if new.started_at is null then new.started_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_mlcs_topic_progress_guard on public.student_topic_progress;
create trigger trg_mlcs_topic_progress_guard before insert or update
  on public.student_topic_progress for each row execute function public.mlcs_topic_progress_guard();

create or replace function public.mlcs_topic_progress_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.mlcs_recompute_course_progress(new.student_id, public.mlcs_course_of_topic(new.topic_id));
  return null;
end $$;
drop trigger if exists trg_mlcs_topic_progress_after on public.student_topic_progress;
create trigger trg_mlcs_topic_progress_after after insert or update of completed
  on public.student_topic_progress for each row execute function public.mlcs_topic_progress_after();

-- Legacy module checkboxes keep working and now feed the same course percentage.
do $$
begin
  if to_regclass('public.student_module_progress') is not null then
    execute $f$
      create or replace function public.mlcs_module_progress_after()
      returns trigger language plpgsql security definer set search_path = public as $b$
      begin
        perform public.mlcs_recompute_course_progress(new.student_id, public.mlcs_course_of_module(new.module_id));
        return null;
      end $b$
    $f$;
    execute 'drop trigger if exists trg_mlcs_module_progress_after on public.student_module_progress';
    execute 'create trigger trg_mlcs_module_progress_after after insert or update of completed on public.student_module_progress for each row execute function public.mlcs_module_progress_after()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RPCs used by the app
-- ---------------------------------------------------------------------------
-- 5a. Student view of a subject: published hierarchy + states + progress, as one JSON document.
create or replace function public.get_student_course_structure(p_course uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_course public.courses%rowtype;
  v_result jsonb;
  v_next uuid; v_last uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_course from public.courses where id = p_course;
  if not found or not public.mlcs_can_view_course(p_course) then raise exception 'COURSE_NOT_FOUND'; end if;

  with st as (select * from public.mlcs_topic_states(v_uid, p_course)),
  mat as (
    select mt.topic_id, count(*) as cnt
    from public.topic_materials mt where mt.status = 'published' group by mt.topic_id
  ),
  topics_json as (
    select t.module_id, t.chapter_id, t.order_index, s.seq,
           jsonb_build_object(
             'id', t.id, 'module_id', t.module_id, 'chapter_id', t.chapter_id, 'title', t.title,
             'topic_type', t.topic_type, 'description', t.description,
             'estimated_minutes', t.estimated_minutes, 'order_index', t.order_index, 'seq', s.seq,
             'state', case when s.completed then 'completed' when s.locked then 'locked'
                           when s.started then 'in_progress' else 'available' end,
             'locked_reason', case when s.locked then
                 'Complete ' || (select string_agg('"' || (e->>'title') || '"', ', ') from jsonb_array_elements(s.missing) e) || ' first.'
               else null end,
             'missing_prerequisites', s.missing,
             'materials_count', coalesce(mat.cnt, 0),
             'time_spent_seconds', s.time_spent_seconds,
             'last_accessed_at', s.last_accessed_at
           ) as j,
           s.completed
    from st s
    join public.course_topics t on t.id = s.topic_id
    left join mat on mat.topic_id = t.id
  ),
  chapters_json as (
    select ch.module_id, ch.order_index,
           jsonb_build_object(
             'id', ch.id, 'module_id', ch.module_id, 'title', ch.title, 'description', ch.description,
             'order_index', ch.order_index,
             'total_topics', count(tj.j), 'completed_topics', count(*) filter (where tj.completed),
             'percent', case when count(tj.j) = 0 then 0 else round(100.0 * count(*) filter (where tj.completed) / count(tj.j)) end,
             'topics', coalesce(jsonb_agg(tj.j order by tj.seq) filter (where tj.j is not null), '[]'::jsonb)
           ) as j
    from public.course_chapters ch
    join public.course_modules m on m.id = ch.module_id and m.course_id = p_course and m.status = 'published'
    left join topics_json tj on tj.chapter_id = ch.id
    where ch.status = 'published'
    group by ch.id
  ),
  modules_json as (
    select m.order_index, m.created_at,
           jsonb_build_object(
             'id', m.id, 'title', m.title, 'description', m.description, 'order_index', m.order_index,
             'content_body', m.content_body, 'content_url', m.content_url,
             'chapters', coalesce((select jsonb_agg(cj.j order by cj.order_index) from chapters_json cj where cj.module_id = m.id), '[]'::jsonb),
             'loose_topics', coalesce((select jsonb_agg(tj.j order by tj.seq) from topics_json tj where tj.module_id = m.id and tj.chapter_id is null), '[]'::jsonb),
             'total_topics', (select count(*) from topics_json tj where tj.module_id = m.id),
             'completed_topics', (select count(*) from topics_json tj where tj.module_id = m.id and tj.completed),
             'percent', case when (select count(*) from topics_json tj where tj.module_id = m.id) = 0 then 0
                        else round(100.0 * (select count(*) from topics_json tj where tj.module_id = m.id and tj.completed)
                                   / (select count(*) from topics_json tj where tj.module_id = m.id)) end
           ) as j
    from public.course_modules m
    where m.course_id = p_course and m.status = 'published'
  )
  select jsonb_build_object(
    'course', jsonb_build_object(
      'id', v_course.id, 'title', v_course.title, 'description', v_course.description,
      'subject', v_course.subject, 'class_level', v_course.class_level,
      'learning_path_mode', v_course.learning_path_mode,
      'academic_year_id', v_course.academic_year_id, 'semester_id', v_course.semester_id),
    'modules', coalesce((select jsonb_agg(j order by order_index, created_at) from modules_json), '[]'::jsonb),
    'total_topics', (select count(*) from topics_json),
    'completed_topics', (select count(*) from topics_json where completed)
  ) into v_result;

  -- next recommended = first unlocked, incomplete topic (course order); last position = most recently opened
  select s.topic_id into v_next from public.mlcs_topic_states(v_uid, p_course) s
   where not s.completed and not s.locked order by s.seq limit 1;
  select s.topic_id into v_last from public.mlcs_topic_states(v_uid, p_course) s
   where s.last_accessed_at is not null order by s.last_accessed_at desc limit 1;

  return v_result || jsonb_build_object('next_topic_id', v_next, 'last_topic_id', v_last);
end $$;

-- 5b. Single topic for the student viewer (materials, prerequisites, linked work) - refuses locked topics.
create or replace function public.get_student_topic(p_topic uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_course uuid; v_state record; v_topic public.course_topics%rowtype; v_next uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  v_course := public.mlcs_course_of_topic(p_topic);
  if v_course is null or not public.mlcs_can_view_course(v_course) then raise exception 'TOPIC_NOT_FOUND'; end if;
  select * into v_topic from public.course_topics where id = p_topic;
  select * into v_state from public.mlcs_topic_states(v_uid, v_course) s where s.topic_id = p_topic;
  if v_state.topic_id is null then raise exception 'TOPIC_NOT_FOUND'; end if;

  if v_state.locked then
    return jsonb_build_object('locked', true, 'topic', jsonb_build_object('id', v_topic.id, 'title', v_topic.title),
      'missing_prerequisites', v_state.missing, 'course_id', v_course);
  end if;

  select s.topic_id into v_next from public.mlcs_topic_states(v_uid, v_course) s
   where not s.completed and not s.locked and s.topic_id <> p_topic and s.seq > v_state.seq order by s.seq limit 1;
  if v_next is null then
    select s.topic_id into v_next from public.mlcs_topic_states(v_uid, v_course) s
     where not s.completed and not s.locked and s.topic_id <> p_topic order by s.seq limit 1;
  end if;

  return jsonb_build_object(
    'locked', false, 'course_id', v_course,
    'topic', jsonb_build_object('id', v_topic.id, 'title', v_topic.title, 'topic_type', v_topic.topic_type,
        'description', v_topic.description, 'learning_objectives', v_topic.learning_objectives,
        'content_body', v_topic.content_body, 'content_url', v_topic.content_url,
        'estimated_minutes', v_topic.estimated_minutes, 'module_id', v_topic.module_id, 'chapter_id', v_topic.chapter_id),
    'completed', v_state.completed,
    'time_spent_seconds', v_state.time_spent_seconds,
    'next_topic_id', v_next,
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mt.id, 'title', mt.title, 'material_type', mt.material_type, 'file_url', mt.file_url,
        'storage_path', mt.storage_path, 'file_name', mt.file_name, 'content_body', mt.content_body,
        'completed', coalesce(mp.completed, false), 'progress_percent', coalesce(mp.progress_percent, 0)
      ) order by mt.order_index, mt.created_at)
      from public.topic_materials mt
      left join public.student_material_progress mp on mp.material_id = mt.id and mp.student_id = v_uid
      where mt.topic_id = p_topic and mt.status = 'published'), '[]'::jsonb),
    'linked_work', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'link_type', l.link_type, 'ref_id', l.ref_id,
                                           'title', l.title, 'due_date', l.due_date) order by l.due_date nulls last, l.created_at)
      from public.topic_assessment_links l where l.topic_id = p_topic), '[]'::jsonb)
  );
end $$;

-- 5c. Learning activity (time + last position + optional material progress). Refuses locked topics.
create or replace function public.record_topic_activity(
  p_topic uuid, p_seconds int default 0,
  p_material uuid default null, p_material_percent int default null, p_material_completed boolean default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_course uuid; v_locked boolean; v_secs int := greatest(0, least(coalesce(p_seconds, 0), 1800));
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  v_course := public.mlcs_course_of_topic(p_topic);
  if v_course is null or not public.mlcs_can_view_course(v_course) then raise exception 'TOPIC_NOT_FOUND'; end if;
  select s.locked into v_locked from public.mlcs_topic_states(v_uid, v_course) s where s.topic_id = p_topic;
  if v_locked is null then raise exception 'TOPIC_NOT_FOUND'; end if;
  if v_locked then raise exception 'TOPIC_LOCKED: complete the prerequisite topics first'; end if;

  insert into public.student_topic_progress (student_id, topic_id, completed, time_spent_seconds, started_at, last_accessed_at)
  values (v_uid, p_topic, false, v_secs, now(), now())
  on conflict (student_id, topic_id) do update
    set time_spent_seconds = public.student_topic_progress.time_spent_seconds + v_secs,
        started_at = coalesce(public.student_topic_progress.started_at, now()),
        last_accessed_at = now();

  if p_material is not null and exists (
    select 1 from public.topic_materials where id = p_material and topic_id = p_topic and status = 'published') then
    insert into public.student_material_progress (student_id, material_id, completed, progress_percent, time_spent_seconds, last_accessed_at)
    values (v_uid, p_material, coalesce(p_material_completed, false), coalesce(p_material_percent, case when p_material_completed then 100 else 0 end), v_secs, now())
    on conflict (student_id, material_id) do update
      set completed = public.student_material_progress.completed or coalesce(p_material_completed, false),
          progress_percent = greatest(public.student_material_progress.progress_percent, coalesce(p_material_percent, case when p_material_completed then 100 else 0 end)),
          time_spent_seconds = public.student_material_progress.time_spent_seconds + v_secs,
          last_accessed_at = now();
  end if;
end $$;

-- 5d. Complete / un-complete a topic. Returns new course percentage + next topic.
create or replace function public.complete_topic(p_topic uuid, p_completed boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_course uuid; v_percent int; v_next uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  v_course := public.mlcs_course_of_topic(p_topic);
  if v_course is null or not public.mlcs_can_view_course(v_course) then raise exception 'TOPIC_NOT_FOUND'; end if;
  if not exists (select 1 from public.mlcs_topic_states(v_uid, v_course) s where s.topic_id = p_topic) then
    raise exception 'TOPIC_NOT_FOUND';
  end if;
  -- the guard trigger raises TOPIC_LOCKED when prerequisites are unmet
  insert into public.student_topic_progress (student_id, topic_id, completed, completed_at, started_at, last_accessed_at)
  values (v_uid, p_topic, p_completed, case when p_completed then now() end, now(), now())
  on conflict (student_id, topic_id) do update
    set completed = p_completed, completed_at = case when p_completed then now() else null end,
        last_accessed_at = now();
  select progress_percent into v_percent from public.student_course_progress where student_id = v_uid and course_id = v_course;
  select s.topic_id into v_next from public.mlcs_topic_states(v_uid, v_course) s
   where not s.completed and not s.locked order by s.seq limit 1;
  return jsonb_build_object('course_id', v_course, 'completed', p_completed, 'course_percent', coalesce(v_percent, 0), 'next_topic_id', v_next);
end $$;

-- 5e. Atomic drag-and-drop reorder. SECURITY INVOKER: RLS decides what the caller may change.
create or replace function public.mlcs_reorder(p_kind text, p_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_kind = 'module' then
    update public.course_modules x set order_index = o.ord - 1 from unnest(p_ids) with ordinality as o(id, ord) where x.id = o.id;
  elsif p_kind = 'chapter' then
    update public.course_chapters x set order_index = o.ord - 1, updated_at = now() from unnest(p_ids) with ordinality as o(id, ord) where x.id = o.id;
  elsif p_kind = 'topic' then
    update public.course_topics x set order_index = o.ord - 1, updated_at = now() from unnest(p_ids) with ordinality as o(id, ord) where x.id = o.id;
  elsif p_kind = 'material' then
    update public.topic_materials x set order_index = o.ord - 1, updated_at = now() from unnest(p_ids) with ordinality as o(id, ord) where x.id = o.id;
  else
    raise exception 'UNKNOWN_KIND: %', p_kind;
  end if;
end $$;

-- 5f. Teacher / admin analytics for one subject.
create or replace function public.get_course_completion_stats(p_course uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_students int; v_result jsonb;
begin
  if not public.mlcs_can_manage_course(p_course) then raise exception 'FORBIDDEN'; end if;
  with learners as (
    select distinct pr.student_id from (
      select student_id from public.student_course_progress where course_id = p_course
      union
      select stp.student_id from public.student_topic_progress stp
        join public.course_topics t on t.id = stp.topic_id
        join public.course_modules m on m.id = t.module_id where m.course_id = p_course
    ) pr
  )
  select count(*) into v_students from learners;

  select jsonb_build_object(
    'learners', v_students,
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'topic_id', t.id, 'title', t.title,
        'completed', (select count(*) from public.student_topic_progress p where p.topic_id = t.id and p.completed),
        'started', (select count(*) from public.student_topic_progress p where p.topic_id = t.id),
        'avg_seconds', coalesce((select round(avg(p.time_spent_seconds)) from public.student_topic_progress p where p.topic_id = t.id and p.time_spent_seconds > 0), 0)
      ) order by m.order_index, coalesce(ch.order_index, -1), t.order_index)
      from public.course_topics t
      join public.course_modules m on m.id = t.module_id
      left join public.course_chapters ch on ch.id = t.chapter_id
      where m.course_id = p_course), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', pf.id, 'name', pf.full_name,
        'percent', coalesce(scp.progress_percent, 0), 'status', scp.status,
        'time_spent_seconds', coalesce((select sum(p.time_spent_seconds) from public.student_topic_progress p
            join public.course_topics t on t.id = p.topic_id join public.course_modules m on m.id = t.module_id
            where p.student_id = pf.id and m.course_id = p_course), 0),
        'last_active', (select max(p.last_accessed_at) from public.student_topic_progress p
            join public.course_topics t on t.id = p.topic_id join public.course_modules m on m.id = t.module_id
            where p.student_id = pf.id and m.course_id = p_course)
      ) order by pf.full_name)
      from (select distinct student_id from public.student_course_progress where course_id = p_course) l
      join public.profiles pf on pf.id = l.student_id
      left join public.student_course_progress scp on scp.student_id = pf.id and scp.course_id = p_course), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- 5g. Context for the AI tutor (service role / edge function). Student-scoped, never returns locked content.
create or replace function public.get_topic_tutor_context(p_student uuid, p_topic uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_course uuid; v_ctx jsonb; v_state record;
begin
  -- callable by the service role (auth.uid() is null) or by the student themself
  if auth.uid() is not null and auth.uid() <> p_student then raise exception 'FORBIDDEN'; end if;
  v_course := public.mlcs_course_of_topic(p_topic);
  if v_course is null then return null; end if;
  if not exists (
    select 1 from public.courses c join public.profiles pf on pf.id = p_student
    where c.id = v_course and c.status = 'published' and c.school_id is not distinct from pf.school_id) then
    return null;
  end if;
  select * into v_state from public.mlcs_topic_states(p_student, v_course) s where s.topic_id = p_topic;
  if v_state.topic_id is null or v_state.locked then return null; end if;

  select jsonb_build_object(
    'academic_year', (select ay.name from public.academic_years ay where ay.id = c.academic_year_id),
    'semester', (select sm.name from public.academic_semesters sm where sm.id = c.semester_id),
    'subject', coalesce(c.subject, c.title), 'course_title', c.title,
    'module', m.title, 'chapter', ch.title,
    'topic', jsonb_build_object('id', t.id, 'title', t.title, 'description', t.description,
        'objectives', t.learning_objectives, 'content', left(coalesce(t.content_body, ''), 6000)),
    'materials', coalesce((select jsonb_agg(jsonb_build_object('title', mt.title, 'type', mt.material_type,
        'notes', left(coalesce(mt.content_body, ''), 4000)) order by mt.order_index)
        from public.topic_materials mt where mt.topic_id = t.id and mt.status = 'published'), '[]'::jsonb),
    'completed', v_state.completed,
    'time_spent_seconds', v_state.time_spent_seconds,
    'next_topic', (select jsonb_build_object('id', nt.id, 'title', nt.title)
        from public.mlcs_topic_states(p_student, v_course) s join public.course_topics nt on nt.id = s.topic_id
        where not s.completed and not s.locked and s.topic_id <> p_topic order by (s.seq > v_state.seq) desc, s.seq limit 1),
    'needs_support', coalesce((select jsonb_agg(x.title) from (
        select nt.title from public.mlcs_topic_states(p_student, v_course) s
        join public.course_topics nt on nt.id = s.topic_id
        where s.started and not s.completed and s.time_spent_seconds >= 900
        order by s.time_spent_seconds desc limit 3) x), '[]'::jsonb)
  ) into v_ctx
  from public.course_topics t
  join public.course_modules m on m.id = t.module_id
  join public.courses c on c.id = m.course_id
  left join public.course_chapters ch on ch.id = t.chapter_id
  where t.id = p_topic;
  return v_ctx;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Storage: private bucket for learning materials, path = {school_id}/{course_id}/{topic_id}/{file}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('course-materials', 'course-materials', false, 262144000)
on conflict (id) do nothing;

drop policy if exists mlcs_materials_obj_read on storage.objects;
create policy mlcs_materials_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = public.mlcs_my_school()::text
  );

drop policy if exists mlcs_materials_obj_write on storage.objects;
create policy mlcs_materials_obj_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'course-materials'
    and (storage.foldername(name))[1] = public.mlcs_my_school()::text
    and public.mlcs_can_manage_course(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists mlcs_materials_obj_update on storage.objects;
create policy mlcs_materials_obj_update on storage.objects for update to authenticated
  using (
    bucket_id = 'course-materials'
    and public.mlcs_can_manage_course(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists mlcs_materials_obj_delete on storage.objects;
create policy mlcs_materials_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'course-materials'
    and public.mlcs_can_manage_course(((storage.foldername(name))[2])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
grant execute on function public.get_student_course_structure(uuid) to authenticated;
grant execute on function public.get_student_topic(uuid) to authenticated;
grant execute on function public.record_topic_activity(uuid, int, uuid, int, boolean) to authenticated;
grant execute on function public.complete_topic(uuid, boolean) to authenticated;
grant execute on function public.mlcs_reorder(text, uuid[]) to authenticated;
grant execute on function public.get_course_completion_stats(uuid) to authenticated;
grant execute on function public.get_topic_tutor_context(uuid, uuid) to service_role;
