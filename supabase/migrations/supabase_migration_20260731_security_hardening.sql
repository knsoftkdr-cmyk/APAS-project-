-- ============================================================
-- Admission Module — Security Hardening
-- ============================================================
-- Adds:
--   1. Field-level encryption of PII on admission_applicants
--      (full_name, parent_name, parent_phone, parent_email, address)
--      using pgsodium Transparent Column Encryption.
--   2. admission_document_views — an audit log of who viewed which
--      uploaded document, and when.
--
-- IMPORTANT — run this in a staging/dev Supabase project first.
-- Step 1 is NOT idempotent-safe to re-run blindly (it rewrites the
-- table). Take a backup before running against production data.
-- ============================================================

-- ------------------------------------------------------------
-- STEP 1a — enable pgsodium and create the encryption key
-- ------------------------------------------------------------
create extension if not exists pgsodium;

select pgsodium.create_key(name := 'admission_pii_key');

-- Run this SELECT on its own, copy the id it returns, and use it as
-- <KEY_ID> in every "SECURITY LABEL" statement below (step 1b).
select id, name from pgsodium.valid_key where name = 'admission_pii_key';

-- ------------------------------------------------------------
-- STEP 1b — encrypt the PII columns
-- ------------------------------------------------------------
-- Replace <KEY_ID> below with the uuid you copied above, in all 5
-- statements, then run them. Each column is bound (ASSOCIATED) to
-- the row's own id, so ciphertext from one row can never be copied
-- into another row and decrypt successfully there.

security label for pgsodium
  on column public.admission_applicants.full_name
  is 'ENCRYPT WITH KEY ID 6e91fe0c-6e81-4e83-a600-c19b011548b2 ASSOCIATED (id)';

security label for pgsodium
  on column public.admission_applicants.parent_name
  is 'ENCRYPT WITH KEY ID 6e91fe0c-6e81-4e83-a600-c19b011548b2 ASSOCIATED (id)';

security label for pgsodium
  on column public.admission_applicants.parent_phone
  is 'ENCRYPT WITH KEY ID 6e91fe0c-6e81-4e83-a600-c19b011548b2 ASSOCIATED (id)';

security label for pgsodium
  on column public.admission_applicants.parent_email
  is 'ENCRYPT WITH KEY ID 6e91fe0c-6e81-4e83-a600-c19b011548b2 ASSOCIATED (id) NULLABLE';

security label for pgsodium
  on column public.admission_applicants.address
  is 'ENCRYPT WITH KEY ID 6e91fe0c-6e81-4e83-a600-c19b011548b2 ASSOCIATED (id) NULLABLE';

-- pgsodium's event trigger now does the following automatically:
--   - the 5 columns above are re-typed to store ciphertext (bytea)
--   - a view public.decrypted_admission_applicants is created, with
--     every column from admission_applicants, but full_name /
--     parent_name / parent_phone / parent_email / address are
--     transparently decrypted plaintext
--   - INSTEAD OF INSERT/UPDATE triggers on that view transparently
--     encrypt those 5 columns when you write through the view
--
-- From here on, the app must read AND write through
-- public.decrypted_admission_applicants instead of the base table
-- directly (see the app-code changes that go with this migration).

-- ------------------------------------------------------------
-- STEP 1c — SAFETY CHECK: force the view to respect RLS
-- ------------------------------------------------------------
-- The view must run with the QUERYING user's own permissions, not
-- the view owner's — otherwise RLS on admission_applicants (which is
-- what keeps one school from seeing another school's applicants)
-- would be silently bypassed for everyone who queries the view
-- instead of the base table. Do not skip this step.
alter view public.decrypted_admission_applicants set (security_invoker = true);

-- Verify: reloptions below should show security_invoker=true.
-- If this view doesn't exist yet, step 1b above didn't complete —
-- go back and confirm every SECURITY LABEL statement succeeded.
select relname, reloptions
from pg_class
where relname = 'decrypted_admission_applicants';

-- ------------------------------------------------------------
-- STEP 1d — PostgREST embedding hints
-- ------------------------------------------------------------
-- The app's existing queries embed the related intake and a document
-- count (e.g. .select("*, intake:admission_intakes(...), documents:
-- admission_documents(count)")). PostgREST normally figures out those
-- relationships from real foreign key constraints, but a plain view
-- doesn't carry FKs of its own, so we hint them explicitly.
comment on column public.decrypted_admission_applicants.intake_id
  is e'@foreignKey (intake_id) references admission_intakes(id)';

comment on column public.admission_documents.applicant_id
  is e'@foreignKey (applicant_id) references decrypted_admission_applicants(id)';

-- After running this migration, test the exact query the app uses
-- (select * from decrypted_admission_applicants with the intake and
-- documents embeds) directly in the SQL editor or via the API. If an
-- embed still fails to resolve, the fallback is to fetch the two
-- pieces with separate queries and join them in the app instead of
-- relying on embedding through the view.

-- ------------------------------------------------------------
-- STEP 2 — admission_document_views (audit log)
-- ------------------------------------------------------------
create table public.admission_document_views (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.admission_documents(id) on delete cascade,
  school_id    uuid not null references public.schools(id) on delete cascade, -- kept in sync via trigger below
  viewed_by    uuid references public.profiles(id) on delete set null,
  viewed_at    timestamptz not null default now()
);

create index idx_admission_document_views_document on public.admission_document_views(document_id);
create index idx_admission_document_views_school on public.admission_document_views(school_id);

create or replace function public.admission_document_views_sync_school_id()
returns trigger
language plpgsql
as $$
begin
  select school_id into new.school_id
  from public.admission_documents
  where id = new.document_id;

  return new;
end;
$$;

create trigger trg_admission_document_views_sync_school_id
  before insert on public.admission_document_views
  for each row execute function public.admission_document_views_sync_school_id();

alter table public.admission_document_views enable row level security;

create policy "knsoft_admin_all_document_views"
  on public.admission_document_views for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'knsoft_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'knsoft_admin'));

create policy "school_staff_manage_own_document_views"
  on public.admission_document_views for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('principal', 'admin', 'school_admin')
        and p.school_id = admission_document_views.school_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('principal', 'admin', 'school_admin')
        and p.school_id = admission_document_views.school_id
    )
  );