-- =============================================================================
-- APAS - CRM & Admissions: Click-to-Call and telephony
--
-- Leads are the existing admission_applicants rows. This migration adds ONLY the telephony side:
--   telephony_school_settings  per-school switch + caller id + recording policy (NO credentials: those are Supabase secrets)
--   telephony_staff            each counsellor's own phone (the provider rings it first) + optional allow/deny override
--   admission_calls            one row per call (outgoing or incoming), written only by the server
--   admission_call_events      provider callbacks, de-duplicated (idempotent webhooks)
--   admission_call_notes       what was discussed
--   admission_call_followups   next-call reminders (the existing governance_notifications inbox is used to remind)
--   telephony_recording_access_log   who played which recording
--
-- No applicant column or policy is changed. applicant_id deliberately has no hard foreign key because admission_applicants is
-- managed outside this repo's migrations; every function checks that the applicant belongs to the caller's school instead.
-- Idempotent: safe to run twice.
-- =============================================================================

-- ---------------------------------------------------------------------------------------------------------------------
-- Who is who
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.tel_school() returns uuid
language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid()
$$;

-- May this user place / see calls? Admission roles by default; telephony_staff.can_call_override true/false overrides that.
create or replace function public.tel_user_can_call(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_override boolean; v_role text;
begin
  select can_call_override into v_override from public.telephony_staff where user_id = p_user;
  if v_override is not null then return v_override; end if;
  select role into v_role from public.profiles where id = p_user;
  return coalesce(v_role in ('admin', 'principal', 'school_admin'), false);
end $$;

create or replace function public.tel_is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'principal', 'school_admin') from public.profiles where id = p_user), false)
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.telephony_school_settings (
  school_id uuid primary key,
  provider text not null default 'exotel' check (provider in ('exotel', 'airtel_iq')),
  enabled boolean not null default false,
  caller_id text check (caller_id is null or caller_id ~ '^\+?[0-9]{8,15}$'),          -- the school's ExoPhone (not a secret)
  recording_enabled boolean not null default false,                                    -- master switch; each call still opts in
  recording_retention_days int not null default 90 check (recording_retention_days between 1 and 3650),
  timezone text not null default 'Asia/Kolkata',
  call_window_start time not null default '09:00',                                     -- no outbound calls outside this window
  call_window_end time not null default '21:00',
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.telephony_staff (
  user_id uuid primary key,
  school_id uuid not null,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),                 -- E.164; the number the provider rings first
  can_call_override boolean,                                                           -- null = follow the role default
  updated_at timestamptz not null default now()
);
create index if not exists idx_tel_staff_school on public.telephony_staff(school_id);

