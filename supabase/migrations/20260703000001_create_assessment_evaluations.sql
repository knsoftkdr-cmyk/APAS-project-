create table public.assessment_evaluations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_name text not null,
  class_level text,
  section text,
  subject text,
  file_path text not null,
  file_name text not null,
  file_type text,
  status text not null default 'pending',
  ai_score numeric,
  ai_feedback text,
  ai_per_activity jsonb,
  ai_topic_analysis jsonb,
  ai_study_plan jsonb,
  ai_reviewed_at timestamptz,
  score numeric,
  teacher_feedback text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assessment_evaluations enable row level security;

create policy "Teachers manage their own assessment evaluations"
  on public.assessment_evaluations
  for all
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

create index idx_assessment_evaluations_teacher on public.assessment_evaluations(teacher_id);
create index idx_assessment_evaluations_status on public.assessment_evaluations(status);

insert into storage.buckets (id, name, public)
values ('assessment-evaluations', 'assessment-evaluations', false);

create policy "Teachers upload their own assessment files"
  on storage.objects for insert
  with check (
    bucket_id = 'assessment-evaluations'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Teachers read their own assessment files"
  on storage.objects for select
  using (
    bucket_id = 'assessment-evaluations'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Teachers delete their own assessment files"
  on storage.objects for delete
  using (
    bucket_id = 'assessment-evaluations'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
