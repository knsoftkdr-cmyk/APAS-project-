-- ============================================================
-- Admissions CRM: automatic Lead Scoring (0-100)
--
--   Enquiry Interest 30% · Engagement 25% · Admission Readiness 25% · Budget & Timeline 20%
--   Hot 70-100 · Warm 40-69 · Cold 0-39
--
-- Design notes
--  * Every applicant is a lead, so the score is computed for ALL admission_applicants (not just integration leads).
--  * Calculated in Postgres from real rows (applicant, documents, lead meta, lead events, qualification) and kept
--    fresh by triggers; the browser never computes or writes a score.
--  * Missing data is NEUTRAL, not negative: a signal with no evidence is left out, factors with no evidence are
--    left out of the total (remaining weights are renormalised), and thin evidence is shrunk toward 50 rather
--    than toward 0 (see adm_factor). A lead is only Cold because of what we know, never because of what we don't.
--  * Weights / thresholds are configurable per school (admission_score_config); defaults are the spec values.
--  * Manual adjustments never overwrite the calculation: they are stored beside it with a mandatory reason, and
--    every change is appended to an audit history that clients cannot edit.
--  * Depends on 20261113000000_admission_lead_integrations.sql (events, meta, is_admission_staff).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Inputs we did not have before
-- ------------------------------------------------------------
-- Optional annual fee on an intake so a parent's budget can be compared to a real number.
alter table public.admission_intakes add column if not exists annual_fee numeric;
do $$ begin
  alter table public.admission_intakes add constraint admission_intakes_annual_fee_check check (annual_fee is null or annual_fee >= 0);
exception when duplicate_object then null; end $$;

-- Interaction types staff can log (calls, messages, visits) in addition to the existing follow-up types.
alter table public.admission_lead_events drop constraint if exists admission_lead_events_event_type_check;
alter table public.admission_lead_events add constraint admission_lead_events_event_type_check check (event_type in (
  'lead_created','repeat_enquiry','status_changed','follow_up_note','follow_up_scheduled','assigned',
  'call_answered','call_not_answered','message_sent','message_replied',
  'visit_scheduled','visit_completed','visit_missed'));

-- Staff-captured qualification (budget / timeline / interest). All optional: blank = unknown, never "bad".
create table if not exists public.admission_lead_qualification (
  applicant_id      uuid primary key references public.admission_applicants(id) on delete cascade,
  school_id         uuid not null references public.schools(id) on delete cascade,
  interest_level    text check (interest_level in ('high','medium','low')),
  interested_course text check (interested_course is null or char_length(interested_course) <= 120),
  annual_budget     numeric check (annual_budget is null or annual_budget >= 0),
  fee_affordability text check (fee_affordability in ('comfortable','manageable','stretch','unaffordable')),
  admission_timeline text check (admission_timeline in ('immediate','this_term','next_term','next_year','exploring')),
  updated_by        uuid references public.profiles(id) on delete set null,
  updated_at        timestamptz not null default now()
);
create index if not exists idx_adm_qual_school on public.admission_lead_qualification(school_id);

-- ------------------------------------------------------------
-- 2. Configuration, scores, audit history
-- ------------------------------------------------------------
create table if not exists public.admission_score_config (
  school_id      uuid primary key references public.schools(id) on delete cascade,
  weights        jsonb not null default '{"interest":30,"engagement":25,"readiness":25,"budget":20}'::jsonb,
  hot_min        int   not null default 70,
  warm_min       int   not null default 40,
  prior_weight   numeric not null default 15,
  doc_grace_days int   not null default 14,
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),
  constraint adm_cfg_thresholds check (hot_min between 2 and 100 and warm_min between 1 and 99 and warm_min < hot_min),
  constraint adm_cfg_prior check (prior_weight between 0 and 100),
  constraint adm_cfg_grace check (doc_grace_days between 0 and 365)
);

create table if not exists public.admission_lead_scores (
  applicant_id   uuid primary key references public.admission_applicants(id) on delete cascade,
  school_id      uuid not null references public.schools(id) on delete cascade,
  computed_score int  not null check (computed_score between 0 and 100),   -- what the formula says
  override_score int  check (override_score between 0 and 100),            -- staff adjustment, if any
  override_reason text,
  override_by    uuid references public.profiles(id) on delete set null,
  override_at    timestamptz,
  score          int  not null check (score between 0 and 100),            -- effective = override ?? computed
  category       text not null check (category in ('hot','warm','cold')),
  coverage       numeric not null,                                         -- % of factor weight backed by real data
  factors        jsonb not null,
  calculated_at  timestamptz not null default now(),                       -- last (re)calculation
  score_changed_at timestamptz not null default now(),                     -- last time the effective score changed
  constraint adm_score_override_pair check ((override_score is null) = (override_reason is null))
);
create index if not exists idx_adm_scores_school_cat on public.admission_lead_scores(school_id, category, score desc);
create index if not exists idx_adm_scores_calc on public.admission_lead_scores(calculated_at);

