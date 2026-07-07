-- Question papers: one row per assessment's question paper, uploaded once and
-- reused across every student's answer sheet for that same assessment.
create table if not exists public.assessment_papers (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id),
  title text,
  class_level text,
  section text,
  subject text,
  file_path text not null,
  file_name text not null,
  file_type text,
  created_at timestamptz not null default now()
);

alter table public.assessment_papers enable row level security;

drop policy if exists "Teachers manage their own question papers" on public.assessment_papers;
create policy "Teachers manage their own question papers"
  on public.assessment_papers
  for all
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

-- Link each student answer-sheet evaluation to the question paper it belongs to.
alter table public.assessment_evaluations
  add column if not exists assessment_paper_id uuid references public.assessment_papers(id);

-- Private storage bucket for question paper files (mirrors assessment-evaluations bucket).
insert into storage.buckets (id, name, public)
values ('assessment-question-papers', 'assessment-question-papers', false)
on conflict (id) do nothing;

drop policy if exists "Teachers manage own question paper files" on storage.objects;
create policy "Teachers manage own question paper files"
  on storage.objects
  for all
  using (
    bucket_id = 'assessment-question-papers'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'assessment-question-papers'
    and auth.uid()::text = (storage.foldername(name))[1]
  );