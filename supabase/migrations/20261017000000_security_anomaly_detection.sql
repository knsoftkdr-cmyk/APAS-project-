-- Security Anomaly Detection
--
-- Two tables behind the `log-audit` edge function (modes sec_record / sec_list / sec_update):
--   security_events  one row per login success / failed login / data export / record view
--   security_alerts  anomalies the detection rules raised from those events, with a review status
--
-- Both have RLS ON and NO client policies on purpose: browsers never read or write them directly.
-- The edge function (service role) checks the caller's role and school first. The feature degrades
-- gracefully if this migration has not been applied (the UI says detection is not switched on).

create table if not exists public.security_events (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid,
  user_id         uuid,
  role            text,
  event_type      text not null
                  check (event_type in ('login_success','login_failed','data_export','record_view')),
  identifier_hash text,            -- sha256 of the normalised login id; the raw id is never stored
  ip_address      text,
  device_key      text,            -- coarse "browser|os" label, not a fingerprint
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_security_events_school_time on public.security_events (school_id, created_at desc);
create index if not exists idx_security_events_user_time   on public.security_events (user_id, created_at desc);
create index if not exists idx_security_events_ident_time  on public.security_events (identifier_hash, created_at desc) where identifier_hash is not null;
create index if not exists idx_security_events_ip_time     on public.security_events (ip_address, created_at desc) where ip_address is not null;

create table if not exists public.security_alerts (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid,
  user_id      uuid,
  rule         text not null,
  severity     text not null check (severity in ('low','medium','high','critical')),
  title        text not null,
  detail       text not null,
  evidence     jsonb not null default '{}'::jsonb,
  dedupe_key   text not null unique,   -- one alert per rule/subject/time bucket; re-scans never duplicate
  status       text not null default 'open'
               check (status in ('open','acknowledged','resolved','false_positive')),
  detected_at  timestamptz not null default now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  review_note  text
);

create index if not exists idx_security_alerts_school_status on public.security_alerts (school_id, status, detected_at desc);

alter table public.security_events enable row level security;
alter table public.security_alerts enable row level security;

-- Retention: events 180 days; closed alerts 1 year. Schedule with pg_cron if wanted, e.g.
--   select cron.schedule('prune-security', '17 3 * * *', 'select public.prune_security_data()');
create or replace function public.prune_security_data() returns void
language sql security definer set search_path = public as $$
  delete from public.security_events where created_at < now() - interval '180 days';
  delete from public.security_alerts where status <> 'open' and detected_at < now() - interval '1 year';
$$;
revoke all on function public.prune_security_data() from public, anon, authenticated;
