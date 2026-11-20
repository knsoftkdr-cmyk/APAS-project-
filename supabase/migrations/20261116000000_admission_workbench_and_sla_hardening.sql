-- ============================================================
-- Admissions: Counsellor Workbench + Admin dashboard queries, and hardening of the assignment / SLA engine
--
-- Builds on 20261115000000_admission_counsellor_assignment_sla.sql (kept as is; everything here is
-- CREATE OR REPLACE / additive, so it is safe whether or not that file has already been deployed).
--
-- Fixes
--  1. School holidays were never honoured: the engine read public.calendar_events, but the school calendar is
--     public.academic_calendar_events (the error was swallowed, so every holiday looked like a working day).
--  2. "Unavailable until" never returned a counsellor to the rotation (is_available=false blocked them forever).
--  3. Names in notifications were read from the base table; with the PII-encryption migration applied they are
--     ciphertext. All name / phone reads now go through adm_lead_pii(), which uses decrypted_admission_applicants
--     when it exists.
--  4. admission_lead_meta.assigned_to could be edited straight from the browser, bypassing assignment history.
--  5. A browser session could back-date / future-date an interaction and so fake an SLA result. Interaction
--     timestamps written by a signed-in user are now always the database clock.
--  6. A manual assignment racing an automatic one could hit a unique violation; manual assignment now takes the same
--     per-school lock as the rotation.
--  7. The monitor now repairs any assigned open lead that lost its running clock.
-- Adds
--  adm_get_sla_config, adm_eligible_staff, adm_workbench (the single read model for the Counsellor Workbench and the
--  admin "unassigned / overdue" queues, role-checked in the database), and a fuller adm_assignment_dashboard.
-- No new menu or module: all of it is consumed by the existing Admissions page.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Holidays: use the real school calendar
-- ------------------------------------------------------------
create or replace function public.adm_is_holiday(p_school uuid, p_day date)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if to_regclass('public.academic_calendar_events') is null then return false; end if;
  return exists (
    select 1 from public.academic_calendar_events e
    where e.school_id = p_school and lower(e.event_type) = 'holiday'
      and e.start_date::date <= p_day and coalesce(e.end_date::date, e.start_date::date) >= p_day);
exception when others then
  return false;   -- a calendar problem must never stop assignment
end;
$$;

