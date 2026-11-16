-- Content Studio: teacher prompt -> outline -> PPTX / flashcards / flowchart (Phase 1)

create table if not exists content_jobs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  subject text,
  class_level text,
  language text not null default 'en',
  slide_count int not null default 8,
  outputs text[] not null default '{}',
  outline jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'outline', 'rendering', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists content_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references content_jobs(id) on delete cascade,
  format text not null check (format in ('pptx', 'mermaid', 'flashcards')),
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists content_jobs_teacher_created_idx on content_jobs (teacher_id, created_at desc);
create index if not exists content_outputs_job_idx on content_outputs (job_id);

alter table content_jobs enable row level security;
alter table content_outputs enable row level security;

-- Teachers see and manage only their own jobs. The edge function writes with the service role.
drop policy if exists "teacher_view_own_content_jobs" on content_jobs;
create policy "teacher_view_own_content_jobs" on content_jobs
  for select using (teacher_id = auth.uid());

drop policy if exists "teacher_delete_own_content_jobs" on content_jobs;
create policy "teacher_delete_own_content_jobs" on content_jobs
  for delete using (teacher_id = auth.uid());

drop policy if exists "teacher_view_own_content_outputs" on content_outputs;
create policy "teacher_view_own_content_outputs" on content_outputs
  for select using (
    exists (select 1 from content_jobs j where j.id = content_outputs.job_id and j.teacher_id = auth.uid())
  );

-- Private bucket for generated files. Teachers get short-lived signed URLs from the edge function.
insert into storage.buckets (id, name, public)
values ('generated-content', 'generated-content', false)
on conflict (id) do nothing;