create table if not exists public.admission_lead_score_history (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  applicant_id   uuid not null references public.admission_applicants(id) on delete cascade,
  change_type    text not null check (change_type in ('auto','manual_override','manual_clear')),
  trigger_source text,                                  -- e.g. documents_changed, interaction_logged, config_changed
  old_score      int, new_score int not null,
  old_category   text, new_category text not null,
  computed_score int not null,
  reason         text,                                  -- mandatory for manual changes
  factors        jsonb,                                 -- snapshot for auto changes
  created_by     uuid references public.profiles(id) on delete set null,   -- null = system
  created_at     timestamptz not null default now(),
  constraint adm_hist_manual_reason check (change_type = 'auto' or char_length(btrim(coalesce(reason,''))) >= 5)
);
create index if not exists idx_adm_score_hist on public.admission_lead_score_history(applicant_id, created_at desc);
create index if not exists idx_adm_score_hist_school on public.admission_lead_score_history(school_id, created_at desc);

-- ------------------------------------------------------------
-- 3. Access control (school isolation + staff roles). Clients can only READ scores / history / config;
--    every write goes through the SECURITY DEFINER functions below.
-- ------------------------------------------------------------
create or replace function public.is_admission_admin(p_school uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid()
    and (p.role = 'knsoft_admin' or (p.school_id = p_school and p.role in ('principal','admin','school_admin'))));
$$;

alter table public.admission_lead_qualification enable row level security;
alter table public.admission_score_config        enable row level security;
alter table public.admission_lead_scores         enable row level security;
alter table public.admission_lead_score_history  enable row level security;

drop policy if exists adm_qual_select on public.admission_lead_qualification;
create policy adm_qual_select on public.admission_lead_qualification for select using (public.is_admission_staff(school_id));
drop policy if exists adm_cfg_select on public.admission_score_config;
create policy adm_cfg_select on public.admission_score_config for select using (public.is_admission_staff(school_id));
drop policy if exists adm_scores_select on public.admission_lead_scores;
create policy adm_scores_select on public.admission_lead_scores for select using (public.is_admission_staff(school_id));
drop policy if exists adm_score_hist_select on public.admission_lead_score_history;
create policy adm_score_hist_select on public.admission_lead_score_history for select using (public.is_admission_staff(school_id));

revoke insert, update, delete, truncate on public.admission_lead_qualification, public.admission_score_config,
  public.admission_lead_scores, public.admission_lead_score_history from anon, authenticated;
revoke all on public.admission_lead_qualification, public.admission_score_config,
  public.admission_lead_scores, public.admission_lead_score_history from anon;

-- Logging interactions: widen the allowed types, and (fixing a gap in the first policy) require that the
-- applicant really belongs to the school on the event, so staff of school A cannot touch school B's leads.
drop policy if exists adm_lead_events_insert on public.admission_lead_events;
create policy adm_lead_events_insert on public.admission_lead_events
  for insert with check (
    public.is_admission_staff(school_id)
    and event_type in ('follow_up_note','follow_up_scheduled','assigned','call_answered','call_not_answered',
                       'message_sent','message_replied','visit_scheduled','visit_completed','visit_missed')
    and (created_by is null or created_by = auth.uid())
    and exists (select 1 from public.admission_applicants a
                where a.id = admission_lead_events.applicant_id and a.school_id = admission_lead_events.school_id)
  );

-- ------------------------------------------------------------
-- 4. Calculation engine
-- ------------------------------------------------------------
create or replace function public.adm_score_config(p_school uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'weights',        coalesce(c.weights, '{"interest":30,"engagement":25,"readiness":25,"budget":20}'::jsonb),
    'hot_min',        coalesce(c.hot_min, 70),
    'warm_min',       coalesce(c.warm_min, 40),
    'prior_weight',   coalesce(c.prior_weight, 15),
    'doc_grace_days', coalesce(c.doc_grace_days, 14))
  from (select 1) d left join public.admission_score_config c on c.school_id = p_school;
$$;

create or replace function public.adm_score_category(p_score int, p_cfg jsonb)
returns text language sql immutable
as $$
  select case when p_score is null then null
              when p_score >= (p_cfg->>'hot_min')::int  then 'hot'
              when p_score >= (p_cfg->>'warm_min')::int then 'warm'
              else 'cold' end;
