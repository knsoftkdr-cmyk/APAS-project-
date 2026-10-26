-- Teacher suite part 2 (sheet rows 44, 45, 46, 47). No new edge function (deployment limit):
--   evaluate-assessment  action review_open_response (+ teacher_rubric)   -> open_response_submissions.teacher_rubric_scores
--   evaluate-assessment  action bulk_review (preview / apply / undo)      -> exam_review_batches
--   ai-teacher-assistant action differentiate                             -> differentiation_packs (+ classroom_materials kind 'text')
--   Intervention board: client reads/writes student_interventions under its EXISTING RLS policies (two new columns).

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 44. Interactive rubric grading: the teacher's per-criterion marks, comment and evidence quote.
--     [{ criterion, max_marks, awarded, comment, evidence }]
alter table public.open_response_submissions
  add column if not exists teacher_rubric_scores jsonb;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 45. Bulk actions: every batch keeps the previous values of everything it changed, so it can be undone.
create table if not exists public.exam_review_batches (
  id            uuid primary key default gen_random_uuid(),
  performed_by  uuid not null references public.profiles(id) on delete cascade,
  action        text not null check (action in ('accept_ai')),
  feedback      text,
  attempt_ids   uuid[] not null,
  changed_count int not null default 0,
  skipped       jsonb not null default '[]'::jsonb,   -- [{submission_id, reason}]
  previous      jsonb not null default '{}'::jsonb,   -- {submissions:[...], attempts:[...]}
  created_at    timestamptz not null default now(),
  undone_at     timestamptz,
  undone_by     uuid
);
create index if not exists exam_review_batches_user on public.exam_review_batches (performed_by, created_at desc);
alter table public.exam_review_batches enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 46. AI-assisted differentiation: saved packs of the same lesson material at different levels / needs.
create table if not exists public.differentiation_packs (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  school_id   uuid,
  class_id    uuid references public.classes(id) on delete set null,
  topic       text not null,
  subject     text,
  grade       text,
  material_type text not null,
  request     jsonb not null default '{}'::jsonb,
  versions    jsonb not null default '[]'::jsonb,
  model       text,
  created_at  timestamptz not null default now()
);
create index if not exists differentiation_packs_teacher on public.differentiation_packs (teacher_id, created_at desc);
alter table public.differentiation_packs enable row level security;

-- Classroom materials can now also be plain text (e.g. a differentiated version shared with the class).
alter table public.classroom_materials add column if not exists body text;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.classroom_materials'::regclass and contype = 'c' loop
    execute format('alter table public.classroom_materials drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.classroom_materials
  add constraint classroom_materials_title_check check (length(btrim(title)) > 0),
  add constraint classroom_materials_kind_check check (kind in ('file','link','text')),
  add constraint classroom_materials_payload_check check (
    (kind = 'link' and url is not null) or (kind = 'file' and storage_path is not null) or (kind = 'text' and body is not null));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 47. Student intervention board: which plan steps are done, and dated check-in notes.
alter table public.student_interventions
  add column if not exists action_progress jsonb not null default '{}'::jsonb,  -- { "<action>": { "done": true, "at": iso } }
  add column if not exists check_ins       jsonb not null default '[]'::jsonb;  -- [{ at, by, note }]
