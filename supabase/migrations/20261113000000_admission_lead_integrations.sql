-- ============================================================
-- Admissions: Lead Ads & Form Integrations
-- ============================================================
-- Lets APAS collect admission enquiries from Meta (Facebook / Instagram)
-- Lead Ads, Google Lead Form assets, Zoho CRM, website forms and
-- Zapier / Make, and turns each one into a row in the EXISTING
-- admission_applicants table (the CRM). Nothing about admission_applicants
-- itself is altered, so this is safe whether or not the PII-encryption
-- migration (supabase_migration_20260731_security_hardening.sql) has run:
-- the ingest function writes through public.decrypted_admission_applicants
-- when that view exists, and through the base table otherwise.
--
-- New objects
--   admission_integrations          one row per connected source (no secrets)
--   admission_integration_secrets   API credentials, AES-GCM encrypted by the
--                                   edge function; RLS on, NO client policy
--   admission_lead_meta             lead source / follow-up fields per applicant
--   admission_lead_events           per-lead activity timeline
--   admission_lead_ingestions       delivery log (idempotency + failure replay)
--   ingest_admission_lead(...)      the single, transactional entry point
-- ============================================================

-- ------------------------------------------------------------
-- 1. Integrations
-- ------------------------------------------------------------
create table if not exists public.admission_integrations (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete cascade,
  provider          text not null check (provider in ('meta','google','zoho','website','zapier','make')),
  name              text not null,
  status            text not null default 'active' check (status in ('active','paused','error')),
  -- Public identifier that goes in the webhook URL. NOT a credential on its own
  -- for meta / google / zoho / zapier / make (those also verify a secret).
  webhook_token     text not null unique
                      default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  default_intake_id uuid references public.admission_intakes(id) on delete set null,
  -- Non-secret settings: page_id, form_ids, allowed_origins, zoho dc, followup_hours, ...
  config            jsonb not null default '{}'::jsonb,
  -- Optional custom mapping { "student_name": "child_name", ... } (source field -> APAS field)
  field_mapping     jsonb not null default '{}'::jsonb,
  notify_emails     text[] not null default '{}',
  leads_received    bigint not null default 0,
  leads_created     bigint not null default 0,
  leads_duplicate   bigint not null default 0,
  leads_failed      bigint not null default 0,
  last_received_at  timestamptz,
  last_success_at   timestamptz,
  last_error        text,
  last_error_at     timestamptz,
  last_sync_at      timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_adm_integrations_school on public.admission_integrations(school_id);

create table if not exists public.admission_integration_secrets (
  integration_id uuid primary key references public.admission_integrations(id) on delete cascade,
  secrets_enc    text not null,
  updated_at     timestamptz not null default now()
);
alter table public.admission_integration_secrets enable row level security;
-- Deliberately no policies: only the service role (edge function) can read or write.
revoke all on public.admission_integration_secrets from anon, authenticated;

-- ------------------------------------------------------------
-- 2. Per-applicant lead metadata + follow-up tracking
-- ------------------------------------------------------------
create table if not exists public.admission_lead_meta (
  applicant_id       uuid primary key references public.admission_applicants(id) on delete cascade,
  school_id          uuid not null references public.schools(id) on delete cascade,
  integration_id     uuid references public.admission_integrations(id) on delete set null,
  lead_source        text not null check (lead_source in ('meta','google','zoho','website','zapier','make')),
  external_lead_id   text,
  campaign           jsonb not null default '{}'::jsonb,   -- ad / form / campaign ids, utm_*
  assigned_to        uuid references public.profiles(id) on delete set null,
  next_follow_up_at  timestamptz,
  last_contacted_at  timestamptz,
  enquiry_count      int not null default 1,
  last_enquiry_at    timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index if not exists idx_adm_lead_meta_school on public.admission_lead_meta(school_id);
create index if not exists idx_adm_lead_meta_followup on public.admission_lead_meta(school_id, next_follow_up_at);

create table if not exists public.admission_lead_events (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  applicant_id  uuid not null references public.admission_applicants(id) on delete cascade,
  integration_id uuid references public.admission_integrations(id) on delete set null,
  event_type    text not null check (event_type in
                  ('lead_created','repeat_enquiry','status_changed','follow_up_note','follow_up_scheduled','assigned')),
  detail        jsonb not null default '{}'::jsonb,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_adm_lead_events_applicant on public.admission_lead_events(applicant_id, created_at desc);

-- ------------------------------------------------------------
-- 3. Delivery log (idempotency + replay of failures)
-- ------------------------------------------------------------
create table if not exists public.admission_lead_ingestions (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  integration_id   uuid not null references public.admission_integrations(id) on delete cascade,
  external_lead_id text,
  status           text not null check (status in ('created','duplicate','failed','needs_review','test','rejected')),
  applicant_id     uuid references public.admission_applicants(id) on delete set null,
  error            text,
  -- Masked summary only (never raw phone / email) so the log is safe to show.
  summary          jsonb not null default '{}'::jsonb,
  -- Raw payload, encrypted by the edge function, kept ONLY for failed / needs_review
  -- rows so an admin can retry once the cause is fixed. Cleared on success.
  payload_enc      text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz
);
create index if not exists idx_adm_ingestions_integration on public.admission_lead_ingestions(integration_id, received_at desc);
create unique index if not exists uq_adm_ingestions_external
  on public.admission_lead_ingestions(integration_id, external_lead_id)
  where external_lead_id is not null and status in ('created','duplicate');

-- ------------------------------------------------------------
-- 4. RLS (school admissions staff; writes to integrations go through the edge function)
-- ------------------------------------------------------------
alter table public.admission_integrations     enable row level security;
alter table public.admission_lead_meta        enable row level security;
alter table public.admission_lead_events      enable row level security;
alter table public.admission_lead_ingestions  enable row level security;

create or replace function public.is_admission_staff(p_school uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'knsoft_admin'
           or (p.school_id = p_school and (p.role in ('principal','admin','school_admin') or p.erp_access is true)))
  );
$$;

create policy adm_integrations_select on public.admission_integrations
  for select using (public.is_admission_staff(school_id));
-- no insert/update/delete policy: managed only by the edge function (service role)

create policy adm_lead_meta_select on public.admission_lead_meta
  for select using (public.is_admission_staff(school_id));
create policy adm_lead_meta_update on public.admission_lead_meta
  for update using (public.is_admission_staff(school_id)) with check (public.is_admission_staff(school_id));

create policy adm_lead_events_select on public.admission_lead_events
  for select using (public.is_admission_staff(school_id));
create policy adm_lead_events_insert on public.admission_lead_events
  for insert with check (
    public.is_admission_staff(school_id)
    and event_type in ('follow_up_note','follow_up_scheduled','assigned')
  );

create policy adm_ingestions_select on public.admission_lead_ingestions
  for select using (public.is_admission_staff(school_id));

-- The encrypted payload column must never reach the browser: replace the table-wide
-- SELECT with a column-level grant that leaves payload_enc out.
revoke select on public.admission_lead_ingestions from anon, authenticated;
grant select (id, school_id, integration_id, external_lead_id, status, applicant_id, error, summary,
              received_at, processed_at)
  on public.admission_lead_ingestions to authenticated;

-- ------------------------------------------------------------
-- 5. Log status changes on integration-sourced leads into the timeline
-- ------------------------------------------------------------
create or replace function public.admission_lead_status_event()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status
     and exists (select 1 from public.admission_lead_meta m where m.applicant_id = new.id) then
    insert into public.admission_lead_events (school_id, applicant_id, event_type, detail, created_by)
    values (new.school_id, new.id, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status), auth.uid());
    update public.admission_lead_meta
       set last_contacted_at = coalesce(last_contacted_at, now())
     where applicant_id = new.id and new.status <> 'under_review';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_admission_lead_status_event on public.admission_applicants;
create trigger trg_admission_lead_status_event
  after update of status on public.admission_applicants
  for each row execute function public.admission_lead_status_event();

-- ------------------------------------------------------------
-- 6. Helpers
-- ------------------------------------------------------------
create or replace function public.adm_norm_phone(p text)
returns text language sql immutable as $$
  select case when length(d) = 0 then '' else right(d, 10) end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s;
$$;

create or replace function public.adm_norm_grade(p text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(lower(trim(coalesce(p, ''))), '^(grade|class|std|standard|gr)\.?\s*', ''),
           '[\s\-_\.]+', '', 'g');
$$;

create or replace function public.adm_norm_name(p text)
returns text language sql immutable as $$
  select regexp_replace(lower(trim(coalesce(p, ''))), '\s+', ' ', 'g');
$$;

-- ------------------------------------------------------------
-- 7. The ingest function — the only way leads enter the CRM
-- ------------------------------------------------------------
-- p_lead keys: student_name, parent_name, phone, email, grade, date_of_birth,
--              gender, address, previous_school, message, campaign (object)
-- Returns jsonb: { status: created|duplicate|failed|needs_review|rejected|rate_limited|idempotent,
--                  applicant_id, ingestion_id, error, notify_emails, summary }
create or replace function public.ingest_admission_lead(
  p_integration_id uuid,
  p_lead           jsonb,
  p_external_id    text default null,
  p_payload_enc    text default null,
  p_is_test        boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_int         public.admission_integrations%rowtype;
  v_target      text;
  v_ing         public.admission_lead_ingestions%rowtype;
  v_phone_raw   text := nullif(trim(coalesce(p_lead->>'phone','')), '');
  v_phone       text;
  v_email       text := nullif(lower(trim(coalesce(p_lead->>'email',''))), '');
  v_student     text := nullif(trim(coalesce(p_lead->>'student_name','')), '');
  v_parent      text := nullif(trim(coalesce(p_lead->>'parent_name','')), '');
  v_grade       text := nullif(trim(coalesce(p_lead->>'grade','')), '');
  v_gender      text;
  v_dob         date;
  v_intake      uuid;
  v_recorder    uuid;
  v_dup         uuid;
  v_new_id      uuid := gen_random_uuid();
  v_followup_h  int;
  v_notes       text;
  v_summary     jsonb;
  v_ing_id      uuid;
  v_label       text;
  v_recent      int;
  v_limit       int;
  v_err         text;
begin
  select * into v_int from public.admission_integrations where id = p_integration_id;
  if not found then
    return jsonb_build_object('status','failed','error','integration_not_found');
  end if;

  v_phone := public.adm_norm_phone(v_phone_raw);
  v_summary := jsonb_build_object(
    'student', case when v_student is null then null else left(v_student, 1) || repeat('•', greatest(length(v_student) - 1, 0)) end,
    'phone',   case when v_phone = '' then null else repeat('•', greatest(length(v_phone) - 3, 0)) || right(v_phone, 3) end,
    'email',   case when v_email is null then null else left(v_email, 1) || '•••@' || split_part(v_email, '@', 2) end,
    'grade',   v_grade);

  -- idempotency: the same delivery (Meta / Zapier retries) must not create or log twice
  if p_external_id is not null then
    select * into v_ing from public.admission_lead_ingestions
     where integration_id = p_integration_id and external_lead_id = p_external_id
     order by received_at desc limit 1;
    if found and v_ing.status in ('created','duplicate') then
      return jsonb_build_object('status','idempotent','applicant_id',v_ing.applicant_id,
                                'ingestion_id',v_ing.id,'notify_emails','[]'::jsonb);
    end if;
  end if;

  -- rate limit (per integration, per minute)
  v_limit := coalesce(nullif(v_int.config->>'rate_limit_per_min','')::int, 120);
  select count(*) into v_recent from public.admission_lead_ingestions
   where integration_id = p_integration_id and received_at > now() - interval '1 minute';
  if v_recent >= v_limit then
    return jsonb_build_object('status','rate_limited','error','too_many_requests');
  end if;

  -- (re)use the existing failed row on replay, otherwise open a new log row
  if v_ing.id is not null and v_ing.status in ('failed','needs_review') then
    v_ing_id := v_ing.id;
    update public.admission_lead_ingestions set received_at = now() where id = v_ing_id;
  else
    insert into public.admission_lead_ingestions (school_id, integration_id, external_lead_id, status, summary)
    values (v_int.school_id, v_int.id, p_external_id, 'failed', v_summary)
    returning id into v_ing_id;
  end if;

  update public.admission_integrations
     set leads_received = leads_received + 1, last_received_at = now()
   where id = v_int.id;

  if p_is_test then
    update public.admission_lead_ingestions
       set status = 'test', processed_at = now(), payload_enc = null, summary = v_summary where id = v_ing_id;
    return jsonb_build_object('status','test','ingestion_id',v_ing_id,'notify_emails','[]'::jsonb);
  end if;

  if v_int.status = 'paused' then
    update public.admission_lead_ingestions
       set status = 'rejected', error = 'integration_paused', processed_at = now() where id = v_ing_id;
    return jsonb_build_object('status','rejected','error','integration_paused','ingestion_id',v_ing_id);
  end if;

  -- ---- validation ------------------------------------------------------
  if v_phone = '' and v_email is null then
    v_err := 'missing_contact: lead has neither a phone number nor an email';
  elsif v_phone <> '' and length(v_phone) < 10 then
    v_err := 'invalid_phone: fewer than 10 digits';
  elsif v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_err := 'invalid_email';
  end if;
  if v_err is not null then
    update public.admission_lead_ingestions
       set status = 'failed', error = v_err, processed_at = now(), payload_enc = p_payload_enc where id = v_ing_id;
    update public.admission_integrations
       set leads_failed = leads_failed + 1, last_error = v_err, last_error_at = now() where id = v_int.id;
    return jsonb_build_object('status','failed','error',v_err,'ingestion_id',v_ing_id);
  end if;

  -- ---- target relation (decrypted view when PII encryption is on) ------
  v_target := case when to_regclass('public.decrypted_admission_applicants') is not null
                   then 'public.decrypted_admission_applicants' else 'public.admission_applicants' end;

  -- ---- duplicate detection --------------------------------------------
  -- Same school AND (same phone OR same email) AND (same student, or either name unknown).
  -- Two children of one parent are NOT duplicates of each other.
  execute format($q$
    select id from %s
     where school_id = $1
       and ( ($2 <> '' and public.adm_norm_phone(parent_phone) = $2)
          or ($3 is not null and lower(parent_email) = $3) )
       and ( $4 is null
          or public.adm_norm_name(full_name) = public.adm_norm_name($4)
          or full_name = 'Name not provided' )
     order by created_at asc limit 1 $q$, v_target)
    into v_dup using v_int.school_id, v_phone, v_email, v_student;

  if v_dup is not null then
    -- fill gaps on the existing record, never overwrite
    if v_email is not null then
      execute format('update %s set parent_email = $1 where id = $2 and (parent_email is null or parent_email = '''')', v_target)
        using v_email, v_dup;
    end if;
    update public.admission_lead_meta
       set enquiry_count = enquiry_count + 1, last_enquiry_at = now()
     where applicant_id = v_dup;
    insert into public.admission_lead_events (school_id, applicant_id, integration_id, event_type, detail)
    values (v_int.school_id, v_dup, v_int.id, 'repeat_enquiry',
            jsonb_build_object('provider', v_int.provider, 'integration', v_int.name, 'message', left(p_lead->>'message', 500)));
    update public.admission_lead_ingestions
       set status = 'duplicate', applicant_id = v_dup, processed_at = now(), payload_enc = null, error = null
     where id = v_ing_id;
    update public.admission_integrations
       set leads_duplicate = leads_duplicate + 1, last_success_at = now(), last_error = null, status = 'active'
     where id = v_int.id;

    v_label := coalesce(v_student, 'A student');
    insert into public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    select p.id, 'admission_lead_repeat', 'Repeat admission enquiry',
           v_label || ' enquired again via ' || v_int.name || ' (matched an existing applicant — no duplicate created).',
           v_dup, 'admission_applicant'
      from public.profiles p
     where p.school_id = v_int.school_id and p.role in ('principal','admin','school_admin');

    return jsonb_build_object('status','duplicate','applicant_id',v_dup,'ingestion_id',v_ing_id,
                              'notify_emails', to_jsonb(v_int.notify_emails), 'summary', v_summary,
                              'student', v_student, 'provider', v_int.provider, 'integration', v_int.name);
  end if;

  -- ---- intake -----------------------------------------------------------
  if v_grade is not null then
    select id into v_intake from public.admission_intakes
     where school_id = v_int.school_id and is_open
       and public.adm_norm_grade(grade) = public.adm_norm_grade(v_grade)
     order by academic_year desc limit 1;
  end if;
  if v_intake is null and v_int.default_intake_id is not null then
    -- tenant guard: the default intake must belong to the integration's own school
    select id into v_intake from public.admission_intakes
     where id = v_int.default_intake_id and school_id = v_int.school_id;
  end if;
  if v_intake is null then
    update public.admission_lead_ingestions
       set status = 'needs_review', processed_at = now(), payload_enc = p_payload_enc,
           error = 'no_open_intake: no open intake matches grade "' || coalesce(v_grade, '(none given)')
                   || '" and the integration has no default intake'
     where id = v_ing_id;
    update public.admission_integrations
       set leads_failed = leads_failed + 1, last_error = 'no_open_intake', last_error_at = now() where id = v_int.id;
    return jsonb_build_object('status','needs_review','error','no_open_intake','ingestion_id',v_ing_id);
  end if;

  -- ---- recorded_by (NOT NULL fk to profiles) ---------------------------
  v_recorder := v_int.created_by;
  if v_recorder is null then
    select id into v_recorder from public.profiles
     where school_id = v_int.school_id and role in ('principal','admin','school_admin') order by created_at limit 1;
  end if;
  if v_recorder is null then
    update public.admission_lead_ingestions
       set status = 'failed', error = 'no_recorder: school has no admin profile', processed_at = now(),
           payload_enc = p_payload_enc where id = v_ing_id;
    return jsonb_build_object('status','failed','error','no_recorder','ingestion_id',v_ing_id);
  end if;

  v_gender := case lower(coalesce(p_lead->>'gender',''))
                when 'male' then 'male' when 'm' then 'male' when 'boy' then 'male'
                when 'female' then 'female' when 'f' then 'female' when 'girl' then 'female'
                when '' then null else 'other' end;
  begin
    v_dob := nullif(p_lead->>'date_of_birth','')::date;
  exception when others then v_dob := null;
  end;
  v_notes := 'Via ' || v_int.name || ' (' || v_int.provider || ')'
             || coalesce(E'\n' || left(nullif(p_lead->>'message',''), 1000), '');

  begin
    execute format($q$
      insert into %s (id, intake_id, full_name, date_of_birth, gender, parent_name, parent_phone, parent_email,
                      address, previous_school_name, source, meeting_date, meeting_notes, status, recorded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'online_enquiry',current_date,$11,'under_review',$12) $q$, v_target)
      using v_new_id, v_intake, coalesce(v_student, 'Name not provided'), v_dob, v_gender,
            coalesce(v_parent, 'Not provided'), coalesce(v_phone_raw, ''), v_email,
            nullif(trim(coalesce(p_lead->>'address','')), ''),
            nullif(trim(coalesce(p_lead->>'previous_school','')), ''), v_notes, v_recorder;
  exception when others then
    v_err := 'insert_failed: ' || sqlerrm;
    update public.admission_lead_ingestions
       set status = 'failed', error = v_err, processed_at = now(), payload_enc = p_payload_enc where id = v_ing_id;
    update public.admission_integrations
       set leads_failed = leads_failed + 1, last_error = v_err, last_error_at = now() where id = v_int.id;
    return jsonb_build_object('status','failed','error',v_err,'ingestion_id',v_ing_id);
  end;

  v_followup_h := coalesce(nullif(v_int.config->>'followup_hours','')::int, 24);
  insert into public.admission_lead_meta
    (applicant_id, school_id, integration_id, lead_source, external_lead_id, campaign, next_follow_up_at)
  values (v_new_id, v_int.school_id, v_int.id, v_int.provider, p_external_id,
          coalesce(p_lead->'campaign', '{}'::jsonb), now() + make_interval(hours => v_followup_h));

  insert into public.admission_lead_events (school_id, applicant_id, integration_id, event_type, detail)
  values (v_int.school_id, v_new_id, v_int.id, 'lead_created',
          jsonb_build_object('provider', v_int.provider, 'integration', v_int.name, 'external_id', p_external_id));

  update public.admission_lead_ingestions
     set status = 'created', applicant_id = v_new_id, processed_at = now(), payload_enc = null, error = null
   where id = v_ing_id;
  update public.admission_integrations
     set leads_created = leads_created + 1, last_success_at = now(), last_error = null, status = 'active'
   where id = v_int.id;

  -- in-app notification to the admissions team (or the integration's chosen recipients)
  insert into public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
  select p.id, 'admission_lead', 'New admission enquiry',
         coalesce(v_student, 'New lead') || coalesce(' · ' || v_grade, '') || ' — parent '
           || coalesce(v_parent, 'not given') || ' (via ' || v_int.name || ')',
         v_new_id, 'admission_applicant'
    from public.profiles p
   where p.school_id = v_int.school_id
     and ( (jsonb_typeof(v_int.config->'notify_user_ids') = 'array'
            and jsonb_array_length(v_int.config->'notify_user_ids') > 0
            and p.id::text in (select jsonb_array_elements_text(v_int.config->'notify_user_ids')))
        or ((jsonb_typeof(v_int.config->'notify_user_ids') is distinct from 'array'
             or jsonb_array_length(v_int.config->'notify_user_ids') = 0)
            and p.role in ('principal','admin','school_admin')) );

  return jsonb_build_object('status','created','applicant_id',v_new_id,'ingestion_id',v_ing_id,
                            'notify_emails', to_jsonb(v_int.notify_emails), 'summary', v_summary,
                            'student', v_student, 'grade', v_grade, 'parent', v_parent,
                            'provider', v_int.provider, 'integration', v_int.name);
end;
$$;

revoke all on function public.ingest_admission_lead(uuid, jsonb, text, text, boolean) from public, anon, authenticated;
grant execute on function public.ingest_admission_lead(uuid, jsonb, text, text, boolean) to service_role;

-- keep updated_at fresh on integrations
create or replace function public.adm_integrations_touch()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_adm_integrations_touch on public.admission_integrations;
create trigger trg_adm_integrations_touch before update on public.admission_integrations
  for each row execute function public.adm_integrations_touch();