create table if not exists public.admission_calls (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  applicant_id uuid not null,
  staff_id uuid,                                                                       -- null for an incoming call nobody answered
  provider text not null check (provider in ('exotel', 'airtel_iq')),
  provider_call_id text,
  direction text not null check (direction in ('outbound', 'inbound')),
  status text not null default 'initiating'
    check (status in ('initiating', 'ringing', 'connected', 'completed', 'missed', 'busy', 'failed', 'cancelled')),
  phone text not null,                                                                 -- the parent's number, E.164
  staff_phone text,
  recording_requested boolean not null default false,
  recording_available boolean not null default false,
  recording_ref text,                                                                  -- provider URL: server-only, never granted to clients
  failure_reason text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  conversation_seconds int check (conversation_seconds is null or conversation_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_admission_calls_provider on public.admission_calls(provider, provider_call_id) where provider_call_id is not null;
create index if not exists idx_admission_calls_lead on public.admission_calls(school_id, applicant_id, created_at desc);
create index if not exists idx_admission_calls_staff on public.admission_calls(school_id, staff_id, created_at desc);

create table if not exists public.admission_call_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.admission_calls(id) on delete cascade,
  dedupe_key text not null unique,
  event_type text not null,
  status text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists idx_admission_call_events_call on public.admission_call_events(call_id, received_at);

create table if not exists public.admission_call_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  applicant_id uuid not null,
  call_id uuid references public.admission_calls(id) on delete set null,
  author_id uuid not null,
  note text not null check (length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_admission_call_notes_lead on public.admission_call_notes(school_id, applicant_id, created_at desc);

create table if not exists public.admission_call_followups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  applicant_id uuid not null,
  call_id uuid references public.admission_calls(id) on delete set null,
  assigned_to uuid not null,
  due_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_admission_followups_school on public.admission_call_followups(school_id, status, due_at);
create index if not exists idx_admission_followups_lead on public.admission_call_followups(school_id, applicant_id);

create table if not exists public.telephony_recording_access_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  call_id uuid not null references public.admission_calls(id) on delete cascade,
  accessed_by uuid not null,
  accessed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------------------
-- RLS: clients may READ their own school's data if allowed; every write goes through the functions below
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.telephony_school_settings enable row level security;
alter table public.telephony_staff enable row level security;
alter table public.admission_calls enable row level security;
alter table public.admission_call_events enable row level security;
alter table public.admission_call_notes enable row level security;
alter table public.admission_call_followups enable row level security;
alter table public.telephony_recording_access_log enable row level security;

drop policy if exists tel_settings_read on public.telephony_school_settings;
create policy tel_settings_read on public.telephony_school_settings for select to authenticated
  using (school_id = public.tel_school() and public.tel_user_can_call(auth.uid()));

drop policy if exists tel_staff_read on public.telephony_staff;
create policy tel_staff_read on public.telephony_staff for select to authenticated
  using (school_id = public.tel_school() and (user_id = auth.uid() or public.tel_is_admin(auth.uid())));

drop policy if exists tel_calls_read on public.admission_calls;
create policy tel_calls_read on public.admission_calls for select to authenticated
  using (school_id = public.tel_school() and public.tel_user_can_call(auth.uid()));

drop policy if exists tel_notes_read on public.admission_call_notes;
create policy tel_notes_read on public.admission_call_notes for select to authenticated
  using (school_id = public.tel_school() and public.tel_user_can_call(auth.uid()));

drop policy if exists tel_followups_read on public.admission_call_followups;
create policy tel_followups_read on public.admission_call_followups for select to authenticated
  using (school_id = public.tel_school() and public.tel_user_can_call(auth.uid()));

drop policy if exists tel_reclog_read on public.telephony_recording_access_log;
create policy tel_reclog_read on public.telephony_recording_access_log for select to authenticated
  using (school_id = public.tel_school() and public.tel_is_admin(auth.uid()));

-- Clients get read-only access; events are server-only; recording_ref (the provider URL) is never readable by a browser.
revoke all on public.telephony_school_settings, public.telephony_staff, public.admission_calls, public.admission_call_events,
  public.admission_call_notes, public.admission_call_followups, public.telephony_recording_access_log from anon, authenticated;
grant select on public.telephony_school_settings, public.telephony_staff, public.admission_call_notes,
  public.admission_call_followups, public.telephony_recording_access_log to authenticated;
grant select (id, school_id, applicant_id, staff_id, provider, provider_call_id, direction, status, phone, staff_phone,
  recording_requested, recording_available, failure_reason, started_at, answered_at, ended_at, duration_seconds,
  conversation_seconds, created_at, updated_at) on public.admission_calls to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.tel_last10(p text) returns text
language sql immutable as $$ select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10) $$;

create or replace function public.tel_applicant_in_school(p_applicant uuid, p_school uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  execute 'select exists(select 1 from public.admission_applicants where id = $1 and school_id = $2)' into v using p_applicant, p_school;
  return coalesce(v, false);
end $$;

create or replace function public.tel_status_rank(p text) returns int
language sql immutable as $$
  select case p when 'initiating' then 0 when 'ringing' then 1 when 'connected' then 2 else 3 end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Settings and staff (admin-managed; credentials are NOT stored here)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.tel_save_settings(
  p_enabled boolean, p_provider text, p_caller_id text, p_recording_enabled boolean, p_retention_days int,
  p_timezone text, p_window_start time, p_window_end time
) returns void language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.tel_school();
begin
  if v_school is null or not public.tel_is_admin(auth.uid()) then raise exception 'not permitted'; end if;
  if p_provider not in ('exotel', 'airtel_iq') then raise exception 'unknown provider'; end if;
  if p_caller_id is not null and p_caller_id !~ '^\+?[0-9]{8,15}$' then raise exception 'caller id must be a phone number'; end if;
  if p_enabled and p_caller_id is null then raise exception 'set the school caller id (ExoPhone) before enabling calling'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then raise exception 'unknown timezone'; end if;
  if p_window_start >= p_window_end then raise exception 'call window start must be before its end'; end if;
  insert into public.telephony_school_settings(school_id, provider, enabled, caller_id, recording_enabled, recording_retention_days,
    timezone, call_window_start, call_window_end, updated_by, updated_at)
  values (v_school, p_provider, p_enabled, p_caller_id, p_recording_enabled, coalesce(p_retention_days, 90), p_timezone,
    p_window_start, p_window_end, auth.uid(), now())
  on conflict (school_id) do update set provider = excluded.provider, enabled = excluded.enabled, caller_id = excluded.caller_id,
    recording_enabled = excluded.recording_enabled, recording_retention_days = excluded.recording_retention_days,
    timezone = excluded.timezone, call_window_start = excluded.call_window_start, call_window_end = excluded.call_window_end,
    updated_by = excluded.updated_by, updated_at = now();
end $$;

create or replace function public.tel_set_my_phone(p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.tel_school();
begin
  if v_school is null or not public.tel_user_can_call(auth.uid()) then raise exception 'not permitted'; end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone must be in international format, e.g. +919876543210'; end if;
  insert into public.telephony_staff(user_id, school_id, phone, updated_at) values (auth.uid(), v_school, p_phone, now())
  on conflict (user_id) do update set phone = excluded.phone, updated_at = now();
end $$;

create or replace function public.tel_set_staff_access(p_user uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.tel_school();
begin
  if v_school is null or not public.tel_is_admin(auth.uid()) then raise exception 'not permitted'; end if;
  if not exists (select 1 from public.profiles where id = p_user and school_id = v_school) then raise exception 'user is not in your school'; end if;
  insert into public.telephony_staff(user_id, school_id, can_call_override, updated_at) values (p_user, v_school, p_allowed, now())
  on conflict (user_id) do update set can_call_override = excluded.can_call_override, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Server-only call lifecycle (service_role). The edge function authenticates the browser user, looks the applicant up and
-- passes trusted ids in; these functions enforce permission, calling window, rate limit and duplicate-call rules atomically.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.tel_begin_call(
  p_school uuid, p_staff uuid, p_applicant uuid, p_provider text, p_phone text, p_staff_phone text, p_record boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.telephony_school_settings%rowtype;
  v_local time; v_existing uuid; v_id uuid; v_recent int;
begin
  select * into s from public.telephony_school_settings where school_id = p_school;
  if not found or not s.enabled then return jsonb_build_object('status', 'not_enabled'); end if;
  if not exists (select 1 from public.profiles where id = p_staff and school_id = p_school) or not public.tel_user_can_call(p_staff) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not public.tel_applicant_in_school(p_applicant, p_school) then return jsonb_build_object('status', 'forbidden'); end if;
  if s.provider <> p_provider then return jsonb_build_object('status', 'provider_mismatch'); end if;

  v_local := (now() at time zone s.timezone)::time;
  if v_local < s.call_window_start or v_local >= s.call_window_end then
    return jsonb_build_object('status', 'outside_window', 'window_start', s.call_window_start, 'window_end', s.call_window_end);
  end if;

  perform pg_advisory_xact_lock(hashtext('tel_call:' || p_applicant::text));

  select id into v_existing from public.admission_calls
   where school_id = p_school and applicant_id = p_applicant and status in ('initiating', 'ringing', 'connected')
     and created_at > now() - interval '5 minutes' limit 1;
  if v_existing is not null then return jsonb_build_object('status', 'duplicate', 'call_id', v_existing); end if;

  select count(*) into v_recent from public.admission_calls where staff_id = p_staff and created_at > now() - interval '1 minute';
  if v_recent >= 5 then return jsonb_build_object('status', 'rate_limited'); end if;

  insert into public.admission_calls(school_id, applicant_id, staff_id, provider, direction, status, phone, staff_phone, recording_requested)
  values (p_school, p_applicant, p_staff, p_provider, 'outbound', 'initiating', p_phone, p_staff_phone,
          coalesce(p_record, false) and s.recording_enabled)
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'call_id', v_id, 'caller_id', s.caller_id, 'recording', coalesce(p_record, false) and s.recording_enabled);
end $$;

create or replace function public.tel_mark_dialed(p_call uuid, p_provider_call_id text) returns void
language sql security definer set search_path = public as $$
  update public.admission_calls set provider_call_id = coalesce(provider_call_id, p_provider_call_id), updated_at = now()
   where id = p_call and status = 'initiating'
$$;

create or replace function public.tel_fail_call(p_call uuid, p_reason text) returns void
language sql security definer set search_path = public as $$
  update public.admission_calls set status = 'failed', failure_reason = left(p_reason, 300), ended_at = coalesce(ended_at, now()), updated_at = now()
   where id = p_call and status in ('initiating', 'ringing')
$$;

-- Staff cancelling a call the provider has not accepted yet
create or replace function public.tel_cancel_call(p_call uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c public.admission_calls%rowtype;
begin
  select * into c from public.admission_calls where id = p_call;
  if not found or c.school_id is distinct from public.tel_school() then raise exception 'not permitted'; end if;
  if not (c.staff_id = auth.uid() or public.tel_is_admin(auth.uid())) then raise exception 'not permitted'; end if;
  if c.status <> 'initiating' or c.provider_call_id is not null then return 'too_late'; end if;
  update public.admission_calls set status = 'cancelled', ended_at = now(), updated_at = now() where id = p_call;
  return 'cancelled';
end $$;

-- One provider event. Idempotent (dedupe key), order-safe (a status never goes backwards, a finished call never reopens).
create or replace function public.tel_record_event(
  p_provider text, p_provider_call_id text, p_dedupe_key text, p_event_type text, p_status text,
  p_started timestamptz, p_answered timestamptz, p_ended timestamptz, p_duration int, p_conversation int,
  p_recording_ref text, p_failure text, p_payload jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare c public.admission_calls%rowtype; v_new text; v_ins int;
begin
  if p_status is not null and p_status not in ('initiating', 'ringing', 'connected', 'completed', 'missed', 'busy', 'failed', 'cancelled') then
    return 'invalid';
  end if;
  select * into c from public.admission_calls where provider = p_provider and provider_call_id = p_provider_call_id for update;
  if not found then return 'unknown_call'; end if;

  insert into public.admission_call_events(call_id, dedupe_key, event_type, status, payload)
  values (c.id, p_dedupe_key, left(p_event_type, 60), p_status, coalesce(p_payload, '{}'::jsonb))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then return 'duplicate'; end if;

  v_new := c.status;
  if p_status is not null then
    if public.tel_status_rank(c.status) = 3 then v_new := c.status;                       -- already finished: keep, only fill details
    elsif public.tel_status_rank(p_status) >= public.tel_status_rank(c.status) then v_new := p_status;
    end if;
  end if;

  update public.admission_calls set
    status = v_new,
    started_at = coalesce(started_at, p_started),
    answered_at = coalesce(answered_at, p_answered),
    ended_at = coalesce(ended_at, p_ended),
    duration_seconds = coalesce(p_duration, duration_seconds),
    conversation_seconds = coalesce(p_conversation, conversation_seconds),
    recording_ref = case when recording_requested and p_recording_ref is not null then p_recording_ref else recording_ref end,
    recording_available = recording_available or (recording_requested and p_recording_ref is not null),
    failure_reason = coalesce(failure_reason, left(p_failure, 300)),
    updated_at = now()
  where id = c.id;
  return case when v_new = c.status and p_status is not null and p_status <> c.status then 'stale' else 'applied' end;
end $$;

-- Incoming call (where the provider reports it): matched to a school by the called ExoPhone and to a lead by the caller's number
create or replace function public.tel_record_inbound(
  p_provider text, p_provider_call_id text, p_from text, p_to text, p_dedupe_key text, p_status text,
  p_started timestamptz, p_ended timestamptz, p_duration int, p_payload jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_app uuid; v_id uuid; v_ins int;
begin
  if p_status not in ('ringing', 'connected', 'completed', 'missed', 'busy', 'failed') then return 'invalid'; end if;
  select school_id into v_school from public.telephony_school_settings
   where enabled and provider = p_provider and public.tel_last10(caller_id) = public.tel_last10(p_to) limit 1;
  if v_school is null then return 'no_school'; end if;
  execute 'select id from public.admission_applicants where school_id = $1 and right(regexp_replace(coalesce(parent_phone, ''''), ''\D'', '''', ''g''), 10) = $2 order by created_at desc limit 1'
    into v_app using v_school, public.tel_last10(p_from);
  if v_app is null then return 'no_lead'; end if;

  select id into v_id from public.admission_calls where provider = p_provider and provider_call_id = p_provider_call_id;
  if v_id is null then
    insert into public.admission_calls(school_id, applicant_id, provider, provider_call_id, direction, status, phone, started_at, ended_at, duration_seconds)
    values (v_school, v_app, p_provider, p_provider_call_id, 'inbound', p_status, p_from, p_started, p_ended, p_duration)
    on conflict do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.admission_calls where provider = p_provider and provider_call_id = p_provider_call_id; end if;
  end if;
  insert into public.admission_call_events(call_id, dedupe_key, event_type, status, payload)
  values (v_id, p_dedupe_key, 'inbound', p_status, coalesce(p_payload, '{}'::jsonb)) on conflict (dedupe_key) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins = 0 then return 'duplicate'; end if;
  return public.tel_record_event(p_provider, p_provider_call_id, p_dedupe_key || ':apply', 'inbound', p_status, p_started, null, p_ended, p_duration, null, null, null, '{}'::jsonb);
end $$;

-- Recording access: permission + school + retention + opt-in, and an audit row each time
create or replace function public.tel_authorize_recording(p_call uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.admission_calls%rowtype; s public.telephony_school_settings%rowtype; v_school uuid;
begin
  select school_id into v_school from public.profiles where id = p_user;
  select * into c from public.admission_calls where id = p_call;
  if not found or v_school is null or c.school_id <> v_school or not public.tel_user_can_call(p_user) then return jsonb_build_object('status', 'forbidden'); end if;
  select * into s from public.telephony_school_settings where school_id = c.school_id;
  if not found or not s.recording_enabled then return jsonb_build_object('status', 'disabled'); end if;
  if not c.recording_available or c.recording_ref is null then return jsonb_build_object('status', 'unavailable'); end if;
  if c.ended_at is not null and c.ended_at < now() - make_interval(days => s.recording_retention_days) then return jsonb_build_object('status', 'expired'); end if;
  insert into public.telephony_recording_access_log(school_id, call_id, accessed_by) values (c.school_id, c.id, p_user);
  return jsonb_build_object('status', 'ok', 'ref', c.recording_ref);
end $$;

create or replace function public.tel_purge_expired_recordings() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.admission_calls c set recording_ref = null, recording_available = false, updated_at = now()
   from public.telephony_school_settings s
   where s.school_id = c.school_id and c.recording_ref is not null
     and coalesce(c.ended_at, c.created_at) < now() - make_interval(days => s.recording_retention_days);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Reads for the screen
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.tel_call_history(
  p_applicant uuid, p_from date default null, p_to date default null, p_staff uuid default null,
  p_status text default null, p_direction text default null, p_provider text default null, p_limit int default 100
) returns table (
  id uuid, direction text, status text, phone text, staff_id uuid, staff_name text, provider text, provider_call_id text,
  started_at timestamptz, created_at timestamptz, duration_seconds int, conversation_seconds int, failure_reason text,
  recording_available boolean, note_count int
) language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.tel_school();
begin
  if v_school is null or not public.tel_user_can_call(auth.uid()) or not public.tel_applicant_in_school(p_applicant, v_school) then
    raise exception 'not permitted';
  end if;
  return query
    select c.id, c.direction, c.status, c.phone, c.staff_id, pr.full_name, c.provider, c.provider_call_id, c.started_at, c.created_at,
           c.duration_seconds, c.conversation_seconds, c.failure_reason, c.recording_available,
           (select count(*)::int from public.admission_call_notes n where n.call_id = c.id)
      from public.admission_calls c left join public.profiles pr on pr.id = c.staff_id
     where c.school_id = v_school and c.applicant_id = p_applicant
       and (p_from is null or c.created_at >= p_from::timestamptz) and (p_to is null or c.created_at < (p_to + 1)::timestamptz)
       and (p_staff is null or c.staff_id = p_staff) and (p_status is null or c.status = p_status)
       and (p_direction is null or c.direction = p_direction) and (p_provider is null or c.provider = p_provider)
     order by c.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.tel_get_call(p_call uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.admission_calls%rowtype;
begin
  select * into c from public.admission_calls where id = p_call;
  if not found or c.school_id is distinct from public.tel_school() or not public.tel_user_can_call(auth.uid()) then raise exception 'not permitted'; end if;
  return jsonb_build_object('id', c.id, 'status', c.status, 'direction', c.direction, 'duration_seconds', c.duration_seconds,
    'conversation_seconds', c.conversation_seconds, 'failure_reason', c.failure_reason, 'started_at', c.started_at,
    'answered_at', c.answered_at, 'ended_at', c.ended_at, 'created_at', c.created_at, 'applicant_id', c.applicant_id);
end $$;

-- Notes -----------------------------------------------------------------------------------------------------------------
create or replace function public.tel_add_note(p_applicant uuid, p_call uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.tel_school(); v_id uuid;
begin
  if v_school is null or not public.tel_user_can_call(auth.uid()) or not public.tel_applicant_in_school(p_applicant, v_school) then raise exception 'not permitted'; end if;
  if p_call is not null and not exists (select 1 from public.admission_calls where id = p_call and school_id = v_school and applicant_id = p_applicant) then
    raise exception 'that call does not belong to this lead';
  end if;
  insert into public.admission_call_notes(school_id, applicant_id, call_id, author_id, note) values (v_school, p_applicant, p_call, auth.uid(), btrim(p_note))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.tel_edit_note(p_note uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.admission_call_notes set note = btrim(p_text), updated_at = now()
   where id = p_note and school_id = public.tel_school() and author_id = auth.uid() and public.tel_user_can_call(auth.uid());
  if not found then raise exception 'not permitted'; end if;
end $$;

-- Follow-ups ------------------------------------------------------------------------------------------------------------
create or replace function public.tel_schedule_followup(p_applicant uuid, p_call uuid, p_due timestamptz, p_reason text, p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.tel_school(); v_to uuid := coalesce(p_assignee, auth.uid()); v_id uuid;
begin
  if v_school is null or not public.tel_user_can_call(auth.uid()) or not public.tel_applicant_in_school(p_applicant, v_school) then raise exception 'not permitted'; end if;
  if not exists (select 1 from public.profiles where id = v_to and school_id = v_school) or not public.tel_user_can_call(v_to) then
    raise exception 'the follow-up can only be assigned to admission staff of your school';
  end if;
  if p_due <= now() - interval '5 minutes' then raise exception 'choose a follow-up time in the future'; end if;
  insert into public.admission_call_followups(school_id, applicant_id, call_id, assigned_to, due_at, reason, created_by)
  values (v_school, p_applicant, p_call, v_to, p_due, btrim(p_reason), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.tel_update_followup(p_id uuid, p_action text, p_due timestamptz default null, p_assignee uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare f public.admission_call_followups%rowtype;
begin
  select * into f from public.admission_call_followups where id = p_id;
  if not found or f.school_id is distinct from public.tel_school() or not public.tel_user_can_call(auth.uid()) then raise exception 'not permitted'; end if;
  if not (f.assigned_to = auth.uid() or f.created_by = auth.uid() or public.tel_is_admin(auth.uid())) then raise exception 'not permitted'; end if;
  if f.status <> 'pending' then raise exception 'this follow-up is already %', f.status; end if;
  if p_action = 'complete' then
    update public.admission_call_followups set status = 'completed', completed_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'cancel' then
    update public.admission_call_followups set status = 'cancelled', updated_at = now() where id = p_id;
  elsif p_action = 'reschedule' then
    if p_due is null or p_due <= now() - interval '5 minutes' then raise exception 'choose a follow-up time in the future'; end if;
    if p_assignee is not null and (not exists (select 1 from public.profiles where id = p_assignee and school_id = f.school_id) or not public.tel_user_can_call(p_assignee)) then
      raise exception 'the follow-up can only be assigned to admission staff of your school';
    end if;
    update public.admission_call_followups set due_at = p_due, assigned_to = coalesce(p_assignee, assigned_to), reminder_sent_at = null, updated_at = now() where id = p_id;
  else
    raise exception 'unknown action';
  end if;
end $$;

-- Pending follow-ups for the dashboard (mine, or everyone's for admins)
create or replace function public.tel_pending_followups(p_mine boolean default true)
returns table (id uuid, applicant_id uuid, applicant_name text, parent_name text, parent_phone text, due_at timestamptz,
               reason text, assigned_to uuid, assigned_name text, overdue boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.tel_school();
begin
  if v_school is null or not public.tel_user_can_call(auth.uid()) then raise exception 'not permitted'; end if;
  return query execute
    'select f.id, f.applicant_id, a.full_name::text, a.parent_name::text, a.parent_phone::text, f.due_at, f.reason, f.assigned_to, pr.full_name::text, f.due_at < now()
       from public.admission_call_followups f
       left join public.admission_applicants a on a.id = f.applicant_id and a.school_id = f.school_id
       left join public.profiles pr on pr.id = f.assigned_to
      where f.school_id = $1 and f.status = ''pending'' and ($2 = false or f.assigned_to = $3 or not $4)
      order by f.due_at limit 300'
    using v_school, p_mine, auth.uid(), true;
end $$;

-- The lead timeline: enquiry + calls + notes + follow-ups, newest first
create or replace function public.tel_lead_timeline(p_applicant uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.tel_school(); v_enq timestamptz; v jsonb;
begin
  if v_school is null or not public.tel_user_can_call(auth.uid()) or not public.tel_applicant_in_school(p_applicant, v_school) then raise exception 'not permitted'; end if;
  execute 'select created_at from public.admission_applicants where id = $1' into v_enq using p_applicant;
  select coalesce(jsonb_agg(e order by (e->>'at') desc), '[]'::jsonb) into v from (
    select jsonb_build_object('type', 'enquiry', 'at', v_enq, 'title', 'Admission enquiry received') as e where v_enq is not null
    union all
    select jsonb_build_object('type', 'call', 'at', coalesce(c.started_at, c.created_at), 'id', c.id, 'direction', c.direction, 'status', c.status,
             'duration_seconds', c.duration_seconds, 'staff', pr.full_name)
      from public.admission_calls c left join public.profiles pr on pr.id = c.staff_id where c.school_id = v_school and c.applicant_id = p_applicant
    union all
    select jsonb_build_object('type', 'note', 'at', n.created_at, 'id', n.id, 'call_id', n.call_id, 'note', n.note, 'author', pr.full_name, 'author_id', n.author_id)
      from public.admission_call_notes n left join public.profiles pr on pr.id = n.author_id where n.school_id = v_school and n.applicant_id = p_applicant
    union all
    select jsonb_build_object('type', 'followup_scheduled', 'at', f.created_at, 'id', f.id, 'due_at', f.due_at, 'reason', f.reason, 'status', f.status, 'assigned', pr.full_name)
      from public.admission_call_followups f left join public.profiles pr on pr.id = f.assigned_to where f.school_id = v_school and f.applicant_id = p_applicant
    union all
    select jsonb_build_object('type', 'followup_completed', 'at', f.completed_at, 'id', f.id, 'reason', f.reason)
      from public.admission_call_followups f where f.school_id = v_school and f.applicant_id = p_applicant and f.status = 'completed' and f.completed_at is not null
  ) t(e);
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Follow-up reminders: one in-app notification per follow-up when it falls due (existing bell / inbox), sent once
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.tel_run_followup_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare f record; n int := 0; v_name text; v_tz text;
begin
  for f in select * from public.admission_call_followups where status = 'pending' and reminder_sent_at is null and due_at <= now() + interval '15 minutes' for update skip locked loop
    execute 'select full_name from public.admission_applicants where id = $1' into v_name using f.applicant_id;
    select coalesce((select timezone from public.telephony_school_settings where school_id = f.school_id), 'Asia/Kolkata') into v_tz;
    insert into public.governance_notifications(user_id, event_type, title, message, reference_id, reference_type)
    values (f.assigned_to, 'admission_followup_due', 'Admission follow-up due',
            'Call back about ' || coalesce(v_name, 'an applicant') || ' (' || to_char(f.due_at at time zone v_tz, 'DD Mon, HH12:MI AM') || '): ' || f.reason,
            f.applicant_id, 'admission_applicant');
    update public.admission_call_followups set reminder_sent_at = now() where id = f.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Grants. Lifecycle functions are service_role only; screen/RPC functions are for signed-in users.
-- ---------------------------------------------------------------------------------------------------------------------
revoke execute on function public.tel_begin_call(uuid, uuid, uuid, text, text, text, boolean),
  public.tel_mark_dialed(uuid, text), public.tel_fail_call(uuid, text),
  public.tel_record_event(text, text, text, text, text, timestamptz, timestamptz, timestamptz, int, int, text, text, jsonb),
  public.tel_record_inbound(text, text, text, text, text, text, timestamptz, timestamptz, int, jsonb),
  public.tel_authorize_recording(uuid, uuid), public.tel_purge_expired_recordings(), public.tel_run_followup_reminders()
  from public, anon, authenticated;
grant execute on function public.tel_begin_call(uuid, uuid, uuid, text, text, text, boolean),
  public.tel_mark_dialed(uuid, text), public.tel_fail_call(uuid, text),
  public.tel_record_event(text, text, text, text, text, timestamptz, timestamptz, timestamptz, int, int, text, text, jsonb),
  public.tel_record_inbound(text, text, text, text, text, text, timestamptz, timestamptz, int, jsonb),
  public.tel_authorize_recording(uuid, uuid), public.tel_purge_expired_recordings(), public.tel_run_followup_reminders() to service_role;
grant execute on function public.tel_school(), public.tel_user_can_call(uuid), public.tel_is_admin(uuid), public.tel_last10(text),
  public.tel_applicant_in_school(uuid, uuid), public.tel_status_rank(text),
  public.tel_save_settings(boolean, text, text, boolean, int, text, time, time), public.tel_set_my_phone(text), public.tel_set_staff_access(uuid, boolean),
  public.tel_cancel_call(uuid), public.tel_call_history(uuid, date, date, uuid, text, text, text, int), public.tel_get_call(uuid),
  public.tel_add_note(uuid, uuid, text), public.tel_edit_note(uuid, text),
  public.tel_schedule_followup(uuid, uuid, timestamptz, text, uuid), public.tel_update_followup(uuid, text, timestamptz, uuid),
  public.tel_pending_followups(boolean), public.tel_lead_timeline(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Schedules (only when pg_cron exists, as in the calendar reminders migration)
-- ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('tel_followup_reminders', 'tel_purge_recordings');
    perform cron.schedule('tel_followup_reminders', '*/10 * * * *', 'select public.tel_run_followup_reminders()');
    perform cron.schedule('tel_purge_recordings', '30 3 * * *', 'select public.tel_purge_expired_recordings()');
  end if;
end $$;
