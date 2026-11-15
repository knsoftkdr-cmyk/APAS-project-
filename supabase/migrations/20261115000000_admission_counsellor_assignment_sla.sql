-- ============================================================
-- Admissions: Counsellor assignment (round-robin) + two SLA clocks
--
-- Reuses: admission_applicants (the lead), admission_lead_events (every call / message / follow-up, with its real
--         timestamp), admission_lead_meta (assigned_to is kept in sync), admission_lead_scores (workbench ordering),
--         calendar_events (school holidays), governance_notifications (in-app notifications), is_admission_staff /
--         is_admission_admin (access), pg_cron (scheduling).
-- Adds:   admission_counsellors            who can receive leads + availability
--         admission_assignment_state       round-robin pointer, one row per school (row lock = serialisation point)
--         admission_lead_assignments       current counsellor of a lead (one row per lead => no duplicate assignment)
--         admission_assignment_history     append-only: who assigned what to whom, when, why
--         admission_sla_config             per-school targets, working hours / days, which events count as a response
--         admission_sla_cycles             one row per SLA clock run (first response / follow-up), with due, done, breach
-- No new menu or module: everything is read by the existing Admissions page.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
create table if not exists public.admission_counsellors (
  school_id         uuid not null references public.schools(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  is_active         boolean not null default true,
  is_available      boolean not null default true,          -- temporary: on leave / busy
  unavailable_until timestamptz,                            -- optional auto-return
  max_open_leads    int check (max_open_leads is null or max_open_leads > 0),
  rr_seq            bigint generated always as identity,    -- stable rotation order
  added_by          uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (school_id, profile_id)
);

create table if not exists public.admission_assignment_state (
  school_id    uuid primary key references public.schools(id) on delete cascade,
  last_rr_seq  bigint not null default 0,
  updated_at   timestamptz not null default now()
);

create table if not exists public.admission_lead_assignments (
  applicant_id  uuid primary key references public.admission_applicants(id) on delete cascade,
  school_id     uuid not null references public.schools(id) on delete cascade,
  assigned_to   uuid references public.profiles(id) on delete set null,   -- null = waiting for an available counsellor
  assigned_at   timestamptz,
  assigned_by   uuid references public.profiles(id) on delete set null,   -- null = automatic
  method        text not null default 'auto' check (method in ('auto','manual','bulk','redistribute')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_adm_assign_school_to on public.admission_lead_assignments(school_id, assigned_to);

create table if not exists public.admission_assignment_history (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  applicant_id    uuid not null references public.admission_applicants(id) on delete cascade,
  from_counsellor uuid references public.profiles(id) on delete set null,
  to_counsellor   uuid references public.profiles(id) on delete set null,
  assigned_by     uuid references public.profiles(id) on delete set null,
  method          text not null check (method in ('auto','manual','bulk','redistribute')),
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_adm_assign_hist on public.admission_assignment_history(applicant_id, created_at desc);

create table if not exists public.admission_sla_config (
  school_id                uuid primary key references public.schools(id) on delete cascade,
  first_response_minutes   int not null default 30    check (first_response_minutes between 1 and 10080),
  follow_up_interval_minutes int not null default 1440 check (follow_up_interval_minutes between 15 and 43200),
  follow_up_grace_minutes  int not null default 0     check (follow_up_grace_minutes between 0 and 1440),
  due_soon_first_minutes   int not null default 10    check (due_soon_first_minutes between 0 and 1440),
  due_soon_follow_minutes  int not null default 120   check (due_soon_follow_minutes between 0 and 10080),
  working_hours_enabled    boolean not null default true,
  work_start               time not null default '09:00',
  work_end                 time not null default '17:00',
  work_days                int[] not null default '{1,2,3,4,5,6}',   -- ISO: 1 = Monday ... 7 = Sunday
  timezone                 text not null default 'Asia/Kolkata',
  -- Contact that counts as a genuine first response. Missed calls never count.
  first_response_events    text[] not null default '{call_answered,message_sent,message_replied,visit_scheduled,visit_completed}',
  auto_assign_enabled      boolean not null default true,
  updated_by               uuid references public.profiles(id) on delete set null,
  updated_at               timestamptz not null default now(),
  check (work_end > work_start),
  check (cardinality(work_days) between 1 and 7)
);

create table if not exists public.admission_sla_cycles (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  applicant_id  uuid not null references public.admission_applicants(id) on delete cascade,
  counsellor_id uuid references public.profiles(id) on delete set null,
  clock         text not null check (clock in ('first_response','follow_up')),
  kind          text not null default 'interval' check (kind in ('assignment','interval','scheduled')),
  started_at    timestamptz not null,
  due_at        timestamptz not null,
  warned_at     timestamptz,                -- "due soon" notification sent
  breached_at   timestamptz,                -- the monitor saw it overdue (notified once)
  completed_at  timestamptz,                -- real timestamp of the interaction that satisfied it
  completed_by  uuid references public.profiles(id) on delete set null,
  outcome       text not null default 'open' check (outcome in ('open','met','late','superseded','cancelled')),
  created_at    timestamptz not null default now()
);
-- At most ONE running clock of each kind per lead.
create unique index if not exists uq_adm_sla_open on public.admission_sla_cycles(applicant_id, clock) where outcome = 'open';
create index if not exists idx_adm_sla_school_open on public.admission_sla_cycles(school_id, outcome, due_at);
create index if not exists idx_adm_sla_counsellor on public.admission_sla_cycles(school_id, counsellor_id, clock);

-- Assignment events are written by the database only (not forgeable from the browser).
alter table public.admission_lead_events drop constraint if exists admission_lead_events_event_type_check;
alter table public.admission_lead_events add constraint admission_lead_events_event_type_check check (event_type in (
  'lead_created','repeat_enquiry','status_changed','follow_up_note','follow_up_scheduled','assigned',
  'call_answered','call_not_answered','message_sent','message_replied',
  'visit_scheduled','visit_completed','visit_missed'));
drop policy if exists adm_lead_events_insert on public.admission_lead_events;
create policy adm_lead_events_insert on public.admission_lead_events
  for insert with check (
    public.is_admission_staff(school_id)
    and event_type in ('follow_up_note','follow_up_scheduled','call_answered','call_not_answered',
                       'message_sent','message_replied','visit_scheduled','visit_completed','visit_missed')
    and (created_by is null or created_by = auth.uid())
    and exists (select 1 from public.admission_applicants a
                where a.id = admission_lead_events.applicant_id and a.school_id = admission_lead_events.school_id)
  );

-- ------------------------------------------------------------
-- 2. Access: staff of the school can READ; every write goes through the functions below
-- ------------------------------------------------------------
alter table public.admission_counsellors         enable row level security;
alter table public.admission_assignment_state    enable row level security;
alter table public.admission_lead_assignments    enable row level security;
alter table public.admission_assignment_history  enable row level security;
alter table public.admission_sla_config          enable row level security;
alter table public.admission_sla_cycles          enable row level security;

drop policy if exists adm_counsellors_select on public.admission_counsellors;
create policy adm_counsellors_select on public.admission_counsellors for select using (public.is_admission_staff(school_id));
drop policy if exists adm_assignments_select on public.admission_lead_assignments;
create policy adm_assignments_select on public.admission_lead_assignments for select using (public.is_admission_staff(school_id));
drop policy if exists adm_assign_hist_select on public.admission_assignment_history;
create policy adm_assign_hist_select on public.admission_assignment_history for select using (public.is_admission_staff(school_id));
drop policy if exists adm_sla_config_select on public.admission_sla_config;
create policy adm_sla_config_select on public.admission_sla_config for select using (public.is_admission_staff(school_id));
drop policy if exists adm_sla_cycles_select on public.admission_sla_cycles;
create policy adm_sla_cycles_select on public.admission_sla_cycles for select using (public.is_admission_staff(school_id));
-- admission_assignment_state: no policy at all (internal)

revoke insert, update, delete, truncate on public.admission_counsellors, public.admission_assignment_state,
  public.admission_lead_assignments, public.admission_assignment_history, public.admission_sla_config,
  public.admission_sla_cycles from anon, authenticated;
revoke all on public.admission_assignment_state from anon, authenticated;
revoke all on public.admission_counsellors, public.admission_lead_assignments, public.admission_assignment_history,
  public.admission_sla_config, public.admission_sla_cycles from anon;

-- ------------------------------------------------------------
-- 3. Working-hours maths (school time zone, working days, holidays from calendar_events)
-- ------------------------------------------------------------
create or replace function public.adm_sla_cfg(p_school uuid)
returns public.admission_sla_config
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.admission_sla_config;
begin
  select * into c from public.admission_sla_config where school_id = p_school;
  if not found then
    insert into public.admission_sla_config (school_id) values (p_school) on conflict do nothing;
    select * into c from public.admission_sla_config where school_id = p_school;
  end if;
  return c;
end;
$$;

create or replace function public.adm_is_holiday(p_school uuid, p_day date)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if to_regclass('public.calendar_events') is null then return false; end if;
  return exists (
    select 1 from public.calendar_events e
    where e.school_id = p_school and e.event_type = 'holiday'
      and e.start_date::date <= p_day and coalesce(e.end_date::date, e.start_date::date) >= p_day);
exception when others then
  return false;   -- a calendar problem must never stop assignment
end;
$$;

-- first working moment at or after a LOCAL timestamp
create or replace function public.adm_wh_next_local(c public.admission_sla_config, p_cur timestamp)
returns timestamp
language plpgsql stable set search_path = public, pg_temp
as $$
declare cur timestamp := p_cur; d date;
begin
  for i in 1..800 loop
    d := cur::date;
    if extract(isodow from d)::int = any (c.work_days) and not public.adm_is_holiday(c.school_id, d) then
      if cur::time < c.work_start then return d + c.work_start; end if;
      if cur::time < c.work_end   then return cur; end if;
    end if;
    cur := (d + 1) + c.work_start;
  end loop;
  return p_cur;   -- no working day found (misconfiguration): fall back to the plain time
end;
$$;

create or replace function public.adm_next_working_moment(p_school uuid, p_ts timestamptz)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.admission_sla_config := public.adm_sla_cfg(p_school);
begin
  if not c.working_hours_enabled then return p_ts; end if;
  return public.adm_wh_next_local(c, p_ts at time zone c.timezone) at time zone c.timezone;
end;
$$;

-- p_ts + p_minutes of WORKING time (skipping nights, non-working days and holidays)
create or replace function public.adm_add_working_minutes(p_school uuid, p_ts timestamptz, p_minutes int)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.admission_sla_config := public.adm_sla_cfg(p_school);
        cur timestamp; rem numeric := greatest(p_minutes, 0); cap numeric;
begin
  if not c.working_hours_enabled then return p_ts + make_interval(mins => greatest(p_minutes, 0)); end if;
  cur := public.adm_wh_next_local(c, p_ts at time zone c.timezone);
  for i in 1..800 loop
    cap := extract(epoch from ((cur::date + c.work_end) - cur)) / 60.0;
    if rem <= cap then return (cur + make_interval(secs => rem * 60)) at time zone c.timezone; end if;
    rem := rem - cap;
    cur := public.adm_wh_next_local(c, (cur::date + 1) + c.work_start);
  end loop;
  return p_ts + make_interval(mins => greatest(p_minutes, 0));
end;
$$;

-- ------------------------------------------------------------
-- 4. Notifications (best effort: never block the work that triggered them)
-- ------------------------------------------------------------
create or replace function public.adm_notify(p_users uuid[], p_type text, p_title text, p_message text, p_ref uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare u uuid;
begin
  foreach u in array coalesce(p_users, '{}') loop
    begin
      insert into public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type, channel)
      values (u, p_type, p_title, p_message, p_ref, 'admission_applicant', 'in_app');
    exception when others then raise warning 'adm_notify failed: %', sqlerrm; end;
  end loop;
end;
$$;

create or replace function public.adm_school_admins(p_school uuid)
returns uuid[]
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(array_agg(id), '{}') from public.profiles where school_id = p_school and role in ('principal','admin','school_admin') $$;

-- ------------------------------------------------------------
-- 5. SLA clocks
-- ------------------------------------------------------------
create or replace function public.adm_is_terminal(p_status text)
returns boolean language sql immutable as $$ select p_status in ('admitted','rejected','withdrawn') $$;

create or replace function public.adm_start_cycle(p_applicant uuid, p_school uuid, p_counsellor uuid, p_clock text,
                                                  p_kind text, p_started timestamptz, p_due timestamptz)
returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into public.admission_sla_cycles (school_id, applicant_id, counsellor_id, clock, kind, started_at, due_at)
  values (p_school, p_applicant, p_counsellor, p_clock, p_kind, p_started, p_due)
  on conflict do nothing;
$$;

create or replace function public.adm_interval_due(p_school uuid, p_from timestamptz)
returns timestamptz
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.admission_sla_config := public.adm_sla_cfg(p_school);
begin
  -- "24 hours" means 24 elapsed hours; a deadline that lands at night, on a non-working day or a holiday moves to the
  -- next working moment (counting it as 24 WORKING hours would silently turn it into three working days).
  return public.adm_add_working_minutes(p_school,
           public.adm_next_working_moment(p_school, p_from + make_interval(mins => c.follow_up_interval_minutes)),
           c.follow_up_grace_minutes);
end;
$$;

-- Make sure a (non-closed, assigned) lead has the clocks it should have. Safe to call repeatedly.
create or replace function public.adm_ensure_cycles(p_applicant uuid, p_now timestamptz default now())
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.admission_lead_assignments%rowtype; v_status text; c public.admission_sla_config; v_contact boolean;
begin
  select * into a from public.admission_lead_assignments where applicant_id = p_applicant;
  if not found or a.assigned_to is null then return; end if;
  select status into v_status from public.admission_applicants where id = p_applicant;
  if v_status is null or public.adm_is_terminal(v_status) then return; end if;
  c := public.adm_sla_cfg(a.school_id);
  v_contact := exists (select 1 from public.admission_sla_cycles where applicant_id = p_applicant and clock = 'first_response' and outcome in ('met','late'))
            or exists (select 1 from public.admission_lead_events e where e.applicant_id = p_applicant
                       and e.event_type = any (c.first_response_events) and e.created_by is not null);
  if not v_contact then
    if not exists (select 1 from public.admission_sla_cycles where applicant_id = p_applicant and clock = 'first_response' and outcome = 'open') then
      perform public.adm_start_cycle(p_applicant, a.school_id, a.assigned_to, 'first_response', 'assignment', p_now,
                                     public.adm_add_working_minutes(a.school_id, p_now, c.first_response_minutes));
    end if;
  elsif not exists (select 1 from public.admission_sla_cycles where applicant_id = p_applicant and clock = 'follow_up' and outcome = 'open') then
    perform public.adm_start_cycle(p_applicant, a.school_id, a.assigned_to, 'follow_up', 'interval', p_now, public.adm_interval_due(a.school_id, p_now));
  end if;
end;
$$;

-- Every logged interaction moves the clocks, using the interaction's own timestamp.
create or replace function public.adm_sla_event_trigger()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.admission_lead_assignments%rowtype; c public.admission_sla_config; v_status text;
        v_due timestamptz; cy public.admission_sla_cycles%rowtype; v_done boolean;
begin
  begin
    select * into a from public.admission_lead_assignments where applicant_id = new.applicant_id;
    if not found or a.assigned_to is null then return null; end if;
    select status into v_status from public.admission_applicants where id = new.applicant_id;
    if v_status is null or public.adm_is_terminal(v_status) then return null; end if;
    c := public.adm_sla_cfg(a.school_id);

    -- first response: a genuine contact (never a missed call, never a system event)
    if new.event_type = any (c.first_response_events) and new.created_by is not null then
      update public.admission_sla_cycles
         set completed_at = new.created_at, completed_by = new.created_by,
             outcome = case when new.created_at <= due_at then 'met' else 'late' end
       where applicant_id = new.applicant_id and clock = 'first_response' and outcome = 'open' and started_at <= new.created_at;
      if found then
        perform public.adm_start_cycle(new.applicant_id, a.school_id, a.assigned_to, 'follow_up', 'interval', new.created_at,
                                       public.adm_interval_due(a.school_id, new.created_at));
      end if;
    end if;

    -- follow-up done: a genuine contact or a follow-up note after the clock started, then the next interval starts
    if (new.event_type = any (c.first_response_events) or new.event_type in ('visit_completed','follow_up_note'))
       and new.created_by is not null then
      update public.admission_sla_cycles
         set completed_at = new.created_at, completed_by = new.created_by,
             outcome = case when new.created_at <= due_at then 'met' else 'late' end
       where applicant_id = new.applicant_id and clock = 'follow_up' and outcome = 'open' and started_at < new.created_at;
      if found then
        perform public.adm_start_cycle(new.applicant_id, a.school_id, a.assigned_to, 'follow_up', 'interval', new.created_at,
                                       public.adm_interval_due(a.school_id, new.created_at));
      end if;
    end if;

    -- a newly scheduled follow-up restarts the follow-up clock at the scheduled time
    if new.event_type = 'follow_up_scheduled' then
      begin v_due := (new.detail ->> 'due')::timestamptz; exception when others then v_due := null; end;
      if v_due is not null then
        update public.admission_sla_cycles set outcome = 'superseded', completed_at = new.created_at
         where applicant_id = new.applicant_id and clock = 'follow_up' and outcome = 'open';
        perform public.adm_start_cycle(new.applicant_id, a.school_id, a.assigned_to, 'follow_up', 'scheduled', new.created_at,
                  public.adm_add_working_minutes(a.school_id, public.adm_next_working_moment(a.school_id, v_due), c.follow_up_grace_minutes));
      end if;
    end if;
  exception when others then
    raise warning 'adm_sla_event_trigger failed for %: %', new.applicant_id, sqlerrm;   -- never block logging an interaction
  end;
  return null;
end;
$$;
drop trigger if exists trg_sla_events on public.admission_lead_events;
create trigger trg_sla_events after insert on public.admission_lead_events
  for each row execute function public.adm_sla_event_trigger();

-- Closing a lead stops its clocks; re-opening it restarts them.
create or replace function public.adm_sla_status_trigger()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if public.adm_is_terminal(new.status) and not public.adm_is_terminal(old.status) then
      update public.admission_sla_cycles set outcome = 'cancelled', completed_at = now()
       where applicant_id = new.id and outcome = 'open';
    elsif public.adm_is_terminal(old.status) and not public.adm_is_terminal(new.status) then
      perform public.adm_ensure_cycles(new.id);
    end if;
  exception when others then raise warning 'adm_sla_status_trigger failed for %: %', new.id, sqlerrm; end;
  return null;
end;
$$;
drop trigger if exists trg_sla_status on public.admission_applicants;
create trigger trg_sla_status after update of status on public.admission_applicants
  for each row execute function public.adm_sla_status_trigger();

-- ------------------------------------------------------------
-- 6. Assignment engine
-- ------------------------------------------------------------
-- Record an assignment (insert or change) + history + timeline event + clocks + notification.
create or replace function public.adm_apply_assignment(p_applicant uuid, p_to uuid, p_by uuid, p_method text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_school uuid; a public.admission_lead_assignments%rowtype; v_from uuid; v_name text;
begin
  select school_id, full_name into v_school, v_name from public.admission_applicants where id = p_applicant;
  if v_school is null then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  select * into a from public.admission_lead_assignments where applicant_id = p_applicant for update;
  v_from := a.assigned_to;
  if found then
    update public.admission_lead_assignments
       set assigned_to = p_to, assigned_at = now(), assigned_by = p_by, method = p_method, updated_at = now()
     where applicant_id = p_applicant;
  else
    insert into public.admission_lead_assignments (applicant_id, school_id, assigned_to, assigned_at, assigned_by, method)
    values (p_applicant, v_school, p_to, now(), p_by, p_method);
  end if;
  insert into public.admission_assignment_history (school_id, applicant_id, from_counsellor, to_counsellor, assigned_by, method, reason)
  values (v_school, p_applicant, v_from, p_to, p_by, p_method, nullif(btrim(coalesce(p_reason, '')), ''));
  insert into public.admission_lead_events (school_id, applicant_id, event_type, detail, created_by)
  values (v_school, p_applicant, 'assigned',
          jsonb_build_object('to', p_to, 'from', v_from, 'method', p_method, 'reason', nullif(btrim(coalesce(p_reason, '')), '')), p_by);
  update public.admission_lead_meta set assigned_to = p_to where applicant_id = p_applicant;

  -- the first-response clock restarts for the new owner; an already-running follow-up clock just changes owner
  update public.admission_sla_cycles set outcome = 'superseded', completed_at = now()
   where applicant_id = p_applicant and clock = 'first_response' and outcome = 'open';
  update public.admission_sla_cycles set counsellor_id = p_to where applicant_id = p_applicant and outcome = 'open';
  perform public.adm_ensure_cycles(p_applicant);

  if p_to is not null and p_to is distinct from p_by then
    perform public.adm_notify(array[p_to], 'admission_lead_assigned', 'New lead assigned',
                              coalesce(v_name, 'A lead') || ' has been assigned to you.', p_applicant);
  end if;
end;
$$;

-- Next eligible counsellor in rotation. Caller must hold the school's state row lock.
create or replace function public.adm_pick_counsellor(p_school uuid, p_last_seq bigint, p_exclude uuid default null)
returns table (profile_id uuid, rr_seq bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select c.profile_id, c.rr_seq
  from public.admission_counsellors c
  join public.profiles p on p.id = c.profile_id and p.school_id = c.school_id
  where c.school_id = p_school and c.is_active and c.is_available
    and (c.unavailable_until is null or c.unavailable_until <= now())
    and (p_exclude is null or c.profile_id <> p_exclude)
    and (c.max_open_leads is null or c.max_open_leads > (
          select count(*) from public.admission_lead_assignments la
          join public.admission_applicants ap on ap.id = la.applicant_id
          where la.assigned_to = c.profile_id and not public.adm_is_terminal(ap.status)))
  order by (c.rr_seq <= p_last_seq), c.rr_seq
  limit 1;
$$;

-- Round-robin assignment of one lead. Serialised per school by the state-row lock, so leads arriving at the
-- same moment still rotate strictly, and a lead processed twice is assigned once.
create or replace function public.adm_rr_assign(p_applicant uuid, p_method text default 'auto', p_by uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_school uuid; st public.admission_assignment_state%rowtype; a public.admission_lead_assignments%rowtype;
        pick record; c public.admission_sla_config; v_rows int;
begin
  select school_id into v_school from public.admission_applicants where id = p_applicant;
  if v_school is null then return null; end if;
  c := public.adm_sla_cfg(v_school);
  if p_method = 'auto' and not c.auto_assign_enabled then return null; end if;
  -- A school that has not set up counsellors yet keeps working exactly as before: no row, no notification.
  if p_method = 'auto' and not exists (select 1 from public.admission_counsellors where school_id = v_school) then return null; end if;

  insert into public.admission_assignment_state (school_id) values (v_school) on conflict do nothing;
  select * into st from public.admission_assignment_state where school_id = v_school for update;   -- the lock

  select * into a from public.admission_lead_assignments where applicant_id = p_applicant;
  if found and a.assigned_to is not null then return a.assigned_to; end if;                          -- already assigned

  select * into pick from public.adm_pick_counsellor(v_school, st.last_rr_seq);
  if pick.profile_id is null then
    insert into public.admission_lead_assignments (applicant_id, school_id, assigned_to, method)
    values (p_applicant, v_school, null, p_method) on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then          -- tell the admins once, not on every retry
      perform public.adm_notify(public.adm_school_admins(v_school), 'admission_lead_unassigned', 'Lead waiting for a counsellor',
                                'No counsellor is currently available to receive a new lead.', p_applicant);
    end if;
    return null;
  end if;
  perform public.adm_apply_assignment(p_applicant, pick.profile_id, p_by, p_method, null);
  update public.admission_assignment_state set last_rr_seq = pick.rr_seq, updated_at = now() where school_id = v_school;
  return pick.profile_id;
end;
$$;

-- Every new lead, whatever its source, is assigned automatically.
create or replace function public.adm_assign_new_lead_trigger()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin perform public.adm_rr_assign(new.id, 'auto', null);
  exception when others then raise warning 'auto-assign failed for %: %', new.id, sqlerrm; end;   -- never block lead capture
  return null;
end;
$$;
drop trigger if exists trg_assign_new_lead on public.admission_applicants;
create trigger trg_assign_new_lead after insert on public.admission_applicants
  for each row execute function public.adm_assign_new_lead_trigger();

-- Integration leads get their lead_meta row after the applicant: copy the counsellor across.
create or replace function public.adm_meta_assigned_trigger()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.assigned_to is null then
    select assigned_to into new.assigned_to from public.admission_lead_assignments where applicant_id = new.applicant_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_meta_assigned on public.admission_lead_meta;
create trigger trg_meta_assigned before insert on public.admission_lead_meta
  for each row execute function public.adm_meta_assigned_trigger();

-- ------------------------------------------------------------
-- 7. Admin actions (all checked in the database)
-- ------------------------------------------------------------
create or replace function public.adm_require_admin(p_school uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp
as $$ begin if p_school is null or not public.is_admission_admin(p_school) then raise exception 'Not allowed' using errcode = '42501'; end if; end; $$;

create or replace function public.adm_assign_lead(p_applicant uuid, p_counsellor uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_school uuid; v_cur uuid;
begin
  select school_id into v_school from public.admission_applicants where id = p_applicant;
  perform public.adm_require_admin(v_school);
  if not exists (select 1 from public.admission_counsellors where school_id = v_school and profile_id = p_counsellor and is_active) then
    raise exception 'Choose an active counsellor of this school' using errcode = '22023';
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Reason is too long (500 characters max)' using errcode = '22023'; end if;
  select assigned_to into v_cur from public.admission_lead_assignments where applicant_id = p_applicant;
  if v_cur is not distinct from p_counsellor then
    return jsonb_build_object('changed', false, 'assigned_to', v_cur);            -- same counsellor: nothing to do
  end if;
  perform public.adm_apply_assignment(p_applicant, p_counsellor, auth.uid(), 'manual', p_reason);
  return jsonb_build_object('changed', true, 'assigned_to', p_counsellor);
end;
$$;

-- Hand every lead that has no counsellor (including leads from before this feature) out in rotation.
create or replace function public.adm_assign_unassigned(p_school uuid, p_limit int default 200)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; n int := 0; v uuid;
begin
  perform public.adm_require_admin(p_school);
  for r in
    select ap.id from public.admission_applicants ap
    left join public.admission_lead_assignments la on la.applicant_id = ap.id
    where ap.school_id = p_school and not public.adm_is_terminal(ap.status) and la.assigned_to is null
    order by ap.created_at limit greatest(least(p_limit, 1000), 1)
  loop
    v := public.adm_rr_assign(r.id, 'bulk', auth.uid());
    exit when v is null;           -- nobody available: stop instead of spinning
    n := n + 1;
  end loop;
  return jsonb_build_object('assigned', n);
end;
$$;

create or replace function public.adm_redistribute(p_school uuid, p_from uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; st public.admission_assignment_state%rowtype; pick record; n int := 0;
begin
  insert into public.admission_assignment_state (school_id) values (p_school) on conflict do nothing;
  select * into st from public.admission_assignment_state where school_id = p_school for update;
  for r in
    select la.applicant_id from public.admission_lead_assignments la
    join public.admission_applicants ap on ap.id = la.applicant_id
    where la.school_id = p_school and la.assigned_to = p_from and not public.adm_is_terminal(ap.status)
    order by la.assigned_at
  loop
    select * into pick from public.adm_pick_counsellor(p_school, st.last_rr_seq, p_from);
    exit when pick.profile_id is null;
    perform public.adm_apply_assignment(r.applicant_id, pick.profile_id, auth.uid(), 'redistribute', 'Counsellor no longer available');
    st.last_rr_seq := pick.rr_seq; n := n + 1;
  end loop;
  update public.admission_assignment_state set last_rr_seq = st.last_rr_seq, updated_at = now() where school_id = p_school;
  return n;
end;
$$;

create or replace function public.adm_set_counsellor(p_school uuid, p_profile uuid, p_active boolean default true,
  p_available boolean default true, p_unavailable_until timestamptz default null, p_max_open int default null,
  p_redistribute boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare pr public.profiles%rowtype; v_moved int := 0; v_waiting int := 0; v_left boolean;
begin
  perform public.adm_require_admin(p_school);
  select * into pr from public.profiles where id = p_profile;
  if not found or pr.school_id is distinct from p_school then raise exception 'That person is not part of this school' using errcode = '22023'; end if;
  if not (pr.role in ('principal','admin','school_admin') or pr.erp_access is true) then
    raise exception 'Only admissions staff can be counsellors' using errcode = '22023';
  end if;
  if p_max_open is not null and p_max_open < 1 then raise exception 'Maximum open leads must be at least 1' using errcode = '22023'; end if;
  insert into public.admission_counsellors (school_id, profile_id, is_active, is_available, unavailable_until, max_open_leads, added_by)
  values (p_school, p_profile, coalesce(p_active, true), coalesce(p_available, true), p_unavailable_until, p_max_open, auth.uid())
  on conflict (school_id, profile_id) do update
    set is_active = coalesce(p_active, true), is_available = coalesce(p_available, true),
        unavailable_until = p_unavailable_until, max_open_leads = p_max_open, updated_at = now();
  v_left := not coalesce(p_active, true) or not coalesce(p_available, true);
  if p_redistribute and v_left then v_moved := public.adm_redistribute(p_school, p_profile); end if;
  if not v_left then v_waiting := public.adm_assign_waiting(p_school); end if;      -- someone is back: clear the waiting list
  return jsonb_build_object('redistributed', v_moved, 'waiting_assigned', v_waiting);
end;
$$;

-- Leads that arrived while nobody was available (rows with no counsellor) get assigned.
create or replace function public.adm_assign_waiting(p_school uuid default null)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; n int := 0; v uuid;
begin
  for r in select la.applicant_id from public.admission_lead_assignments la
           join public.admission_applicants ap on ap.id = la.applicant_id
           where la.assigned_to is null and (p_school is null or la.school_id = p_school) and not public.adm_is_terminal(ap.status)
           order by la.created_at limit 500
  loop
    begin v := public.adm_rr_assign(r.applicant_id, 'auto', null); if v is not null then n := n + 1; end if;
    exception when others then raise warning 'assign waiting failed for %: %', r.applicant_id, sqlerrm; end;
  end loop;
  return n;
end;
$$;

create or replace function public.adm_set_sla_config(p_school uuid, p_settings jsonb)
returns public.admission_sla_config
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.admission_sla_config; s jsonb := coalesce(p_settings, '{}'); v_events text[]; v_days int[];
        v_allowed text[] := array['call_answered','message_sent','message_replied','visit_scheduled','visit_completed'];
begin
  perform public.adm_require_admin(p_school);
  c := public.adm_sla_cfg(p_school);
  if s ? 'timezone' and not exists (select 1 from pg_timezone_names where name = s ->> 'timezone') then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  if s ? 'first_response_events' then
    select coalesce(array_agg(x), '{}') into v_events from jsonb_array_elements_text(s -> 'first_response_events') x;
    if cardinality(v_events) = 0 or exists (select 1 from unnest(v_events) e where e <> all (v_allowed)) then
      raise exception 'Choose at least one valid interaction type' using errcode = '22023';
    end if;
  end if;
  if s ? 'work_days' then
    select coalesce(array_agg(x::int order by x::int), '{}') into v_days from jsonb_array_elements_text(s -> 'work_days') x;
    if cardinality(v_days) = 0 or exists (select 1 from unnest(v_days) d where d not between 1 and 7) then
      raise exception 'Choose at least one working day' using errcode = '22023';
    end if;
  end if;
  begin
    update public.admission_sla_config set
      first_response_minutes     = coalesce((s ->> 'first_response_minutes')::int, first_response_minutes),
      follow_up_interval_minutes = coalesce((s ->> 'follow_up_interval_minutes')::int, follow_up_interval_minutes),
      follow_up_grace_minutes    = coalesce((s ->> 'follow_up_grace_minutes')::int, follow_up_grace_minutes),
      due_soon_first_minutes     = coalesce((s ->> 'due_soon_first_minutes')::int, due_soon_first_minutes),
      due_soon_follow_minutes    = coalesce((s ->> 'due_soon_follow_minutes')::int, due_soon_follow_minutes),
      working_hours_enabled      = coalesce((s ->> 'working_hours_enabled')::boolean, working_hours_enabled),
      work_start                 = coalesce((s ->> 'work_start')::time, work_start),
      work_end                   = coalesce((s ->> 'work_end')::time, work_end),
      work_days                  = coalesce(v_days, work_days),
      timezone                   = coalesce(s ->> 'timezone', timezone),
      first_response_events      = coalesce(v_events, first_response_events),
      auto_assign_enabled        = coalesce((s ->> 'auto_assign_enabled')::boolean, auto_assign_enabled),
      updated_by = auth.uid(), updated_at = now()
    where school_id = p_school returning * into c;
  exception when check_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Some SLA settings are out of range (work end must be after work start)' using errcode = '22023';
  end;
  return c;      -- targets apply to clocks that start from now on; running clocks keep the deadline they were given
end;
$$;

-- ------------------------------------------------------------
-- 8. Admin dashboard numbers
-- ------------------------------------------------------------
create or replace function public.adm_assignment_dashboard(p_school uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now()); v jsonb;
begin
  perform public.adm_require_admin(p_school);
  select jsonb_build_object(
    'unassigned', (select count(*) from public.admission_applicants ap
                   left join public.admission_lead_assignments la on la.applicant_id = ap.id
                   where ap.school_id = p_school and not public.adm_is_terminal(ap.status) and la.assigned_to is null),
    'overdue_first_response', (select count(*) from public.admission_sla_cycles where school_id = p_school and outcome = 'open' and clock = 'first_response' and due_at < now()),
    'overdue_follow_up',      (select count(*) from public.admission_sla_cycles where school_id = p_school and outcome = 'open' and clock = 'follow_up' and due_at < now()),
    'counsellors', coalesce((
      select jsonb_agg(row_to_json(t) order by t.name) from (
        select c.profile_id, coalesce(p.full_name, 'Staff') as name, c.is_active, c.is_available, c.unavailable_until, c.max_open_leads,
          (select count(*) from public.admission_lead_assignments la join public.admission_applicants ap on ap.id = la.applicant_id
            where la.assigned_to = c.profile_id and not public.adm_is_terminal(ap.status)) as open_leads,
          (select count(*) from public.admission_lead_assignments la where la.assigned_to = c.profile_id) as total_leads,
          (select count(*) from public.admission_lead_assignments la join public.admission_applicants ap on ap.id = la.applicant_id
            where la.assigned_to = c.profile_id and ap.status in ('selected','admitted')) as converted,
          (select count(*) from public.admission_sla_cycles y where y.counsellor_id = c.profile_id and y.outcome = 'open' and y.due_at < now()) as overdue_now,
          (select count(*) from public.admission_sla_cycles y where y.counsellor_id = c.profile_id and y.clock = 'first_response' and y.started_at between v_from and v_to and y.outcome in ('met','late','open','superseded','cancelled') and (y.outcome in ('met','late') or y.breached_at is not null)) as fr_total,
          (select count(*) from public.admission_sla_cycles y where y.counsellor_id = c.profile_id and y.clock = 'first_response' and y.started_at between v_from and v_to and y.outcome = 'met' and y.breached_at is null) as fr_met,
          (select round(avg(extract(epoch from (y.completed_at - y.started_at)) / 60.0)::numeric, 1) from public.admission_sla_cycles y where y.counsellor_id = c.profile_id and y.clock = 'first_response' and y.started_at between v_from and v_to and y.outcome in ('met','late')) as fr_avg_minutes,
          (select count(*) from public.admission_sla_cycles y where y.counsellor_id = c.profile_id and y.clock = 'follow_up' and y.started_at between v_from and v_to and (y.outcome in ('met','late') or y.breached_at is not null)) as fu_total,
          (select count(*) from public.admission_sla_cycles y where y.counsellor_id = c.profile_id and y.clock = 'follow_up' and y.started_at between v_from and v_to and y.outcome = 'met' and y.breached_at is null) as fu_met
        from public.admission_counsellors c left join public.profiles p on p.id = c.profile_id
        where c.school_id = p_school) t), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ------------------------------------------------------------
-- 9. Scheduled SLA monitor (runs in the database: no browser needed)
-- ------------------------------------------------------------
create or replace function public.adm_sla_monitor(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; c public.admission_sla_config; v_name text; v_assigned int; v_warned int := 0; v_breached int := 0;
begin
  v_assigned := public.adm_assign_waiting(null);

  -- due soon (once per clock run)
  for r in select y.* from public.admission_sla_cycles y
           where y.outcome = 'open' and y.warned_at is null and y.breached_at is null and y.due_at > p_now order by y.due_at limit 2000
  loop
    begin
      c := public.adm_sla_cfg(r.school_id);
      if r.due_at - make_interval(mins => case r.clock when 'first_response' then c.due_soon_first_minutes else c.due_soon_follow_minutes end) <= p_now then
        update public.admission_sla_cycles set warned_at = p_now where id = r.id;
        select full_name into v_name from public.admission_applicants where id = r.applicant_id;
        perform public.adm_notify(array[r.counsellor_id], 'admission_sla_due_soon',
          case r.clock when 'first_response' then 'First response due soon' else 'Follow-up due soon' end,
          coalesce(v_name, 'A lead') || ' is due by ' || to_char(r.due_at at time zone c.timezone, 'DD Mon HH24:MI') || '.', r.applicant_id);
        v_warned := v_warned + 1;
      end if;
    exception when others then raise warning 'sla warn failed for %: %', r.id, sqlerrm; end;
  end loop;

  -- overdue (once per clock run): tell the counsellor and the admins
  for r in select y.* from public.admission_sla_cycles y
           where y.outcome = 'open' and y.breached_at is null and y.due_at <= p_now order by y.due_at limit 2000
  loop
    begin
      update public.admission_sla_cycles set breached_at = p_now where id = r.id;
      select full_name into v_name from public.admission_applicants where id = r.applicant_id;
      perform public.adm_notify(array(select distinct u from unnest(coalesce(array[r.counsellor_id], '{}') || public.adm_school_admins(r.school_id)) u where u is not null),
        'admission_sla_breached',
        case r.clock when 'first_response' then 'First response overdue' else 'Follow-up overdue' end,
        coalesce(v_name, 'A lead') || ' has missed the ' || case r.clock when 'first_response' then 'first response' else 'follow-up' end || ' deadline.', r.applicant_id);
      v_breached := v_breached + 1;
    exception when others then raise warning 'sla breach failed for %: %', r.id, sqlerrm; end;
  end loop;
  return jsonb_build_object('assigned_waiting', v_assigned, 'warned', v_warned, 'breached', v_breached);
end;
$$;

-- ------------------------------------------------------------
-- 10. Grants: browsers may call the admin actions only; internals stay private
-- ------------------------------------------------------------
revoke all on function
  public.adm_sla_cfg(uuid), public.adm_is_holiday(uuid, date), public.adm_wh_next_local(public.admission_sla_config, timestamp),
  public.adm_next_working_moment(uuid, timestamptz), public.adm_add_working_minutes(uuid, timestamptz, int),
  public.adm_notify(uuid[], text, text, text, uuid), public.adm_school_admins(uuid), public.adm_start_cycle(uuid, uuid, uuid, text, text, timestamptz, timestamptz),
  public.adm_interval_due(uuid, timestamptz), public.adm_ensure_cycles(uuid, timestamptz), public.adm_apply_assignment(uuid, uuid, uuid, text, text),
  public.adm_pick_counsellor(uuid, bigint, uuid), public.adm_rr_assign(uuid, text, uuid), public.adm_redistribute(uuid, uuid),
  public.adm_assign_waiting(uuid), public.adm_sla_monitor(timestamptz), public.adm_require_admin(uuid)
  from public, anon, authenticated;
revoke all on function
  public.adm_assign_lead(uuid, uuid, text), public.adm_assign_unassigned(uuid, int),
  public.adm_set_counsellor(uuid, uuid, boolean, boolean, timestamptz, int, boolean),
  public.adm_set_sla_config(uuid, jsonb), public.adm_assignment_dashboard(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function
  public.adm_assign_lead(uuid, uuid, text), public.adm_assign_unassigned(uuid, int),
  public.adm_set_counsellor(uuid, uuid, boolean, boolean, timestamptz, int, boolean),
  public.adm_set_sla_config(uuid, jsonb), public.adm_assignment_dashboard(uuid, timestamptz, timestamptz)
  to authenticated;

-- ------------------------------------------------------------
-- 11. Schedule the monitor every 5 minutes where pg_cron exists (Supabase has it).
--     Otherwise call `select public.adm_sla_monitor();` from any scheduler.
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('admission-sla-monitor', '*/5 * * * *', 'select public.adm_sla_monitor()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