$$;

-- One evidence-backed signal (0-100, with a weight inside its factor). NULL score = no evidence = not included.
create or replace function public.adm_sig(p_key text, p_label text, p_score numeric, p_weight numeric, p_detail text)
returns jsonb language sql immutable
as $$
  select case when p_score is null then null else jsonb_build_object(
    'key', p_key, 'label', p_label, 'score', round(least(100, greatest(0, p_score)), 1), 'weight', p_weight, 'detail', p_detail) end;
$$;

create or replace function public.adm_sig_add(p_arr jsonb, p_sig jsonb)
returns jsonb language sql immutable
as $$ select case when p_sig is null then p_arr else p_arr || jsonb_build_array(p_sig) end; $$;

-- Factor score = weighted mean of its signals, shrunk toward the NEUTRAL midpoint (50) by a small prior so that
-- one thin signal can neither make nor break a lead:  (sum(w*s) + prior*50) / (sum(w) + prior).
-- No signals at all -> factor is "not available" and is excluded from the total.
create or replace function public.adm_factor(p_label text, p_weight numeric, p_signals jsonb, p_prior numeric)
returns jsonb language sql immutable
as $$
  select case when x.n = 0
    then jsonb_build_object('label', p_label, 'weight', p_weight, 'available', false, 'score', null, 'signals', '[]'::jsonb)
    else jsonb_build_object('label', p_label, 'weight', p_weight, 'available', true,
           'score', round((x.sws + p_prior * 50) / (x.sw + p_prior), 2), 'signals', p_signals) end
  from (select count(*) n,
               coalesce(sum((s->>'weight')::numeric), 0) sw,
               coalesce(sum((s->>'score')::numeric * (s->>'weight')::numeric), 0) sws
        from jsonb_array_elements(p_signals) s) x;
$$;

