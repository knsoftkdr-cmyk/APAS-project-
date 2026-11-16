-- =============================================================================
-- APAS - CRM & Admissions: bulk lead import history
--
-- Leads are the existing admission_applicants rows (written through the same table and RLS the Admissions screen
-- already uses), so this migration adds ONLY a small, append-only import log. No applicant columns are added or
-- changed. The log stores counts and row-number/error messages, never names, phones or emails, and never the file.
-- Idempotent: safe to run twice.
-- =============================================================================

create or replace function public.adm_imp_school() returns uuid
language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function public.adm_imp_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'principal', 'school_admin') from public.profiles where id = auth.uid()), false)
$$;

create table if not exists public.admission_import_jobs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  imported_by uuid references public.profiles(id) on delete set null,
  file_name text not null check (length(file_name) between 1 and 255),
  duplicate_mode text not null default 'skip' check (duplicate_mode in ('skip', 'update', 'review')),
  total_rows int not null check (total_rows >= 0),
  imported_count int not null default 0 check (imported_count >= 0),
  updated_count int not null default 0 check (updated_count >= 0),
  skipped_duplicates int not null default 0 check (skipped_duplicates >= 0),
  invalid_count int not null default 0 check (invalid_count >= 0),
  failed_count int not null default 0 check (failed_count >= 0),
  status text not null check (status in ('completed', 'completed_with_errors', 'failed')),
  error_report jsonb not null default '[]'::jsonb,   -- [{row, message}] only; no personal data
  created_at timestamptz not null default now(),
  constraint admission_import_jobs_counts_ok check (imported_count + updated_count + skipped_duplicates + invalid_count + failed_count <= total_rows)
);
create index if not exists idx_adm_import_jobs_school on public.admission_import_jobs(school_id, created_at desc);

alter table public.admission_import_jobs enable row level security;

drop policy if exists adm_import_jobs_read on public.admission_import_jobs;
create policy adm_import_jobs_read on public.admission_import_jobs for select to authenticated
  using (public.adm_imp_allowed() and school_id = public.adm_imp_school());

drop policy if exists adm_import_jobs_insert on public.admission_import_jobs;
create policy adm_import_jobs_insert on public.admission_import_jobs for insert to authenticated
  with check (public.adm_imp_allowed() and school_id = public.adm_imp_school() and imported_by = auth.uid());

-- history is append-only: no update or delete from the app
revoke update, delete, truncate on public.admission_import_jobs from anon, authenticated;
revoke all on public.admission_import_jobs from anon;
grant select, insert on public.admission_import_jobs to authenticated;
grant execute on function public.adm_imp_school(), public.adm_imp_allowed() to authenticated, service_role;
