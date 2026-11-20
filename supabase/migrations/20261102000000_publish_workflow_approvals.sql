-- =============================================================================
-- APAS - Publish Workflow with Approvals
--
-- Builds on 20261101000000_multi_level_course_structure.sql. Design:
--  * The existing `status` column on course_modules / course_chapters / course_topics / topic_materials
--    stays THE visibility switch. Students (RLS + RPCs) only ever see status = 'published', so every new
--    review state (pending_review, changes_requested, rejected, approved) is hidden from them with no change
--    to the student side. An unpublished parent still hides its children (existing RPC/RLS joins).
--  * Backward compatible: the workflow is OFF per school until an admin enables it. Existing rows keep their
--    status; nothing is rewritten.
--  * When ON, status can only change through the wf_* functions below (SECURITY DEFINER, row-locked,
--    validated server-side, every step written to an append-only history). A trigger rejects direct writes.
--  * Notifications reuse public.governance_notifications (no new notification system).
--  * Subjects (courses) are intentionally NOT put under approval, so one topic never blocks a whole subject.
-- Idempotent: safe to run twice.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Status vocabulary on the four content tables
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['course_modules', 'course_chapters', 'course_topics', 'topic_materials'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_status_check');
    execute format(
      'alter table public.%I add constraint %I check (status in (%s))', t, t || '_status_check',
      '''draft'', ''pending_review'', ''changes_requested'', ''rejected'', ''approved'', ''published'', ''archived''');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.approval_settings (
  school_id uuid primary key,
  enabled boolean not null default false,
  allow_self_approval boolean not null default false,
  admin_can_skip_stages boolean not null default false,
  publish_mode text not null default 'manual' check (publish_mode in ('manual', 'auto')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.approval_stages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  stage_order int not null check (stage_order > 0),
  name text not null,
  reviewer_role text not null check (reviewer_role in ('hod', 'principal', 'school_admin', 'admin')),
  unique (school_id, stage_order)
);

create table if not exists public.approval_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  content_kind text not null check (content_kind in ('module', 'chapter', 'topic', 'material')),
  content_id uuid not null,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  version int not null check (version > 0),
  status text not null check (status in
    ('pending_review', 'changes_requested', 'rejected', 'approved', 'published', 'withdrawn', 'superseded')),
  current_stage int not null default 1,
  total_stages int not null default 1,
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  assigned_reviewer uuid,
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  note text,
  snapshot jsonb not null,
  resubmission_of uuid references public.approval_submissions(id) on delete set null,
  decided_by uuid,
  decided_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  last_reminded_at timestamptz,
  unique (content_kind, content_id, version)
);
-- one open submission per content item (also what makes simultaneous submits safe)
create unique index if not exists uq_approval_open_submission
  on public.approval_submissions (content_kind, content_id) where status in ('pending_review', 'approved');
create index if not exists idx_approval_sub_school_status on public.approval_submissions (school_id, status, submitted_at desc);
create index if not exists idx_approval_sub_course on public.approval_submissions (course_id);
create index if not exists idx_approval_sub_reviewer on public.approval_submissions (assigned_reviewer) where assigned_reviewer is not null;

create table if not exists public.approval_history (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  course_id uuid not null,
  submission_id uuid,   -- deliberately no FK: history must survive (and never be rewritten by) a cascade
  content_kind text not null,
  content_id uuid not null,
  content_version int,
  action text not null,
  from_status text,
  to_status text,
  stage int,
  actor_id uuid,
  actor_role text,
  submitted_by uuid,
  comment text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_approval_hist_content on public.approval_history (content_kind, content_id, created_at);
create index if not exists idx_approval_hist_sub on public.approval_history (submission_id, created_at);
create index if not exists idx_approval_hist_school on public.approval_history (school_id, created_at desc);

-- History is an audit log: it can be read and appended to, never changed or removed through normal workflows.
create or replace function public.wf_history_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'HISTORY_IMMUTABLE: approval history cannot be changed or deleted';
end $$;
drop trigger if exists trg_wf_history_no_update on public.approval_history;
create trigger trg_wf_history_no_update before update or delete on public.approval_history
  for each row execute function public.wf_history_immutable();

alter table public.approval_settings enable row level security;
alter table public.approval_stages enable row level security;
alter table public.approval_submissions enable row level security;
alter table public.approval_history enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.wf_is_admin_role(p_role text)
returns boolean language sql immutable as $$ select coalesce(p_role, '') in ('admin', 'principal', 'school_admin') $$;

create or replace function public.wf_enabled(p_school uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.approval_settings where school_id = p_school), false)
$$;

create or replace function public.wf_table_of(p_kind text)
returns text language sql immutable as $$
  select case p_kind when 'module' then 'course_modules' when 'chapter' then 'course_chapters'
                     when 'topic' then 'course_topics' when 'material' then 'topic_materials' end
$$;

create or replace function public.wf_course_of(p_kind text, p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'module' then (select course_id from public.course_modules where id = p_id)
    when 'chapter' then (select m.course_id from public.course_chapters ch join public.course_modules m on m.id = ch.module_id where ch.id = p_id)
    when 'topic' then public.mlcs_course_of_topic(p_id)
    when 'material' then (select public.mlcs_course_of_topic(mt.topic_id) from public.topic_materials mt where mt.id = p_id)
  end
$$;

-- Can the signed-in user see the approval queue of their school? (admin-level, HOD, or a configured stage role)
create or replace function public.wf_can_see_queue()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (public.wf_is_admin_role(p.role) or p.role = 'hod'
           or exists (select 1 from public.approval_stages s where s.school_id = p.school_id and s.reviewer_role = p.role))
  )
$$;

-- Context of a content item: hierarchy path (for the queue + review screen) and the row itself.
create or replace function public.wf_item_context(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_course uuid; v_row jsonb; v_children jsonb := '[]'::jsonb; v_path jsonb;
  v_module uuid; v_chapter uuid; v_topic uuid;
begin
  if p_kind = 'module' then
    select to_jsonb(x), x.id into v_row, v_module from public.course_modules x where x.id = p_id;
    select coalesce(jsonb_agg(jsonb_build_object('kind','chapter','id',ch.id,'title',ch.title,'status',ch.status) order by ch.order_index), '[]') into v_children
      from public.course_chapters ch where ch.module_id = p_id;
  elsif p_kind = 'chapter' then
    select to_jsonb(x), x.module_id, x.id into v_row, v_module, v_chapter from public.course_chapters x where x.id = p_id;
    select coalesce(jsonb_agg(jsonb_build_object('kind','topic','id',t.id,'title',t.title,'status',t.status) order by t.order_index), '[]') into v_children
      from public.course_topics t where t.chapter_id = p_id;
  elsif p_kind = 'topic' then
    select to_jsonb(x), x.module_id, x.chapter_id, x.id into v_row, v_module, v_chapter, v_topic from public.course_topics x where x.id = p_id;
    select coalesce(jsonb_agg(jsonb_build_object('kind','material','id',mt.id,'title',mt.title,'type',mt.material_type,'status',mt.status) order by mt.order_index), '[]') into v_children
      from public.topic_materials mt where mt.topic_id = p_id;
  elsif p_kind = 'material' then
    select to_jsonb(x), x.topic_id into v_row, v_topic from public.topic_materials x where x.id = p_id;
    select module_id, chapter_id into v_module, v_chapter from public.course_topics where id = v_topic;
  end if;
  if v_row is null then return null; end if;
  v_course := public.wf_course_of(p_kind, p_id);
  select jsonb_build_object(
    'course_id', c.id, 'subject', c.title,
    'academic_year', (select name from public.academic_years where id = c.academic_year_id),
    'semester', (select name from public.academic_semesters where id = c.semester_id),
    'module', (select title from public.course_modules where id = v_module),
    'chapter', (select title from public.course_chapters where id = v_chapter),
    'topic', (select title from public.course_topics where id = v_topic))
  into v_path from public.courses c where c.id = v_course;
  return jsonb_build_object('item', v_row, 'children', v_children, 'path', v_path, 'course_id', v_course);
end $$;

create or replace function public.wf_notify(p_user uuid, p_event text, p_title text, p_message text, p_ref uuid, p_ref_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or to_regclass('public.governance_notifications') is null then return; end if;
  insert into public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
  values (p_user, p_event, p_title, p_message, p_ref, p_ref_type);
end $$;

create or replace function public.wf_log(
  p_sub public.approval_submissions, p_action text, p_from text, p_to text, p_comment text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.approval_history (school_id, course_id, submission_id, content_kind, content_id, content_version,
    action, from_status, to_status, stage, actor_id, actor_role, submitted_by, comment, reason)
  values (p_sub.school_id, p_sub.course_id, p_sub.id, p_sub.content_kind, p_sub.content_id, p_sub.version,
    p_action, p_from, p_to, p_sub.current_stage, auth.uid(), public.mlcs_my_role(), p_sub.submitted_by, p_comment, p_reason);
end $$;

-- Sets the visibility status of a content row; only this path may do it while the workflow is on.
create or replace function public.wf_set_item_status(p_kind text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('apas.wf', '1', true);
  execute format('update public.%I set status = %L where id = %L', public.wf_table_of(p_kind), p_status, p_id);
  perform set_config('apas.wf', '', true);
end $$;

-- Is the whole chain above (and including) the item published, i.e. can students actually see it?
create or replace function public.wf_chain_published(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'module' then exists (select 1 from public.course_modules m join public.courses c on c.id = m.course_id
                               where m.id = p_id and m.status = 'published' and c.status = 'published')
    when 'chapter' then exists (select 1 from public.course_chapters ch join public.course_modules m on m.id = ch.module_id
                               join public.courses c on c.id = m.course_id
                               where ch.id = p_id and ch.status = 'published' and m.status = 'published' and c.status = 'published')
    when 'topic' then exists (select 1 from public.course_topics t join public.course_modules m on m.id = t.module_id
                               join public.courses c on c.id = m.course_id
                               left join public.course_chapters ch on ch.id = t.chapter_id
                               where t.id = p_id and t.status = 'published' and m.status = 'published' and c.status = 'published'
                                 and (t.chapter_id is null or ch.status = 'published'))
    when 'material' then exists (select 1 from public.topic_materials mt join public.course_topics t on t.id = mt.topic_id
                               join public.course_modules m on m.id = t.module_id join public.courses c on c.id = m.course_id
                               left join public.course_chapters ch on ch.id = t.chapter_id
                               where mt.id = p_id and mt.status = 'published' and t.status = 'published' and m.status = 'published'
                                 and c.status = 'published' and (t.chapter_id is null or ch.status = 'published'))
    else false end
$$;

-- Reviewers of a stage: users of the school holding the stage role (admin-level when no stages are configured).
create or replace function public.wf_stage_reviewers(p_school uuid, p_stage int)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
  where p.school_id = p_school
    and ( (exists (select 1 from public.approval_stages s where s.school_id = p_school)
           and p.role = (select reviewer_role from public.approval_stages where school_id = p_school and stage_order = p_stage))
       or (not exists (select 1 from public.approval_stages s where s.school_id = p_school)
           and public.wf_is_admin_role(p.role)) )
$$;

-- May the signed-in user act as reviewer on this submission at its current stage?
create or replace function public.wf_can_review(p_sub public.approval_submissions)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_school uuid; v_stage_role text;
begin
  select role, school_id into v_role, v_school from public.profiles where id = auth.uid();
  if v_role is null or v_school is distinct from p_sub.school_id then return false; end if;
  if public.wf_is_admin_role(v_role) then return true; end if;
  if p_sub.assigned_reviewer is not null then return p_sub.assigned_reviewer = auth.uid(); end if;
  select reviewer_role into v_stage_role from public.approval_stages
   where school_id = p_sub.school_id and stage_order = p_sub.current_stage;
  return v_stage_role is not null and v_stage_role = v_role;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Guard: when the workflow is on, status and reviewed content cannot be changed by direct writes
-- ---------------------------------------------------------------------------
create or replace function public.wf_content_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text := case tg_table_name when 'course_modules' then 'module' when 'course_chapters' then 'chapter'
                                    when 'course_topics' then 'topic' else 'material' end;
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_course uuid; v_school uuid; v_role text; v_j jsonb; v_ignore text[] := array['order_index', 'sort_order', 'updated_at', 'status'];
begin
  if current_setting('apas.wf', true) = '1' or auth.uid() is null then return v_row; end if;  -- workflow functions / service role
  v_j := to_jsonb(v_row);
  v_course := case v_kind when 'module' then (v_j ->> 'course_id')::uuid
                          when 'chapter' then public.mlcs_course_of_module((v_j ->> 'module_id')::uuid)
                          when 'topic' then public.mlcs_course_of_module((v_j ->> 'module_id')::uuid)
                          else public.mlcs_course_of_topic((v_j ->> 'topic_id')::uuid) end;
  select school_id into v_school from public.courses where id = v_course;
  if not public.wf_enabled(v_school) then return v_row; end if;
  v_role := public.mlcs_my_role();

  if tg_op = 'INSERT' then
    new.status := 'draft';           -- everything starts as a draft and must be submitted
    return new;
  elsif tg_op = 'DELETE' then
    if old.status in ('pending_review', 'approved') then
      raise exception 'WF_LOCKED: this item is in the approval process; withdraw the submission first';
    end if;
    return old;
  end if;

  if new.status is distinct from old.status then
    raise exception 'WF_STATUS_PROTECTED: status can only be changed through the approval workflow';
  end if;
  if (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
    if old.status in ('pending_review', 'approved') then
      raise exception 'WF_LOCKED: this item is in the approval process and cannot be edited; withdraw the submission to edit it';
    end if;
    if old.status in ('published', 'archived') and not public.wf_is_admin_role(v_role) then
      raise exception 'WF_PUBLISHED_LOCKED: published content cannot be edited directly; start a revision (reopen as draft) and resubmit it';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['course_modules', 'course_chapters', 'course_topics', 'topic_materials'] loop
    execute format('drop trigger if exists trg_wf_content_guard on public.%I', t);
    execute format('create trigger trg_wf_content_guard before insert or update or delete on public.%I
                    for each row execute function public.wf_content_guard()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Workflow functions (all transitions are validated here, in one transaction, with row locks)
-- ---------------------------------------------------------------------------
create or replace function public.wf_submit(p_kind text, p_id uuid, p_note text default null, p_priority text default 'normal')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_course uuid; v_school uuid; v_status text; v_title text; v_ctx jsonb;
  v_total int; v_version int; v_prev uuid; v_sub public.approval_submissions; v_reviewer uuid;
begin
  if v_uid is null then raise exception 'WF_AUTH: sign in required'; end if;
  if public.wf_table_of(p_kind) is null then raise exception 'WF_BAD_KIND: unknown content type'; end if;
  v_course := public.wf_course_of(p_kind, p_id);
  if v_course is null then raise exception 'WF_NOT_FOUND: content not found'; end if;
  if not public.mlcs_can_manage_course(v_course) then raise exception 'WF_FORBIDDEN: you cannot submit content for this subject'; end if;
  select school_id into v_school from public.courses where id = v_course;
  if not public.wf_enabled(v_school) then raise exception 'WF_DISABLED: the approval workflow is not enabled for this school'; end if;
  if p_priority not in ('normal', 'high') then p_priority := 'normal'; end if;

  execute format('select status from public.%I where id = $1 for update', public.wf_table_of(p_kind)) into v_status using p_id;
  if v_status not in ('draft', 'changes_requested') then
    raise exception 'WF_BAD_STATE: only drafts or items with requested changes can be submitted (current: %)', v_status;
  end if;
  v_ctx := public.wf_item_context(p_kind, p_id);
  v_title := coalesce(v_ctx #>> '{item,title}', 'Untitled');
  select greatest(count(*), 1) into v_total from public.approval_stages where school_id = v_school;
  select coalesce(max(version), 0) + 1 into v_version from public.approval_submissions where content_kind = p_kind and content_id = p_id;
  select id into v_prev from public.approval_submissions
    where content_kind = p_kind and content_id = p_id and status = 'changes_requested' order by version desc limit 1;

  begin
    insert into public.approval_submissions (school_id, content_kind, content_id, course_id, title, version, status,
      current_stage, total_stages, submitted_by, priority, note, snapshot, resubmission_of)
    values (v_school, p_kind, p_id, v_course, v_title, v_version, 'pending_review', 1, v_total, v_uid, p_priority,
      nullif(trim(coalesce(p_note, '')), ''), v_ctx, v_prev)
    returning * into v_sub;
  exception when unique_violation then
    raise exception 'WF_ALREADY_PENDING: this item already has an open submission';
  end;
  if v_prev is not null then
    update public.approval_submissions set status = 'superseded' where id = v_prev;
  end if;

  perform public.wf_set_item_status(p_kind, p_id, 'pending_review');
  perform public.wf_log(v_sub, case when v_prev is null then 'submitted' else 'resubmitted' end, v_status, 'pending_review', v_sub.note, null);

  perform public.wf_notify(v_uid, 'content_submitted', 'Submitted for review',
    format('"%s" was submitted for review (version %s).', v_title, v_version), v_sub.id, 'approval_submission');
  for v_reviewer in select * from public.wf_stage_reviewers(v_school, 1) loop
    if v_reviewer <> v_uid then
      perform public.wf_notify(v_reviewer, 'content_submitted', 'New content to review',
        format('"%s" (%s) is waiting for review.', v_title, p_kind), v_sub.id, 'approval_submission');
    end if;
  end loop;
  return v_sub.id;
end $$;

create or replace function public.wf_publish_internal(p_sub_id uuid, p_action text, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub public.approval_submissions; v_student uuid; v_prev_status text; v_was_live boolean;
begin
  select * into v_sub from public.approval_submissions where id = p_sub_id for update;
  select exists (select 1 from public.approval_submissions where content_kind = v_sub.content_kind and content_id = v_sub.content_id
                 and published_at is not null and id <> p_sub_id) into v_was_live;   -- an earlier version was already live
  execute format('select status from public.%I where id = $1', public.wf_table_of(v_sub.content_kind)) into v_prev_status using v_sub.content_id;
  update public.approval_submissions set status = 'published', published_by = auth.uid(), published_at = now()
   where id = p_sub_id returning * into v_sub;
  update public.approval_submissions set status = 'superseded'
   where content_kind = v_sub.content_kind and content_id = v_sub.content_id and status = 'published' and id <> p_sub_id;
  perform public.wf_set_item_status(v_sub.content_kind, v_sub.content_id, 'published');
  perform public.wf_log(v_sub, p_action, v_prev_status, 'published', p_comment, null);

  perform public.wf_notify(v_sub.submitted_by, 'content_published', 'Content published',
    format('"%s" is now published and visible to students.', v_sub.title), v_sub.id, 'approval_submission');
  -- students enrolled in the subject, only when the whole chain is actually visible to them
  if public.wf_chain_published(v_sub.content_kind, v_sub.content_id) then
    for v_student in select student_id from public.student_course_progress where course_id = v_sub.course_id loop
      perform public.wf_notify(v_student, 'content_published',
        case when v_was_live then 'Learning material updated' else 'New learning content' end,
        format('"%s" is now available.', v_sub.title), v_sub.content_id, 'course_' || v_sub.content_kind);
    end loop;
  end if;
end $$;

create or replace function public.wf_review(p_submission uuid, p_decision text, p_comment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_sub public.approval_submissions; v_set public.approval_settings; v_role text := public.mlcs_my_role();
  v_comment text := nullif(trim(coalesce(p_comment, '')), ''); v_next uuid; v_new text; v_final boolean;
begin
  if auth.uid() is null then raise exception 'WF_AUTH: sign in required'; end if;
  if p_decision not in ('approve', 'reject', 'request_changes') then raise exception 'WF_BAD_DECISION: unknown decision'; end if;
  select * into v_sub from public.approval_submissions where id = p_submission for update;   -- serialises reviewers
  if not found then raise exception 'WF_NOT_FOUND: submission not found'; end if;
  if v_sub.status <> 'pending_review' then
    raise exception 'WF_BAD_STATE: this submission was already handled (status: %)', v_sub.status;
  end if;
  if not public.wf_can_review(v_sub) then raise exception 'WF_FORBIDDEN: you are not an authorised reviewer for this stage'; end if;
  select * into v_set from public.approval_settings where school_id = v_sub.school_id;
  if p_decision in ('reject', 'request_changes') and length(coalesce(v_comment, '')) < 5 then
    raise exception 'WF_REASON_REQUIRED: please give a meaningful reason (at least 5 characters)';
  end if;

  if p_decision = 'approve' then
    if v_sub.submitted_by = auth.uid() and not coalesce(v_set.allow_self_approval, false) then
      raise exception 'WF_SELF_APPROVAL: you cannot approve your own submission';
    end if;
    v_final := v_sub.current_stage >= v_sub.total_stages
               or (coalesce(v_set.admin_can_skip_stages, false) and public.wf_is_admin_role(v_role));
    if not v_final then
      perform public.wf_log(v_sub, 'stage_approved', 'pending_review', 'pending_review', v_comment, null);
      update public.approval_submissions set current_stage = current_stage + 1, assigned_reviewer = null
       where id = v_sub.id returning * into v_sub;
      for v_next in select * from public.wf_stage_reviewers(v_sub.school_id, v_sub.current_stage) loop
        perform public.wf_notify(v_next, 'content_submitted', 'New content to review',
          format('"%s" passed the previous stage and needs your review.', v_sub.title), v_sub.id, 'approval_submission');
      end loop;
      perform public.wf_notify(v_sub.submitted_by, 'content_stage_approved', 'Review stage passed',
        format('"%s" passed a review stage and moved to the next one.', v_sub.title), v_sub.id, 'approval_submission');
      return 'pending_review';
    end if;
    update public.approval_submissions set status = 'approved', decided_by = auth.uid(), decided_at = now()
     where id = v_sub.id returning * into v_sub;
    perform public.wf_set_item_status(v_sub.content_kind, v_sub.content_id, 'approved');
    perform public.wf_log(v_sub, 'approved', 'pending_review', 'approved', v_comment, null);
    perform public.wf_notify(v_sub.submitted_by, 'content_approved', 'Content approved',
      format('"%s" was approved%s.', v_sub.title, case when coalesce(v_set.publish_mode, 'manual') = 'manual' then ' and is waiting to be published' else '' end),
      v_sub.id, 'approval_submission');
    if coalesce(v_set.publish_mode, 'manual') = 'auto' then
      perform public.wf_publish_internal(v_sub.id, 'published', 'Auto-published after approval');
      return 'published';
    end if;
    return 'approved';
  end if;

  v_new := case p_decision when 'reject' then 'rejected' else 'changes_requested' end;
  update public.approval_submissions set status = v_new, decided_by = auth.uid(), decided_at = now()
   where id = v_sub.id returning * into v_sub;
  perform public.wf_set_item_status(v_sub.content_kind, v_sub.content_id, v_new);
  perform public.wf_log(v_sub, case when v_new = 'rejected' then 'rejected' else 'changes_requested' end,
                        'pending_review', v_new, v_comment, v_comment);
  perform public.wf_notify(v_sub.submitted_by,
    case when v_new = 'rejected' then 'content_rejected' else 'content_changes_requested' end,
    case when v_new = 'rejected' then 'Content rejected' else 'Changes requested' end,
    format('"%s": %s', v_sub.title, v_comment), v_sub.id, 'approval_submission');
  return v_new;
end $$;

create or replace function public.wf_publish(p_submission uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub public.approval_submissions; v_role text := public.mlcs_my_role();
begin
  if auth.uid() is null then raise exception 'WF_AUTH: sign in required'; end if;
  select * into v_sub from public.approval_submissions where id = p_submission for update;
  if not found then raise exception 'WF_NOT_FOUND: submission not found'; end if;
  if v_sub.status <> 'approved' then raise exception 'WF_BAD_STATE: only approved content can be published (status: %)', v_sub.status; end if;
  if v_sub.school_id is distinct from public.mlcs_my_school() or not (public.wf_is_admin_role(v_role) or public.wf_can_review(v_sub)) then
    raise exception 'WF_FORBIDDEN: you are not allowed to publish this content';
  end if;
  perform public.wf_publish_internal(p_submission, 'published', null);
end $$;

-- Admin-level shortcut that is still fully audited (needs a reason, creates a version, writes history).
create or replace function public.wf_direct_publish(p_kind text, p_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_course uuid; v_school uuid; v_status text; v_ctx jsonb; v_sub public.approval_submissions; v_version int;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.wf_is_admin_role(public.mlcs_my_role()) then raise exception 'WF_FORBIDDEN: only school administrators can publish directly'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'WF_REASON_REQUIRED: please give a reason for publishing without review'; end if;
  v_course := public.wf_course_of(p_kind, p_id);
  if v_course is null or not public.mlcs_can_manage_course(v_course) then raise exception 'WF_FORBIDDEN: not allowed for this subject'; end if;
  select school_id into v_school from public.courses where id = v_course;
  execute format('select status from public.%I where id = $1 for update', public.wf_table_of(p_kind)) into v_status using p_id;
  if v_status = 'published' then raise exception 'WF_BAD_STATE: already published'; end if;
  if v_status in ('pending_review', 'approved') then raise exception 'WF_BAD_STATE: this item has an open submission; review it instead'; end if;
  v_ctx := public.wf_item_context(p_kind, p_id);
  select coalesce(max(version), 0) + 1 into v_version from public.approval_submissions where content_kind = p_kind and content_id = p_id;
  insert into public.approval_submissions (school_id, content_kind, content_id, course_id, title, version, status, submitted_by, note, snapshot)
  values (v_school, p_kind, p_id, v_course, coalesce(v_ctx #>> '{item,title}', 'Untitled'), v_version, 'approved', auth.uid(), v_reason, v_ctx)
  returning * into v_sub;
  perform public.wf_set_item_status(p_kind, p_id, 'approved');
  perform public.wf_log(v_sub, 'direct_publish_requested', v_status, 'approved', v_reason, v_reason);
  perform public.wf_publish_internal(v_sub.id, 'direct_published', v_reason);
  return v_sub.id;
end $$;

create or replace function public.wf_assign(p_submission uuid, p_reviewer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub public.approval_submissions; v_role text := public.mlcs_my_role(); v_target record; v_action text;
begin
  if not (public.wf_is_admin_role(v_role) or v_role = 'hod') then raise exception 'WF_FORBIDDEN: only reviewers and administrators can assign reviewers'; end if;
  select * into v_sub from public.approval_submissions where id = p_submission for update;
  if not found then raise exception 'WF_NOT_FOUND: submission not found'; end if;
  if v_sub.school_id is distinct from public.mlcs_my_school() then raise exception 'WF_FORBIDDEN: different school'; end if;
  if v_sub.status <> 'pending_review' then raise exception 'WF_BAD_STATE: only pending submissions can be assigned'; end if;
  select id, role, school_id, full_name into v_target from public.profiles where id = p_reviewer;
  if not found or v_target.school_id is distinct from v_sub.school_id
     or v_target.role not in ('admin', 'principal', 'school_admin', 'hod', 'teacher') then
    raise exception 'WF_BAD_REVIEWER: choose a staff member of this school';
  end if;
  if v_target.id = v_sub.submitted_by and not coalesce((select allow_self_approval from public.approval_settings where school_id = v_sub.school_id), false) then
    raise exception 'WF_SELF_APPROVAL: the submitter cannot be assigned as the reviewer';
  end if;
  v_action := case when v_sub.assigned_reviewer is null then 'assigned' else 'reassigned' end;
  update public.approval_submissions set assigned_reviewer = p_reviewer where id = p_submission returning * into v_sub;
  perform public.wf_log(v_sub, v_action, 'pending_review', 'pending_review', v_target.full_name, null);
  perform public.wf_notify(p_reviewer, 'content_assigned', 'Content assigned to you',
    format('"%s" was %s to you for review.', v_sub.title, case when v_action = 'assigned' then 'assigned' else 'reassigned' end), v_sub.id, 'approval_submission');
  perform public.wf_notify(v_sub.submitted_by, 'content_assigned', 'Reviewer assigned',
    format('"%s" is being reviewed by %s.', v_sub.title, coalesce(v_target.full_name, 'a reviewer')), v_sub.id, 'approval_submission');
end $$;

create or replace function public.wf_withdraw(p_submission uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sub public.approval_submissions;
begin
  select * into v_sub from public.approval_submissions where id = p_submission for update;
  if not found then raise exception 'WF_NOT_FOUND: submission not found'; end if;
  if v_sub.status <> 'pending_review' then raise exception 'WF_BAD_STATE: only pending submissions can be withdrawn'; end if;
  if not (v_sub.submitted_by = auth.uid() or (public.wf_is_admin_role(public.mlcs_my_role()) and v_sub.school_id = public.mlcs_my_school())) then
    raise exception 'WF_FORBIDDEN: only the submitter or an administrator can withdraw this';
  end if;
  update public.approval_submissions set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = p_submission returning * into v_sub;
  perform public.wf_set_item_status(v_sub.content_kind, v_sub.content_id, 'draft');
  perform public.wf_log(v_sub, 'withdrawn', 'pending_review', 'draft', null, null);
end $$;

-- Controlled revision: bring published / approved / rejected / archived content back to draft.
-- Published content goes back to draft (hidden from students while revised); student progress is kept.
create or replace function public.wf_reopen(p_kind text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_course uuid; v_status text; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_sub public.approval_submissions;
begin
  if length(coalesce(v_reason, '')) < 5 then raise exception 'WF_REASON_REQUIRED: please say why this content is being reopened'; end if;
  v_course := public.wf_course_of(p_kind, p_id);
  if v_course is null or not public.mlcs_can_manage_course(v_course) then raise exception 'WF_FORBIDDEN: not allowed for this subject'; end if;
  execute format('select status from public.%I where id = $1 for update', public.wf_table_of(p_kind)) into v_status using p_id;
  if v_status not in ('published', 'approved', 'rejected', 'archived') then
    raise exception 'WF_BAD_STATE: only published, approved, rejected or archived content can be reopened (current: %)', v_status;
  end if;
  select * into v_sub from public.approval_submissions where content_kind = p_kind and content_id = p_id order by version desc limit 1;
  if v_sub.id is null then
    -- no history yet (content that predates the workflow): create a baseline version so the history is never empty
    insert into public.approval_submissions (school_id, content_kind, content_id, course_id, title, version, status, submitted_by, snapshot)
    select c.school_id, p_kind, p_id, v_course, coalesce(public.wf_item_context(p_kind, p_id) #>> '{item,title}', 'Untitled'), 1,
           case when v_status = 'published' then 'published' else 'superseded' end, auth.uid(), public.wf_item_context(p_kind, p_id)
    from public.courses c where c.id = v_course returning * into v_sub;
  elsif v_sub.status = 'approved' then
    update public.approval_submissions set status = 'superseded' where id = v_sub.id returning * into v_sub;
  end if;
  perform public.wf_set_item_status(p_kind, p_id, 'draft');
  perform public.wf_log(v_sub, 'reopened', v_status, 'draft', v_reason, v_reason);
end $$;

create or replace function public.wf_archive(p_kind text, p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_status text; v_sub public.approval_submissions; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  v_course := public.wf_course_of(p_kind, p_id);
  if v_course is null or not public.mlcs_can_manage_course(v_course) then raise exception 'WF_FORBIDDEN: not allowed for this subject'; end if;
  execute format('select status from public.%I where id = $1 for update', public.wf_table_of(p_kind)) into v_status using p_id;
  if v_status not in ('published', 'draft', 'rejected') then
    raise exception 'WF_BAD_STATE: this item cannot be archived from status %', v_status;
  end if;
  select * into v_sub from public.approval_submissions where content_kind = p_kind and content_id = p_id order by version desc limit 1;
  if v_sub.id is null then
    insert into public.approval_submissions (school_id, content_kind, content_id, course_id, title, version, status, submitted_by, snapshot)
    select c.school_id, p_kind, p_id, v_course, coalesce(public.wf_item_context(p_kind, p_id) #>> '{item,title}', 'Untitled'), 1,
           case when v_status = 'published' then 'published' else 'superseded' end, auth.uid(), public.wf_item_context(p_kind, p_id)
    from public.courses c where c.id = v_course returning * into v_sub;
  end if;
  perform public.wf_set_item_status(p_kind, p_id, 'archived');
  perform public.wf_log(v_sub, 'archived', v_status, 'archived', v_reason, null);
end $$;

create or replace function public.wf_save_settings(
  p_enabled boolean, p_allow_self boolean, p_publish_mode text, p_admin_skip boolean, p_stages jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.mlcs_my_school(); v_s jsonb; v_i int := 0; v_total int;
begin
  if not public.wf_is_admin_role(public.mlcs_my_role()) or v_school is null then
    raise exception 'WF_FORBIDDEN: only school administrators can change approval settings';
  end if;
  if p_publish_mode not in ('manual', 'auto') then raise exception 'WF_BAD_SETTING: publish mode must be manual or auto'; end if;
  if jsonb_typeof(coalesce(p_stages, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_stages, '[]'::jsonb)) > 5 then
    raise exception 'WF_BAD_SETTING: at most 5 approval stages are supported';
  end if;
  insert into public.approval_settings (school_id, enabled, allow_self_approval, admin_can_skip_stages, publish_mode, updated_by, updated_at)
  values (v_school, p_enabled, p_allow_self, p_admin_skip, p_publish_mode, auth.uid(), now())
  on conflict (school_id) do update set enabled = excluded.enabled, allow_self_approval = excluded.allow_self_approval,
    admin_can_skip_stages = excluded.admin_can_skip_stages, publish_mode = excluded.publish_mode,
    updated_by = excluded.updated_by, updated_at = now();
  delete from public.approval_stages where school_id = v_school;
  for v_s in select * from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.approval_stages (school_id, stage_order, name, reviewer_role)
    values (v_school, v_i, coalesce(nullif(trim(v_s ->> 'name'), ''), 'Stage ' || v_i), v_s ->> 'reviewer_role');
  end loop;
  v_total := greatest(v_i, 1);
  update public.approval_submissions set total_stages = v_total, current_stage = least(current_stage, v_total)
   where school_id = v_school and status = 'pending_review';
end $$;

create or replace function public.wf_send_reminders(p_older_than_hours int default 48)
returns int language plpgsql security definer set search_path = public as $$
declare v_sub record; v_n int := 0; v_user uuid;
begin
  if not public.wf_is_admin_role(public.mlcs_my_role()) then raise exception 'WF_FORBIDDEN: only school administrators can send reminders'; end if;
  for v_sub in select * from public.approval_submissions
    where school_id = public.mlcs_my_school() and status = 'pending_review'
      and submitted_at < now() - make_interval(hours => greatest(p_older_than_hours, 1))
      and (last_reminded_at is null or last_reminded_at < now() - interval '24 hours') loop
    for v_user in select case when v_sub.assigned_reviewer is not null then v_sub.assigned_reviewer else r end
                  from public.wf_stage_reviewers(v_sub.school_id, v_sub.current_stage) r loop
      perform public.wf_notify(v_user, 'content_reminder', 'Approval reminder',
        format('"%s" has been waiting for review since %s.', v_sub.title, to_char(v_sub.submitted_at, 'DD Mon')), v_sub.id, 'approval_submission');
    end loop;
    update public.approval_submissions set last_reminded_at = now() where id = v_sub.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Read APIs for the screens
-- ---------------------------------------------------------------------------
create or replace function public.wf_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.mlcs_my_school();
begin
  if not public.wf_can_see_queue() then raise exception 'WF_FORBIDDEN: reviewers only'; end if;
  return (select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending_review'),
    'approved', count(*) filter (where status = 'approved'),
    'published', count(*) filter (where status = 'published'),
    'rejected', count(*) filter (where status = 'rejected'),
    'changes_requested', count(*) filter (where status = 'changes_requested'),
    'avg_review_hours', round((avg(extract(epoch from (decided_at - submitted_at)) / 3600.0)
        filter (where decided_at is not null and status <> 'withdrawn'))::numeric, 1),
    'reviewed_count', count(*) filter (where decided_at is not null and status <> 'withdrawn'))
    from public.approval_submissions where school_id = v_school);
end $$;

create or replace function public.wf_queue(
  p_status text default null, p_search text default null, p_kind text default null, p_course uuid default null,
  p_sort text default 'submitted_desc', p_limit int default 20, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.mlcs_my_school(); v_total int; v_rows jsonb; v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.wf_can_see_queue() then raise exception 'WF_FORBIDDEN: reviewers only'; end if;
  with f as (
    select s.* from public.approval_submissions s
    where s.school_id = v_school
      and (p_status is null or s.status = p_status)
      and (p_kind is null or s.content_kind = p_kind)
      and (p_course is null or s.course_id = p_course)
      and (v_q is null or s.title ilike '%' || v_q || '%' or s.snapshot #>> '{path,subject}' ilike '%' || v_q || '%')
  )
  select count(*) into v_total from f;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows from (
    select s.id, s.content_kind, s.content_id, s.course_id, s.title, s.version, s.status, s.current_stage, s.total_stages,
           s.submitted_by, sp.full_name as submitted_by_name, s.submitted_at, s.assigned_reviewer, ap.full_name as assigned_reviewer_name,
           s.priority, s.snapshot -> 'path' as path, s.decided_at,
           public.wf_can_review(s) as can_review
    from public.approval_submissions s
    left join public.profiles sp on sp.id = s.submitted_by
    left join public.profiles ap on ap.id = s.assigned_reviewer
    where s.school_id = v_school
      and (p_status is null or s.status = p_status)
      and (p_kind is null or s.content_kind = p_kind)
      and (p_course is null or s.course_id = p_course)
      and (v_q is null or s.title ilike '%' || v_q || '%' or s.snapshot #>> '{path,subject}' ilike '%' || v_q || '%')
    order by
      case when p_sort = 'submitted_asc' then s.submitted_at end asc,
      case when p_sort = 'title' then s.title end asc,
      case when p_sort = 'priority' then (s.priority = 'high') end desc,
      s.submitted_at desc
    limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  ) r;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.wf_submission_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_sub public.approval_submissions; v_role text := public.mlcs_my_role(); v_set public.approval_settings;
begin
  select * into v_sub from public.approval_submissions where id = p_id;
  if not found or v_sub.school_id is distinct from public.mlcs_my_school() then raise exception 'WF_NOT_FOUND: submission not found'; end if;
  if not (public.wf_can_see_queue() or v_sub.submitted_by = auth.uid() or v_sub.assigned_reviewer = auth.uid()
          or public.mlcs_can_manage_course(v_sub.course_id)) then
    raise exception 'WF_FORBIDDEN: you cannot view this submission';
  end if;
  select * into v_set from public.approval_settings where school_id = v_sub.school_id;
  return jsonb_build_object(
    'submission', to_jsonb(v_sub) - 'snapshot',
    'snapshot', v_sub.snapshot,
    'submitted_by_name', (select full_name from public.profiles where id = v_sub.submitted_by),
    'assigned_reviewer_name', (select full_name from public.profiles where id = v_sub.assigned_reviewer),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('order', stage_order, 'name', name, 'role', reviewer_role) order by stage_order)
                         from public.approval_stages where school_id = v_sub.school_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'action', h.action, 'from_status', h.from_status,
                  'to_status', h.to_status, 'stage', h.stage, 'version', h.content_version, 'comment', h.comment, 'reason', h.reason,
                  'actor_id', h.actor_id, 'actor_name', (select full_name from public.profiles where id = h.actor_id),
                  'actor_role', h.actor_role, 'created_at', h.created_at) order by h.created_at)
                  from public.approval_history h where h.content_kind = v_sub.content_kind and h.content_id = v_sub.content_id), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'version', s.version, 'status', s.status,
                  'submitted_at', s.submitted_at, 'decided_at', s.decided_at, 'published_at', s.published_at) order by s.version desc)
                  from public.approval_submissions s where s.content_kind = v_sub.content_kind and s.content_id = v_sub.content_id), '[]'::jsonb),
    'can_review', v_sub.status = 'pending_review' and public.wf_can_review(v_sub),
    'can_assign', v_sub.status = 'pending_review' and (public.wf_is_admin_role(v_role) or v_role = 'hod'),
    'can_publish', v_sub.status = 'approved' and (public.wf_is_admin_role(v_role) or public.wf_can_review(v_sub)),
    'can_withdraw', v_sub.status = 'pending_review' and (v_sub.submitted_by = auth.uid() or public.wf_is_admin_role(v_role)),
    'is_own', v_sub.submitted_by = auth.uid(),
    'allow_self_approval', coalesce(v_set.allow_self_approval, false));
end $$;

create or replace function public.wf_history(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_course uuid := public.wf_course_of(p_kind, p_id);
begin
  if v_course is null or not (public.mlcs_can_manage_course(v_course) or public.wf_can_see_queue()) then
    raise exception 'WF_FORBIDDEN: you cannot view this history';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'action', h.action, 'from_status', h.from_status, 'to_status', h.to_status,
      'stage', h.stage, 'version', h.content_version, 'comment', h.comment, 'reason', h.reason,
      'actor_name', (select full_name from public.profiles where id = h.actor_id), 'actor_role', h.actor_role, 'created_at', h.created_at)
      order by h.created_at)
    from public.approval_history h
    where h.content_kind = p_kind and h.content_id = p_id and h.school_id = public.mlcs_my_school()), '[]'::jsonb);
end $$;

-- Staff the queue can assign to
create or replace function public.wf_reviewer_candidates()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role) order by p.full_name), '[]'::jsonb)
  from public.profiles p
  where public.wf_can_see_queue() and p.school_id = public.mlcs_my_school()
    and p.role in ('admin', 'principal', 'school_admin', 'hod', 'teacher')
$$;

create or replace function public.wf_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enabled', coalesce(s.enabled, false), 'allow_self_approval', coalesce(s.allow_self_approval, false),
    'admin_can_skip_stages', coalesce(s.admin_can_skip_stages, false), 'publish_mode', coalesce(s.publish_mode, 'manual'),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('name', st.name, 'reviewer_role', st.reviewer_role) order by st.stage_order)
                        from public.approval_stages st where st.school_id = public.mlcs_my_school()), '[]'::jsonb))
  from (select 1) d left join public.approval_settings s on s.school_id = public.mlcs_my_school()
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS: read-only for the client. Every write goes through the functions above.
-- ---------------------------------------------------------------------------
drop policy if exists wf_settings_read on public.approval_settings;
create policy wf_settings_read on public.approval_settings for select to authenticated
  using (school_id is not distinct from public.mlcs_my_school() and public.mlcs_my_role() not in ('student', 'parent'));
drop policy if exists wf_stages_read on public.approval_stages;
create policy wf_stages_read on public.approval_stages for select to authenticated
  using (school_id is not distinct from public.mlcs_my_school() and public.mlcs_my_role() not in ('student', 'parent'));
drop policy if exists wf_submissions_read on public.approval_submissions;
create policy wf_submissions_read on public.approval_submissions for select to authenticated
  using (school_id is not distinct from public.mlcs_my_school()
         and (public.wf_can_see_queue() or submitted_by = auth.uid() or assigned_reviewer = auth.uid()
              or public.mlcs_can_manage_course(course_id)));
drop policy if exists wf_history_read on public.approval_history;
create policy wf_history_read on public.approval_history for select to authenticated
  using (school_id is not distinct from public.mlcs_my_school()
         and (public.wf_can_see_queue() or actor_id = auth.uid() or public.mlcs_can_manage_course(course_id)));

revoke insert, update, delete, truncate on public.approval_settings, public.approval_stages,
  public.approval_submissions, public.approval_history from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Storage: students may only read files of published material (the old policy let any
--    student of the school read draft / pending files). Staff of the subject keep full access.
-- ---------------------------------------------------------------------------
create or replace function public.wf_can_read_material_object(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) = coalesce(public.mlcs_my_school()::text, '-')
    and (
      exists (select 1 from public.courses c where c.id::text = split_part(p_name, '/', 2) and public.mlcs_can_manage_course(c.id))
      or exists (
        select 1 from public.topic_materials mt
        where mt.storage_path = p_name and public.wf_chain_published('material', mt.id)
          and public.mlcs_my_role() = 'student')
    )
$$;

drop policy if exists mlcs_materials_obj_read on storage.objects;
create policy mlcs_materials_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'course-materials' and public.wf_can_read_material_object(name));

-- ---------------------------------------------------------------------------
-- 9. Function privileges. Internal helpers are NOT callable from the client (they trust their caller);
--    only the validated entry points below are. (Supabase grants new functions to anon/authenticated by default.)
-- ---------------------------------------------------------------------------
revoke all on function
  public.wf_item_context(text, uuid), public.wf_notify(uuid, text, text, text, uuid, text),
  public.wf_log(public.approval_submissions, text, text, text, text, text), public.wf_set_item_status(text, uuid, text),
  public.wf_publish_internal(uuid, text, text), public.wf_stage_reviewers(uuid, int), public.wf_chain_published(text, uuid),
  public.wf_course_of(text, uuid), public.wf_enabled(uuid), public.wf_can_review(public.approval_submissions),
  public.wf_content_guard(), public.wf_history_immutable(), public.wf_table_of(text)
  from public, anon, authenticated;

revoke all on function
  public.wf_submit(text, uuid, text, text), public.wf_review(uuid, text, text), public.wf_publish(uuid),
  public.wf_direct_publish(text, uuid, text), public.wf_assign(uuid, uuid), public.wf_withdraw(uuid),
  public.wf_reopen(text, uuid, text), public.wf_archive(text, uuid, text),
  public.wf_save_settings(boolean, boolean, text, boolean, jsonb), public.wf_send_reminders(int),
  public.wf_stats(), public.wf_queue(text, text, text, uuid, text, int, int), public.wf_submission_detail(uuid),
  public.wf_history(text, uuid), public.wf_reviewer_candidates(), public.wf_settings(),
  public.wf_can_see_queue(), public.wf_can_read_material_object(text), public.wf_is_admin_role(text)
  from public, anon;

grant execute on function
  public.wf_submit(text, uuid, text, text), public.wf_review(uuid, text, text), public.wf_publish(uuid),
  public.wf_direct_publish(text, uuid, text), public.wf_assign(uuid, uuid), public.wf_withdraw(uuid),
  public.wf_reopen(text, uuid, text), public.wf_archive(text, uuid, text),
  public.wf_save_settings(boolean, boolean, text, boolean, jsonb), public.wf_send_reminders(int),
  public.wf_stats(), public.wf_queue(text, text, text, uuid, text, int, int), public.wf_submission_detail(uuid),
  public.wf_history(text, uuid), public.wf_reviewer_candidates(), public.wf_settings(),
  public.wf_can_see_queue(), public.wf_can_read_material_object(text), public.wf_is_admin_role(text)
  to authenticated, service_role;