-- ------------------------------------------------------------
-- 2. PII-safe reads of applicant names / phones
-- ------------------------------------------------------------
create or replace function public.adm_lead_pii(p_ids uuid[])
returns table (id uuid, full_name text, parent_name text, parent_phone text, parent_email text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  return query execute format(
    'select id, full_name::text, parent_name::text, parent_phone::text, parent_email::text from %s where id = any($1)',
    case when to_regclass('public.decrypted_admission_applicants') is not null
         then 'public.decrypted_admission_applicants' else 'public.admission_applicants' end)
  using p_ids;
end;
$$;

create or replace function public.adm_lead_name(p_applicant uuid)
returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select (select x.full_name from public.adm_lead_pii(array[p_applicant]) x limit 1) $$;

-- ------------------------------------------------------------
-- 3. Integrity guards
-- ------------------------------------------------------------
-- 3a. Interaction timestamps written from a signed-in session are the database clock. (Service role / system jobs,
--     which have no auth.uid(), may still set an explicit time, e.g. when importing call logs.)
create or replace function public.adm_event_server_time()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then new.created_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists trg_adm_event_server_time on public.admission_lead_events;
create trigger trg_adm_event_server_time before insert on public.admission_lead_events
  for each row execute function public.adm_event_server_time();

-- 3b. The counsellor of a lead changes only through the assignment functions (which write the history).
create or replace function public.adm_meta_assigned_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.assigned_to is distinct from old.assigned_to
     and coalesce(current_setting('apas.adm_assign', true), '') <> '1'
     and auth.uid() is not null then
    raise exception 'Use the assignment tools to change a lead''s counsellor' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_adm_meta_assigned_guard on public.admission_lead_meta;
create trigger trg_adm_meta_assigned_guard before update of assigned_to on public.admission_lead_meta
  for each row execute function public.adm_meta_assigned_guard();

-- ------------------------------------------------------------
-- 4. Rotation eligibility: "unavailable until" now returns the counsellor automatically
-- ------------------------------------------------------------
create or replace function public.adm_pick_counsellor(p_school uuid, p_last_seq bigint, p_exclude uuid default null)
returns table (profile_id uuid, rr_seq bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select c.profile_id, c.rr_seq
  from public.admission_counsellors c
  join public.profiles p on p.id = c.profile_id and p.school_id = c.school_id
  where c.school_id = p_school and c.is_active
    and (c.is_available or (c.unavailable_until is not null and c.unavailable_until <= now()))
    and (p_exclude is null or c.profile_id <> p_exclude)
    and (c.max_open_leads is null or c.max_open_leads > (
          select count(*) from public.admission_lead_assignments la
          join public.admission_applicants ap on ap.id = la.applicant_id
          where la.assigned_to = c.profile_id and not public.adm_is_terminal(ap.status)))
  order by (c.rr_seq <= p_last_seq), c.rr_seq
  limit 1;
$$;

-- ------------------------------------------------------------
-- 5. Assignment write path (history, timeline, clocks, notification), PII-safe and guarded
-- ------------------------------------------------------------
create or replace function public.adm_apply_assignment(p_applicant uuid, p_to uuid, p_by uuid, p_method text, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_school uuid; a public.admission_lead_assignments%rowtype; v_from uuid; v_name text; v_reason text;
begin
  select school_id into v_school from public.admission_applicants where id = p_applicant;
  if v_school is null then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  v_name := public.adm_lead_name(p_applicant);
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  select * into a from public.admission_lead_assignments where applicant_id = p_applicant for update;
  v_from := a.assigned_to;
  insert into public.admission_lead_assignments (applicant_id, school_id, assigned_to, assigned_at, assigned_by, method)
  values (p_applicant, v_school, p_to, now(), p_by, p_method)
  on conflict (applicant_id) do update
    set assigned_to = excluded.assigned_to, assigned_at = excluded.assigned_at, assigned_by = excluded.assigned_by,
        method = excluded.method, updated_at = now();
  insert into public.admission_assignment_history (school_id, applicant_id, from_counsellor, to_counsellor, assigned_by, method, reason)
  values (v_school, p_applicant, v_from, p_to, p_by, p_method, v_reason);
  insert into public.admission_lead_events (school_id, applicant_id, event_type, detail, created_by)
  values (v_school, p_applicant, 'assigned', jsonb_build_object('to', p_to, 'from', v_from, 'method', p_method, 'reason', v_reason), p_by);

  perform set_config('apas.adm_assign', '1', true);
  update public.admission_lead_meta set assigned_to = p_to where applicant_id = p_applicant;
  perform set_config('apas.adm_assign', '', true);

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

create or replace function public.adm_assign_lead(p_applicant uuid, p_counsellor uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_school uuid; v_cur uuid; st public.admission_assignment_state%rowtype;
begin
  select school_id into v_school from public.admission_applicants where id = p_applicant;
  perform public.adm_require_admin(v_school);
  if not exists (select 1 from public.admission_counsellors where school_id = v_school and profile_id = p_counsellor and is_active) then
    raise exception 'Choose an active counsellor of this school' using errcode = '22023';
  end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'Reason is too long (500 characters max)' using errcode = '22023'; end if;
  -- same lock as the rotation: a manual change can never interleave with an automatic one
  insert into public.admission_assignment_state (school_id) values (v_school) on conflict do nothing;
  select * into st from public.admission_assignment_state where school_id = v_school for update;
  select assigned_to into v_cur from public.admission_lead_assignments where applicant_id = p_applicant;
  if v_cur is not distinct from p_counsellor then
    return jsonb_build_object('changed', false, 'assigned_to', v_cur);
  end if;
  perform public.adm_apply_assignment(p_applicant, p_counsellor, auth.uid(), 'manual', p_reason);
  return jsonb_build_object('changed', true, 'assigned_to', p_counsellor);
end;
$$;

-- ------------------------------------------------------------
-- 6. Monitor: same behaviour as before + PII-safe names + self-repair of lost clocks
-- ------------------------------------------------------------
create or replace function public.adm_sla_monitor(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; c public.admission_sla_config; v_name text; v_assigned int; v_warned int := 0; v_breached int := 0; v_repaired int := 0;
begin
  v_assigned := public.adm_assign_waiting(null);

  -- an assigned, open lead must always have a running clock
  for r in select la.applicant_id from public.admission_lead_assignments la
           join public.admission_applicants ap on ap.id = la.applicant_id
           where la.assigned_to is not null and not public.adm_is_terminal(ap.status)
             and not exists (select 1 from public.admission_sla_cycles y where y.applicant_id = la.applicant_id and y.outcome = 'open')
           limit 500
  loop
    begin perform public.adm_ensure_cycles(r.applicant_id, p_now); v_repaired := v_repaired + 1;
    exception when others then raise warning 'sla repair failed for %: %', r.applicant_id, sqlerrm; end;
  end loop;

  -- due soon (once per clock run)
  for r in select y.* from public.admission_sla_cycles y
           where y.outcome = 'open' and y.warned_at is null and y.breached_at is null and y.due_at > p_now order by y.due_at limit 2000
  loop
    begin
      c := public.adm_sla_cfg(r.school_id);
      if r.due_at - make_interval(mins => case r.clock when 'first_response' then c.due_soon_first_minutes else c.due_soon_follow_minutes end) <= p_now then
        update public.admission_sla_cycles set warned_at = p_now where id = r.id;
        v_name := public.adm_lead_name(r.applicant_id);
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
      v_name := public.adm_lead_name(r.applicant_id);
      perform public.adm_notify(array(select distinct u from unnest(coalesce(array[r.counsellor_id], '{}') || public.adm_school_admins(r.school_id)) u where u is not null),
        'admission_sla_breached',
        case r.clock when 'first_response' then 'First response overdue' else 'Follow-up overdue' end,
        coalesce(v_name, 'A lead') || ' has missed the ' || case r.clock when 'first_response' then 'first response' else 'follow-up' end || ' deadline.', r.applicant_id);
      v_breached := v_breached + 1;
    exception when others then raise warning 'sla breach failed for %: %', r.id, sqlerrm; end;
  end loop;
  return jsonb_build_object('assigned_waiting', v_assigned, 'repaired', v_repaired, 'warned', v_warned, 'breached', v_breached);
end;
$$;

-- ------------------------------------------------------------
-- 7. Reads for the UI
-- ------------------------------------------------------------
create or replace function public.adm_sla_state(p_due timestamptz, p_soon_minutes int, p_now timestamptz default now())
returns text language sql immutable as $$
  select case when p_due is null then null
              when p_due <= p_now then 'overdue'
              when p_due - make_interval(mins => p_soon_minutes) <= p_now then 'due_soon'
              else 'on_track' end
$$;

-- Effective SLA settings for the school (defaults when the school never changed them). Any admissions staff may read.
create or replace function public.adm_get_sla_config(p_school uuid)
returns public.admission_sla_config
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_school is null or not public.is_admission_staff(p_school) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return public.adm_sla_cfg(p_school);
end;
$$;

-- People who could be made counsellors (admins decide), with their current counsellor status.
create or replace function public.adm_eligible_staff(p_school uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.adm_require_admin(p_school);
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', coalesce(p.full_name, 'Staff'), 'role', p.role,
             'is_counsellor', c.profile_id is not null, 'is_active', coalesce(c.is_active, false),
             'is_available', coalesce(c.is_available, true), 'unavailable_until', c.unavailable_until,
             'max_open_leads', c.max_open_leads,
             'accepting', coalesce(c.is_active and (c.is_available or (c.unavailable_until is not null and c.unavailable_until <= now())), false))
           order by coalesce(p.full_name, ''))
    from public.profiles p
    left join public.admission_counsellors c on c.school_id = p_school and c.profile_id = p.id
    where p.school_id = p_school and (p.role in ('principal','admin','school_admin') or p.erp_access is true)), '[]'::jsonb);
end;
$$;

-- The Counsellor Workbench read model.
--   scope 'mine'       : leads assigned to the caller (default; the only scope a counsellor may use)
--   scope 'all'        : every open lead (admin), optionally for one counsellor
--   scope 'unassigned' : open leads without a counsellor (admin)
--   scope 'overdue'    : open leads with a missed SLA clock (admin), optionally for one counsellor
-- A counsellor can never read another counsellor's workload; admins can read the whole school; another school is
-- never reachable. SLA states come from real clock rows and real interaction timestamps.
create or replace function public.adm_workbench(p_school uuid, p_scope text default 'mine', p_counsellor uuid default null, p_limit int default 300)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now(); v_uid uuid := auth.uid(); v_admin boolean; v_target uuid; v_limit int := greatest(least(coalesce(p_limit, 300), 1000), 1);
  v_tz text := 'Asia/Kolkata'; v_soon_fr int := 10; v_soon_fu int := 120; v_events text[] := '{call_answered,message_sent,message_replied,visit_scheduled,visit_completed}';
  v_day_start timestamptz; v_day_end timestamptz; v_out jsonb;
begin
  if p_school is null or not public.is_admission_staff(p_school) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_scope not in ('mine','all','unassigned','overdue') then raise exception 'Unknown scope' using errcode = '22023'; end if;
  v_admin := public.is_admission_admin(p_school);
  if not v_admin and (p_scope <> 'mine' or (p_counsellor is not null and p_counsellor is distinct from v_uid)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_target := case when p_scope = 'mine' then coalesce(p_counsellor, v_uid) else p_counsellor end;

  select timezone, due_soon_first_minutes, due_soon_follow_minutes, first_response_events
    into v_tz, v_soon_fr, v_soon_fu, v_events from public.admission_sla_config where school_id = p_school;
  v_tz := coalesce(v_tz, 'Asia/Kolkata'); v_soon_fr := coalesce(v_soon_fr, 10); v_soon_fu := coalesce(v_soon_fu, 120);
  v_events := coalesce(v_events, '{call_answered,message_sent,message_replied,visit_scheduled,visit_completed}');
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;
  v_day_end   := (date_trunc('day', v_now at time zone v_tz) + interval '1 day') at time zone v_tz;

  with base as (
    select ap.id, ap.status, ap.source, ap.created_at, ap.meeting_notes, ap.intake_id, i.grade,
           la.assigned_to, la.assigned_at, la.method as assignment_method,
           sc.score, sc.category, lm.next_follow_up_at as meta_next
    from public.admission_applicants ap
    left join public.admission_intakes i on i.id = ap.intake_id
    left join public.admission_lead_assignments la on la.applicant_id = ap.id
    left join public.admission_lead_scores sc on sc.applicant_id = ap.id
    left join public.admission_lead_meta lm on lm.applicant_id = ap.id
    where ap.school_id = p_school and not public.adm_is_terminal(ap.status)
      and case p_scope
            when 'mine'       then la.assigned_to = v_target
            when 'unassigned' then la.assigned_to is null
            else (v_target is null or la.assigned_to = v_target) end
  ), enriched as (
    select b.*,
      fr.due_at as fr_due, fr.started_at as fr_started, fu.due_at as fu_due, fu.kind as fu_kind,
      ev.first_contact_at, ev.last_contact_at, ev.contact_count, ev.last_event_type, ev.last_event_at, ev.note_count,
      sch.due as scheduled_due
    from base b
    left join public.admission_sla_cycles fr on fr.applicant_id = b.id and fr.clock = 'first_response' and fr.outcome = 'open'
    left join public.admission_sla_cycles fu on fu.applicant_id = b.id and fu.clock = 'follow_up' and fu.outcome = 'open'
    left join lateral (
      select min(e.created_at) filter (where e.event_type = any (v_events) and e.created_by is not null) as first_contact_at,
             max(e.created_at) filter (where e.event_type = any (v_events) and e.created_by is not null) as last_contact_at,
             count(*) filter (where e.event_type = any (v_events) and e.created_by is not null) as contact_count,
             count(*) filter (where e.event_type = 'follow_up_note') as note_count,
             (array_agg(e.event_type order by e.created_at desc) filter (where e.event_type <> 'assigned'))[1] as last_event_type,
             max(e.created_at) filter (where e.event_type <> 'assigned') as last_event_at
      from public.admission_lead_events e where e.applicant_id = b.id) ev on true
    left join lateral (
      select (e.detail ->> 'due')::timestamptz as due from public.admission_lead_events e
      where e.applicant_id = b.id and e.event_type = 'follow_up_scheduled' and e.detail ? 'due'
      order by e.created_at desc limit 1) sch on true
  ), shaped as (
    select e.*,
      public.adm_sla_state(e.fr_due, v_soon_fr, v_now) as fr_state,
      public.adm_sla_state(e.fu_due, v_soon_fu, v_now) as fu_state,
      (e.assigned_to is not null and e.contact_count = 0) as is_new
    from enriched e
  ), filtered as (
    select * from shaped s
    where p_scope <> 'overdue' or s.fr_state = 'overdue' or s.fu_state = 'overdue'
  ), page as (
    select f.*, row_number() over (
             order by (case when f.fr_state = 'overdue' or f.fu_state = 'overdue' then 0
                            when f.fr_state = 'due_soon' or f.fu_state = 'due_soon' then 1 else 2 end),
                      least(coalesce(f.fr_due, 'infinity'), coalesce(f.fu_due, 'infinity')), f.score desc nulls last, f.created_at) as rn
    from filtered f
    order by rn
    limit v_limit
  ), pii as (
    select * from public.adm_lead_pii(array(select id from page))
  )
  select jsonb_build_object(
    'server_now', v_now, 'timezone', v_tz, 'due_soon_first_minutes', v_soon_fr, 'due_soon_follow_minutes', v_soon_fu,
    'total', (select count(*) from filtered),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'applicant_id', p.id, 'full_name', pii.full_name, 'parent_name', pii.parent_name, 'parent_phone', pii.parent_phone,
        'parent_email', pii.parent_email, 'status', p.status, 'source', p.source, 'grade', p.grade, 'created_at', p.created_at,
        'meeting_notes', p.meeting_notes,
        'assigned_to', p.assigned_to, 'assigned_to_name', (select coalesce(pr.full_name, 'Staff') from public.profiles pr where pr.id = p.assigned_to),
        'assigned_at', p.assigned_at, 'assignment_method', p.assignment_method,
        'score', p.score, 'category', p.category,
        'first_contact_at', p.first_contact_at, 'last_contact_at', p.last_contact_at, 'contact_count', coalesce(p.contact_count, 0),
        'note_count', coalesce(p.note_count, 0), 'last_event_type', p.last_event_type, 'last_event_at', p.last_event_at,
        'next_follow_up_at', coalesce(p.scheduled_due, p.meta_next),
        'is_new', p.is_new,
        'first_response', case when p.fr_due is null then null else jsonb_build_object(
            'due_at', p.fr_due, 'started_at', p.fr_started, 'due_soon_at', p.fr_due - make_interval(mins => v_soon_fr), 'state', p.fr_state) end,
        'follow_up', case when p.fu_due is null then null else jsonb_build_object(
            'due_at', p.fu_due, 'kind', p.fu_kind, 'due_soon_at', p.fu_due - make_interval(mins => v_soon_fu), 'state', p.fu_state) end,
        'sla_state', case when 'overdue' in (p.fr_state, p.fu_state) then 'overdue'
                          when 'due_soon' in (p.fr_state, p.fu_state) then 'due_soon'
                          when p.fr_state is null and p.fu_state is null then null else 'on_track' end,
        'follow_up_today', (p.fu_due is not null and p.fu_due >= v_day_start and p.fu_due < v_day_end),
        'follow_up_pending', (p.fu_due is not null and p.fu_due >= v_day_end)
      ) order by p.rn) from page p
      left join pii on pii.id = p.id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- ------------------------------------------------------------
-- 8. Admin dashboard numbers (replaces the first version; same signature)
-- ------------------------------------------------------------
create or replace function public.adm_assignment_dashboard(p_school uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_from timestamptz := coalesce(p_from, now() - interval '30 days'); v_to timestamptz := coalesce(p_to, now()); v_now timestamptz := now();
        v_soon_fr int; v_soon_fu int; v jsonb;
begin
  perform public.adm_require_admin(p_school);
  select due_soon_first_minutes, due_soon_follow_minutes into v_soon_fr, v_soon_fu from public.admission_sla_config where school_id = p_school;
  v_soon_fr := coalesce(v_soon_fr, 10); v_soon_fu := coalesce(v_soon_fu, 120);

  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'unassigned', (select count(*) from public.admission_applicants ap left join public.admission_lead_assignments la on la.applicant_id = ap.id
                   where ap.school_id = p_school and not public.adm_is_terminal(ap.status) and la.assigned_to is null),
    'open_leads', (select count(*) from public.admission_applicants ap where ap.school_id = p_school and not public.adm_is_terminal(ap.status)),
    'overdue_first_response', (select count(*) from public.admission_sla_cycles where school_id = p_school and outcome = 'open' and clock = 'first_response' and due_at <= v_now),
    'overdue_follow_up',      (select count(*) from public.admission_sla_cycles where school_id = p_school and outcome = 'open' and clock = 'follow_up' and due_at <= v_now),
    'due_soon_first_response', (select count(*) from public.admission_sla_cycles where school_id = p_school and outcome = 'open' and clock = 'first_response' and due_at > v_now and due_at - make_interval(mins => v_soon_fr) <= v_now),
    'due_soon_follow_up',      (select count(*) from public.admission_sla_cycles where school_id = p_school and outcome = 'open' and clock = 'follow_up' and due_at > v_now and due_at - make_interval(mins => v_soon_fu) <= v_now),
    'sla', (select jsonb_build_object(
        'fr_total', count(*) filter (where clock = 'first_response' and (outcome in ('met','late') or breached_at is not null)),
        'fr_met',   count(*) filter (where clock = 'first_response' and outcome = 'met' and breached_at is null),
        'fr_avg_minutes', round((avg(extract(epoch from (completed_at - started_at)) / 60.0) filter (where clock = 'first_response' and outcome in ('met','late')))::numeric, 1),
        'fu_total', count(*) filter (where clock = 'follow_up' and (outcome in ('met','late') or breached_at is not null)),
        'fu_met',   count(*) filter (where clock = 'follow_up' and outcome = 'met' and breached_at is null))
      from public.admission_sla_cycles where school_id = p_school and started_at between v_from and v_to),
    'counsellors', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.name) from (
        select c.profile_id, coalesce(p.full_name, 'Staff') as name, c.is_active, c.is_available, c.unavailable_until, c.max_open_leads,
          (c.is_active and (c.is_available or (c.unavailable_until is not null and c.unavailable_until <= v_now))) as accepting,
          coalesce(l.open_leads, 0) as open_leads, coalesce(l.total_leads, 0) as total_leads, coalesce(l.converted, 0) as converted,
          round(100.0 * coalesce(l.converted, 0) / nullif(l.total_leads, 0), 1) as conversion_pct,
          coalesce(o.overdue_now, 0) as overdue_now, coalesce(o.due_soon_now, 0) as due_soon_now,
          coalesce(f.fr_total, 0) as fr_total, coalesce(f.fr_met, 0) as fr_met, f.fr_avg_minutes,
          coalesce(f.fu_total, 0) as fu_total, coalesce(f.fu_met, 0) as fu_met
        from public.admission_counsellors c
        left join public.profiles p on p.id = c.profile_id
        left join lateral (
          select count(*) filter (where not public.adm_is_terminal(ap.status)) as open_leads, count(*) as total_leads,
                 count(*) filter (where ap.status in ('selected','admitted')) as converted
          from public.admission_lead_assignments la join public.admission_applicants ap on ap.id = la.applicant_id
          where la.assigned_to = c.profile_id) l on true
        left join lateral (
          select count(*) filter (where y.due_at <= v_now) as overdue_now,
                 count(*) filter (where y.due_at > v_now and y.due_at - make_interval(mins => case y.clock when 'first_response' then v_soon_fr else v_soon_fu end) <= v_now) as due_soon_now
          from public.admission_sla_cycles y where y.counsellor_id = c.profile_id and y.outcome = 'open') o on true
        left join lateral (
          select count(*) filter (where y.clock = 'first_response' and (y.outcome in ('met','late') or y.breached_at is not null)) as fr_total,
                 count(*) filter (where y.clock = 'first_response' and y.outcome = 'met' and y.breached_at is null) as fr_met,
                 round((avg(extract(epoch from (y.completed_at - y.started_at)) / 60.0) filter (where y.clock = 'first_response' and y.outcome in ('met','late')))::numeric, 1) as fr_avg_minutes,
                 count(*) filter (where y.clock = 'follow_up' and (y.outcome in ('met','late') or y.breached_at is not null)) as fu_total,
                 count(*) filter (where y.clock = 'follow_up' and y.outcome = 'met' and y.breached_at is null) as fu_met
          from public.admission_sla_cycles y where y.counsellor_id = c.profile_id and y.started_at between v_from and v_to) f on true
        where c.school_id = p_school) t), '[]'::jsonb),
    'recent_assignments', coalesce((
      select jsonb_agg(jsonb_build_object('at', h.created_at, 'applicant_id', h.applicant_id, 'lead', public.adm_lead_name(h.applicant_id),
               'method', h.method, 'reason', h.reason,
               'to', (select coalesce(full_name, 'Staff') from public.profiles where id = h.to_counsellor),
               'from', (select coalesce(full_name, 'Staff') from public.profiles where id = h.from_counsellor),
               'by', (select coalesce(full_name, 'Staff') from public.profiles where id = h.assigned_by)) order by h.created_at desc)
      from (select * from public.admission_assignment_history where school_id = p_school order by created_at desc limit 15) h), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ------------------------------------------------------------
-- 9. Grants: internals stay private, the UI-facing reads / actions are for signed-in users only
-- ------------------------------------------------------------
revoke all on function
  public.adm_lead_pii(uuid[]), public.adm_lead_name(uuid), public.adm_event_server_time(), public.adm_meta_assigned_guard(),
  public.adm_sla_state(timestamptz, int, timestamptz)
  from public, anon, authenticated;
revoke all on function
  public.adm_get_sla_config(uuid), public.adm_eligible_staff(uuid), public.adm_workbench(uuid, text, uuid, int),
  public.adm_assignment_dashboard(uuid, timestamptz, timestamptz), public.adm_assign_lead(uuid, uuid, text)
  from public, anon;
grant execute on function
  public.adm_get_sla_config(uuid), public.adm_eligible_staff(uuid), public.adm_workbench(uuid, text, uuid, int),
  public.adm_assignment_dashboard(uuid, timestamptz, timestamptz), public.adm_assign_lead(uuid, uuid, text)
  to authenticated;
revoke all on function public.adm_apply_assignment(uuid, uuid, uuid, text, text), public.adm_pick_counsellor(uuid, bigint, uuid),
  public.adm_sla_monitor(timestamptz), public.adm_is_holiday(uuid, date) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 10. The SLA monitor must really be scheduled: retry now, and let admins see if it is not
-- ------------------------------------------------------------
-- (The earlier migration skipped scheduling without a trace when pg_cron was not yet enabled.)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('admission-sla-monitor', '*/5 * * * *', 'select public.adm_sla_monitor()');   -- same name: updates, never duplicates
  else
    raise notice 'pg_cron is not enabled: the SLA monitor is NOT scheduled. Enable pg_cron, then re-run this block or call cron.schedule(''admission-sla-monitor'', ''*/5 * * * *'', ''select public.adm_sla_monitor()'').';
  end if;
exception when others then
  raise notice 'pg_cron scheduling failed: %', sqlerrm;
end $$;

-- Is the monitor scheduled, and when did it last run? Admin only. Never errors: unknown is reported as unknown.
create or replace function public.adm_sla_monitor_status(p_school uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_sched boolean := false; v_last timestamptz; v_ok boolean;
begin
  perform public.adm_require_admin(p_school);
  begin
    if to_regclass('cron.job') is not null then
      execute $q$select exists (select 1 from cron.job where jobname = 'admission-sla-monitor' and active)$q$ into v_sched;
      if v_sched and to_regclass('cron.job_run_details') is not null then
        execute $q$select max(d.end_time), coalesce(bool_and(d.status = 'succeeded') filter (where d.end_time = (select max(e.end_time) from cron.job_run_details e where e.jobid = j.jobid)), true)
                   from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'admission-sla-monitor'$q$ into v_last, v_ok;
      end if;
    end if;
  exception when others then v_sched := false; v_last := null;
  end;
  return jsonb_build_object('scheduled', v_sched, 'last_run_at', v_last, 'last_run_ok', coalesce(v_ok, null), 'interval_minutes', 5);
end;
$$;
revoke all on function public.adm_sla_monitor_status(uuid) from public, anon;
grant execute on function public.adm_sla_monitor_status(uuid) to authenticated;
