-- TEST-ONLY stand-in for the parts of the Supabase project the migration depends on.
-- The real admission_* DDL isn't in the repo, so this mirrors src/integrations/supabase/types.ts.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role; -- Supabase default
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
create table public.schools (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (id uuid primary key default gen_random_uuid(), school_id uuid references public.schools(id),
  role text, erp_access boolean default false, created_at timestamptz default now());
create table public.governance_notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null,
  event_type text not null, title text not null, message text not null, reference_id uuid, reference_type text,
  channel text not null default 'in_app', is_read boolean not null default false, created_at timestamptz not null default now());
create table public.admission_intakes (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
  academic_year text not null, grade text not null, total_seats int not null default 30, is_open boolean not null default true);
create table public.admission_applicants (
  id uuid primary key default gen_random_uuid(), intake_id uuid not null references public.admission_intakes(id),
  school_id uuid not null, full_name text not null, date_of_birth date,
  gender text check (gender in ('male','female','other')), parent_name text not null, parent_phone text not null,
  parent_email text, address text, previous_school_name text, previous_grade text, previous_percentage numeric,
  sibling_studying_here boolean not null default false, distance_from_school_km numeric, category text,
  source text not null default 'walk_in' check (source in ('walk_in','referral','phone_enquiry','online_enquiry','other')),
  meeting_date date not null default current_date, meeting_notes text, priority_score numeric,
  status text not null default 'under_review', decision_notes text, decided_by uuid, decided_at timestamptz,
  recorded_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function public.adm_stub_school() returns trigger language plpgsql as $$
begin select school_id into new.school_id from public.admission_intakes where id = new.intake_id; return new; end $$;
create trigger t_school before insert on public.admission_applicants for each row execute function public.adm_stub_school();
create table public.admission_documents (id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.admission_applicants(id) on delete cascade, school_id uuid not null,
  document_type text not null check (document_type in ('report_card','birth_certificate','id_proof','transfer_certificate','photo','other')),
  file_path text not null, file_name text, uploaded_by uuid, uploaded_at timestamptz not null default now());
create function public.adm_stub_doc_school() returns trigger language plpgsql as $$
begin select school_id into new.school_id from public.admission_applicants where id = new.applicant_id; return new; end $$;
create trigger t_doc_school before insert on public.admission_documents for each row execute function public.adm_stub_doc_school();
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