create or replace function public.adm_compute_lead_score(p_applicant uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  a public.admission_applicants%rowtype;
  i public.admission_intakes%rowtype;
  m public.admission_lead_meta%rowtype;
  q public.admission_lead_qualification%rowtype;
  cfg jsonb; prior numeric; wts jsonb;
  s_int jsonb := '[]'; s_eng jsonb := '[]'; s_rdy jsonb := '[]'; s_bud jsonb := '[]';
  -- event aggregates
  c_ans int; c_noans int; m_sent int; m_rep int; v_sched int; v_done int; v_missed int; f_notes int; n_repeat int; n_outreach int;
  last_int timestamptz; days_since numeric;
  enq_total int; filled int; docs int; ratio numeric; tl_days numeric;
  f_i jsonb; f_e jsonb; f_r jsonb; f_b jsonb;
  tot_w numeric := 0; sum_w numeric; total numeric := 0; allw numeric;
  out jsonb;
begin
  select * into a from public.admission_applicants where id = p_applicant;
  if not found then return null; end if;
  select * into i from public.admission_intakes where id = a.intake_id;
  select * into m from public.admission_lead_meta where applicant_id = a.id;
  select * into q from public.admission_lead_qualification where applicant_id = a.id;
  cfg := public.adm_score_config(a.school_id);
  prior := (cfg->>'prior_weight')::numeric;
  wts := cfg->'weights';

  select count(*) filter (where event_type = 'call_answered'),
         count(*) filter (where event_type = 'call_not_answered'),
         count(*) filter (where event_type = 'message_sent'),
         count(*) filter (where event_type = 'message_replied'),
         count(*) filter (where event_type = 'visit_scheduled'),
         count(*) filter (where event_type = 'visit_completed'),
         count(*) filter (where event_type = 'visit_missed'),
         count(*) filter (where event_type = 'follow_up_note'),
         count(*) filter (where event_type = 'repeat_enquiry'),
         count(*) filter (where event_type in ('call_answered','call_not_answered','message_sent','message_replied',
                                               'visit_scheduled','visit_completed','visit_missed','follow_up_note')),
         max(created_at) filter (where event_type in ('call_answered','message_replied','visit_scheduled','visit_completed',
                                                      'follow_up_note','repeat_enquiry'))
    into c_ans, c_noans, m_sent, m_rep, v_sched, v_done, v_missed, f_notes, n_repeat, n_outreach, last_int
    from public.admission_lead_events where applicant_id = a.id;
  if m.last_contacted_at is not null and (last_int is null or m.last_contacted_at > last_int) then last_int := m.last_contacted_at; end if;

  -- ===== 1. ENQUIRY INTEREST ==========================================================================
  -- (class = the intake they enquired for, which every lead has, so it carries no extra information.)
  s_int := public.adm_sig_add(s_int, public.adm_sig('channel', 'Enquiry channel',
    case a.source when 'referral' then 90 when 'walk_in' then 85 when 'phone_enquiry' then 70 when 'online_enquiry' then 55 else 40 end, 20,
    'Came via ' || replace(a.source, '_', ' ')));
  enq_total := greatest(coalesce(m.enquiry_count, 1), 1 + n_repeat);
  s_int := public.adm_sig_add(s_int, public.adm_sig('repeat_enquiries', 'Repeat enquiries',
    case when enq_total >= 3 then 100 when enq_total = 2 then 80 else 50 end, 25,
    enq_total || ' enquir' || case when enq_total = 1 then 'y' else 'ies' end));
  filled := (a.parent_email is not null and btrim(a.parent_email) <> '')::int + (a.date_of_birth is not null)::int
          + (a.gender is not null)::int + (a.address is not null and btrim(a.address) <> '')::int
          + (a.previous_school_name is not null and btrim(a.previous_school_name) <> '')::int
          + (a.previous_grade is not null and btrim(a.previous_grade) <> '')::int + (a.previous_percentage is not null)::int;
  s_int := public.adm_sig_add(s_int, public.adm_sig('profile_detail', 'Details shared', filled * 100.0 / 7, 20, filled || ' of 7 profile fields provided'));
  if a.sibling_studying_here then
    s_int := public.adm_sig_add(s_int, public.adm_sig('sibling', 'Sibling studies here', 100, 15, 'Existing family at the school'));
  end if;
  s_int := public.adm_sig_add(s_int, public.adm_sig('staff_interest', 'Interest level (staff assessed)',
    case q.interest_level when 'high' then 100 when 'medium' then 60 when 'low' then 20 end, 20, 'Interest: ' || q.interest_level));
  if q.interested_course is not null and btrim(q.interested_course) <> '' then
    s_int := public.adm_sig_add(s_int, public.adm_sig('course', 'Specific course / stream named', 80, 10, q.interested_course));
  end if;

  -- ===== 2. ENGAGEMENT ================================================================================
  if c_ans + c_noans > 0 then
    s_eng := public.adm_sig_add(s_eng, public.adm_sig('call_connect', 'Calls answered', c_ans * 100.0 / (c_ans + c_noans), 30,
      c_ans || ' of ' || (c_ans + c_noans) || ' calls answered'));
  end if;
  if m_sent + m_rep > 0 then
    s_eng := public.adm_sig_add(s_eng, public.adm_sig('reply_rate', 'Messages replied to', least(1, m_rep::numeric / greatest(m_sent, m_rep)) * 100, 25,
      m_rep || ' repl' || case when m_rep = 1 then 'y' else 'ies' end || ' to ' || m_sent || ' message' || case when m_sent = 1 then '' else 's' end));
  end if;
  if f_notes > 0 then
    s_eng := public.adm_sig_add(s_eng, public.adm_sig('follow_ups', 'Follow-ups held',
      case when f_notes >= 3 then 100 when f_notes = 2 then 75 else 50 end, 15, f_notes || ' follow-up' || case when f_notes = 1 then '' else 's' end));
  end if;
  if n_outreach > 0 or n_repeat > 0 then       -- some outreach/response was recorded, so "0 interactions" is real evidence
    declare k int := c_ans + m_rep + v_done + n_repeat; begin
      s_eng := public.adm_sig_add(s_eng, public.adm_sig('interactions', 'Parent interactions',
        case when k >= 4 then 100 when k = 3 then 85 when k = 2 then 65 when k = 1 then 40 else 0 end, 15,
        k || ' response' || case when k = 1 then '' else 's' end || ' / interaction' || case when k = 1 then '' else 's' end));
    end;
  end if;
  if last_int is not null then
    days_since := extract(epoch from (now() - last_int)) / 86400;
    s_eng := public.adm_sig_add(s_eng, public.adm_sig('recency', 'Recent contact',
      case when days_since <= 3 then 100 when days_since <= 7 then 85 when days_since <= 14 then 65
           when days_since <= 30 then 40 when days_since <= 60 then 20 else 10 end, 15,
      'Last interaction ' || floor(days_since) || ' day' || case when floor(days_since) = 1 then '' else 's' end || ' ago'));
  end if;

  -- ===== 3. ADMISSION READINESS =======================================================================
  s_rdy := public.adm_sig_add(s_rdy, public.adm_sig('status', 'Application progress',
    case a.status when 'under_review' then 40 when 'shortlisted' then 70 when 'waitlisted' then 55 when 'selected' then 90
                  when 'admitted' then 100 else 0 end, 30, 'Status: ' || replace(a.status, '_', ' ')));
  select count(distinct document_type) into docs from public.admission_documents
   where applicant_id = a.id and document_type in ('report_card','birth_certificate','id_proof','photo');
  if docs > 0 or now() - a.created_at >= make_interval(days => (cfg->>'doc_grace_days')::int) then
    -- a brand-new lead with no documents yet is "not asked yet", not "unready": no penalty until the grace period passes
    s_rdy := public.adm_sig_add(s_rdy, public.adm_sig('documents', 'Documents submitted', docs * 25, 35, docs || ' of 4 core documents'));
  end if;
  if v_done > 0 or a.source = 'walk_in' then
    s_rdy := public.adm_sig_add(s_rdy, public.adm_sig('visit', 'Campus visit', 100, 35,
      case when v_done > 0 then 'Visit completed' else 'Met in person (walk-in)' end));
  elsif v_sched > 0 and v_missed = 0 then
    s_rdy := public.adm_sig_add(s_rdy, public.adm_sig('visit', 'Campus visit', 60, 35, 'Visit scheduled'));
  elsif v_missed > 0 then
    s_rdy := public.adm_sig_add(s_rdy, public.adm_sig('visit', 'Campus visit', 15, 35, 'Missed a scheduled visit'));
  end if;

  -- ===== 4. BUDGET & TIMELINE =========================================================================
  if q.annual_budget is not null and i.annual_fee is not null and i.annual_fee > 0 then
    ratio := q.annual_budget / i.annual_fee;
    s_bud := public.adm_sig_add(s_bud, public.adm_sig('affordability', 'Fee affordability',
      case when ratio >= 1 then 100 when ratio >= 0.85 then 75 when ratio >= 0.7 then 45 else 15 end, 55,
      'Budget covers ' || round(least(ratio, 9.99) * 100) || '% of the annual fee'));
  elsif q.fee_affordability is not null then
    s_bud := public.adm_sig_add(s_bud, public.adm_sig('affordability', 'Fee affordability',
      case q.fee_affordability when 'comfortable' then 100 when 'manageable' then 75 when 'stretch' then 45 else 10 end, 55,
      'Staff assessed: ' || q.fee_affordability));
  end if;
  s_bud := public.adm_sig_add(s_bud, public.adm_sig('timeline', 'Expected admission timeline',
    case q.admission_timeline when 'immediate' then 100 when 'this_term' then 80 when 'next_term' then 60 when 'next_year' then 35 when 'exploring' then 20 end, 45,
    'Plans to join: ' || replace(q.admission_timeline, '_', ' ')));

  -- ===== combine ======================================================================================
  f_i := public.adm_factor('Enquiry Interest',   (wts->>'interest')::numeric,   s_int, prior);
  f_e := public.adm_factor('Engagement',         (wts->>'engagement')::numeric, s_eng, prior);
  f_r := public.adm_factor('Admission Readiness',(wts->>'readiness')::numeric,  s_rdy, prior);
  f_b := public.adm_factor('Budget & Timeline',  (wts->>'budget')::numeric,     s_bud, prior);
  allw := (wts->>'interest')::numeric + (wts->>'engagement')::numeric + (wts->>'readiness')::numeric + (wts->>'budget')::numeric;
  -- Only factors with evidence count; their weights are renormalised so unknown != low.
  select coalesce(sum((f->>'weight')::numeric), 0), coalesce(sum((f->>'weight')::numeric * (f->>'score')::numeric), 0)
    into tot_w, total
    from unnest(array[f_i, f_e, f_r, f_b]) f where (f->>'available')::boolean;
  if tot_w = 0 then return null; end if;
  sum_w := tot_w;
  -- points each available factor adds to the final 0-100 number (they sum to the total)
  f_i := f_i || jsonb_build_object('contribution', case when (f_i->>'available')::boolean then round((f_i->>'weight')::numeric / sum_w * (f_i->>'score')::numeric, 2) end);
  f_e := f_e || jsonb_build_object('contribution', case when (f_e->>'available')::boolean then round((f_e->>'weight')::numeric / sum_w * (f_e->>'score')::numeric, 2) end);
  f_r := f_r || jsonb_build_object('contribution', case when (f_r->>'available')::boolean then round((f_r->>'weight')::numeric / sum_w * (f_r->>'score')::numeric, 2) end);
  f_b := f_b || jsonb_build_object('contribution', case when (f_b->>'available')::boolean then round((f_b->>'weight')::numeric / sum_w * (f_b->>'score')::numeric, 2) end);

  out := jsonb_build_object(
    'score', round(total / sum_w, 2),
    'coverage', round(tot_w / nullif(allw, 0) * 100, 0),
    'factors', jsonb_build_object('interest', f_i, 'engagement', f_e, 'readiness', f_r, 'budget', f_b),
    'config', cfg);
  return out;
end;
$$;

-- Persist the effective score + audit trail. Internal: not callable by clients.
create or replace function public.adm_recalc_lead_score(p_applicant uuid, p_source text default 'auto')
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  a_school uuid; calc jsonb; cfg jsonb; v_computed int; v_final int; v_cat text; old public.admission_lead_scores%rowtype;
begin
  select school_id into a_school from public.admission_applicants where id = p_applicant;
  if a_school is null then return; end if;                 -- applicant is gone (e.g. cascade delete)
  calc := public.adm_compute_lead_score(p_applicant);
  if calc is null then return; end if;
  cfg := calc->'config';
  v_computed := round((calc->>'score')::numeric)::int;
  select * into old from public.admission_lead_scores where applicant_id = p_applicant;
  v_final := coalesce(old.override_score, v_computed);
  v_cat := public.adm_score_category(v_final, cfg);

  insert into public.admission_lead_scores as s (applicant_id, school_id, computed_score, score, category, coverage, factors, calculated_at, score_changed_at)
  values (p_applicant, a_school, v_computed, v_final, v_cat, (calc->>'coverage')::numeric, calc->'factors', now(), now())
  on conflict (applicant_id) do update set
    computed_score = excluded.computed_score, score = excluded.score, category = excluded.category,
    coverage = excluded.coverage, factors = excluded.factors, calculated_at = now(),
    score_changed_at = case when s.score is distinct from excluded.score then now() else s.score_changed_at end;

  if old.applicant_id is null
     or old.score is distinct from v_final or old.computed_score is distinct from v_computed or old.category is distinct from v_cat then
    insert into public.admission_lead_score_history
      (school_id, applicant_id, change_type, trigger_source, old_score, new_score, old_category, new_category, computed_score, factors, created_by)
    values (a_school, p_applicant, 'auto', p_source, old.score, v_final, old.category, v_cat, v_computed, calc->'factors', null);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 5. Automatic recalculation (a scoring problem must never block admissions work, so errors are swallowed)
-- ------------------------------------------------------------
create or replace function public.adm_score_trigger()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_src text := tg_argv[0];
begin
  begin
    if tg_table_name = 'admission_applicants' then v_id := new.id;
    elsif tg_op = 'DELETE' then v_id := old.applicant_id;
    else v_id := new.applicant_id; end if;
    perform public.adm_recalc_lead_score(v_id, v_src);
  exception when others then
    raise warning 'lead score recalculation failed for % (%): %', v_id, v_src, sqlerrm;
  end;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_score_applicant_ins on public.admission_applicants;
create trigger trg_score_applicant_ins after insert on public.admission_applicants
  for each row execute function public.adm_score_trigger('applicant_created');
drop trigger if exists trg_score_applicant_upd on public.admission_applicants;
create trigger trg_score_applicant_upd
  after update of status, source, intake_id, parent_email, date_of_birth, gender, address, previous_school_name,
                  previous_grade, previous_percentage, sibling_studying_here on public.admission_applicants
  for each row execute function public.adm_score_trigger('applicant_updated');
drop trigger if exists trg_score_documents on public.admission_documents;
create trigger trg_score_documents after insert or update or delete on public.admission_documents
  for each row execute function public.adm_score_trigger('documents_changed');
drop trigger if exists trg_score_events on public.admission_lead_events;
create trigger trg_score_events after insert on public.admission_lead_events
  for each row execute function public.adm_score_trigger('interaction_logged');
drop trigger if exists trg_score_meta on public.admission_lead_meta;
create trigger trg_score_meta after insert or update of enquiry_count, last_contacted_at on public.admission_lead_meta
  for each row execute function public.adm_score_trigger('enquiry_updated');
drop trigger if exists trg_score_qualification on public.admission_lead_qualification;
create trigger trg_score_qualification after insert or update on public.admission_lead_qualification
  for each row execute function public.adm_score_trigger('qualification_updated');

create or replace function public.adm_score_intake_trigger()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record;
begin
  for r in select id from public.admission_applicants where intake_id = new.id loop
    begin perform public.adm_recalc_lead_score(r.id, 'intake_fee_changed');
    exception when others then raise warning 'lead score recalculation failed for %: %', r.id, sqlerrm; end;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_score_intake on public.admission_intakes;
create trigger trg_score_intake after update of annual_fee on public.admission_intakes
  for each row when (old.annual_fee is distinct from new.annual_fee) execute function public.adm_score_intake_trigger();

-- Time-based signals (recency, documents grace period) age without any row changing, so refresh stale scores
-- periodically. Scheduled below when pg_cron is available; otherwise call it from any scheduler.
create or replace function public.adm_refresh_lead_scores(p_max int default 1000, p_older_than interval default interval '20 hours')
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; n int := 0;
begin
  for r in select a.id from public.admission_applicants a
           left join public.admission_lead_scores s on s.applicant_id = a.id
           where s.applicant_id is null or s.calculated_at < now() - p_older_than
           order by s.calculated_at nulls first limit p_max loop
    -- one lead that cannot be scored (e.g. a corrupt school config) must not stop everyone else's refresh
    begin perform public.adm_recalc_lead_score(r.id, 'scheduled_refresh'); n := n + 1;
    exception when others then raise warning 'scheduled refresh failed for %: %', r.id, sqlerrm; end;
  end loop;
  return n;
end;
$$;
revoke all on function public.adm_refresh_lead_scores(int, interval) from public, anon, authenticated;
grant execute on function public.adm_refresh_lead_scores(int, interval) to service_role;

-- ------------------------------------------------------------
-- 6. Staff actions (all authorise against the caller's school; none trust a client-supplied school id)
-- ------------------------------------------------------------
create or replace function public.adm_set_lead_score_override(p_applicant uuid, p_score int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_school uuid; s public.admission_lead_scores%rowtype; v_cat text; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select school_id into v_school from public.admission_applicants where id = p_applicant;
  if v_school is null or not public.is_admission_staff(v_school) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_score is null or p_score < 0 or p_score > 100 then raise exception 'Score must be between 0 and 100' using errcode = '22023'; end if;
  if char_length(v_reason) < 5 then raise exception 'Please give a reason (at least 5 characters)' using errcode = '22023'; end if;
  if char_length(v_reason) > 500 then raise exception 'Reason is too long (500 characters max)' using errcode = '22023'; end if;
  perform public.adm_recalc_lead_score(p_applicant, 'before_manual_change');
  select * into s from public.admission_lead_scores where applicant_id = p_applicant for update;
  v_cat := public.adm_score_category(p_score, public.adm_score_config(v_school));
  update public.admission_lead_scores
     set override_score = p_score, override_reason = v_reason, override_by = auth.uid(), override_at = now(),
         score = p_score, category = v_cat, score_changed_at = case when s.score <> p_score then now() else s.score_changed_at end
   where applicant_id = p_applicant;
  insert into public.admission_lead_score_history (school_id, applicant_id, change_type, old_score, new_score, old_category, new_category, computed_score, reason, created_by)
  values (v_school, p_applicant, 'manual_override', s.score, p_score, s.category, v_cat, s.computed_score, v_reason, auth.uid());
  return (select to_jsonb(x) from public.admission_lead_scores x where applicant_id = p_applicant);
end;
$$;

create or replace function public.adm_clear_lead_score_override(p_applicant uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_school uuid; s public.admission_lead_scores%rowtype; v_cat text; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select school_id into v_school from public.admission_applicants where id = p_applicant;
  if v_school is null or not public.is_admission_staff(v_school) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if char_length(v_reason) < 5 then raise exception 'Please give a reason (at least 5 characters)' using errcode = '22023'; end if;
  perform public.adm_recalc_lead_score(p_applicant, 'before_manual_change');
  select * into s from public.admission_lead_scores where applicant_id = p_applicant for update;
  if s.override_score is null then raise exception 'There is no manual adjustment to remove' using errcode = '22023'; end if;
  v_cat := public.adm_score_category(s.computed_score, public.adm_score_config(v_school));
  update public.admission_lead_scores
     set override_score = null, override_reason = null, override_by = null, override_at = null,
         score = s.computed_score, category = v_cat, score_changed_at = case when s.score <> s.computed_score then now() else s.score_changed_at end
   where applicant_id = p_applicant;
  insert into public.admission_lead_score_history (school_id, applicant_id, change_type, old_score, new_score, old_category, new_category, computed_score, reason, created_by)
  values (v_school, p_applicant, 'manual_clear', s.score, s.computed_score, s.category, v_cat, s.computed_score, v_reason, auth.uid());
  return (select to_jsonb(x) from public.admission_lead_scores x where applicant_id = p_applicant);
end;
$$;

-- Budget / timeline / interest capture. Blank = unknown (stored NULL, scored neutrally).
create or replace function public.adm_save_lead_qualification(
  p_applicant uuid, p_interest_level text, p_interested_course text, p_annual_budget numeric,
  p_fee_affordability text, p_admission_timeline text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_school uuid;
begin
  select school_id into v_school from public.admission_applicants where id = p_applicant;
  if v_school is null or not public.is_admission_staff(v_school) then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.admission_lead_qualification as q (applicant_id, school_id, interest_level, interested_course, annual_budget, fee_affordability, admission_timeline, updated_by, updated_at)
  values (p_applicant, v_school, nullif(btrim(p_interest_level), ''), nullif(btrim(p_interested_course), ''), p_annual_budget,
          nullif(btrim(p_fee_affordability), ''), nullif(btrim(p_admission_timeline), ''), auth.uid(), now())
  on conflict (applicant_id) do update set interest_level = excluded.interest_level, interested_course = excluded.interested_course,
    annual_budget = excluded.annual_budget, fee_affordability = excluded.fee_affordability,
    admission_timeline = excluded.admission_timeline, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- Future-facing configuration (no UI yet): school admins can retune weights / thresholds; all scores are recalculated.
create or replace function public.adm_set_score_config(p_school uuid, p_settings jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  cur jsonb := public.adm_score_config(p_school); w jsonb; tot numeric; k text; r record; n int := 0;
begin
  if not public.is_admission_admin(p_school) then raise exception 'Not allowed' using errcode = '42501'; end if;
  w := coalesce(p_settings->'weights', cur->'weights');
  foreach k in array array['interest','engagement','readiness','budget'] loop
    if w->k is null or jsonb_typeof(w->k) <> 'number' or (w->>k)::numeric < 0 then
      raise exception 'Weight "%" must be a non-negative number', k using errcode = '22023';
    end if;
  end loop;
  tot := (w->>'interest')::numeric + (w->>'engagement')::numeric + (w->>'readiness')::numeric + (w->>'budget')::numeric;
  if tot <> 100 then raise exception 'Weights must add up to 100 (they add up to %)', tot using errcode = '22023'; end if;
  insert into public.admission_score_config as c (school_id, weights, hot_min, warm_min, prior_weight, doc_grace_days, updated_by, updated_at)
  values (p_school, w,
          coalesce((p_settings->>'hot_min')::int, (cur->>'hot_min')::int), coalesce((p_settings->>'warm_min')::int, (cur->>'warm_min')::int),
          coalesce((p_settings->>'prior_weight')::numeric, (cur->>'prior_weight')::numeric),
          coalesce((p_settings->>'doc_grace_days')::int, (cur->>'doc_grace_days')::int), auth.uid(), now())
  on conflict (school_id) do update set weights = excluded.weights, hot_min = excluded.hot_min, warm_min = excluded.warm_min,
    prior_weight = excluded.prior_weight, doc_grace_days = excluded.doc_grace_days, updated_by = auth.uid(), updated_at = now();
  for r in select id from public.admission_applicants where school_id = p_school loop
    begin perform public.adm_recalc_lead_score(r.id, 'config_changed'); n := n + 1;
    exception when others then raise warning 'recalculation failed for %: %', r.id, sqlerrm; end;
  end loop;
  return public.adm_score_config(p_school) || jsonb_build_object('recalculated', n);
end;
$$;

revoke all on function public.adm_compute_lead_score(uuid), public.adm_recalc_lead_score(uuid, text) from public, anon, authenticated;
grant execute on function public.adm_compute_lead_score(uuid), public.adm_recalc_lead_score(uuid, text) to service_role;
revoke all on function public.adm_set_lead_score_override(uuid, int, text), public.adm_clear_lead_score_override(uuid, text),
  public.adm_save_lead_qualification(uuid, text, text, numeric, text, text), public.adm_set_score_config(uuid, jsonb) from public, anon;
grant execute on function public.adm_set_lead_score_override(uuid, int, text), public.adm_clear_lead_score_override(uuid, text),
  public.adm_save_lead_qualification(uuid, text, text, numeric, text, text), public.adm_set_score_config(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 7. Backfill existing applicants, and schedule the daily refresh where pg_cron exists
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.admission_applicants loop
    begin perform public.adm_recalc_lead_score(r.id, 'backfill');
    exception when others then raise warning 'backfill failed for %: %', r.id, sqlerrm; end;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('admission-lead-score-refresh', '15 1 * * *', 'select public.adm_refresh_lead_scores()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
