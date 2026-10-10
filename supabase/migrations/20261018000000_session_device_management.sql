-- Session & Device Management
--
-- Behind the `log-audit` edge function (modes sess_heartbeat / sess_list / sess_revoke / sess_revoke_others /
-- sess_admin_revoke_user). Supabase already keeps every login in auth.sessions; this adds
--   * two service-role-only RPCs to list / end those sessions (ending one cascades to its refresh tokens,
--     so the device cannot silently renew its login), and
--   * user_sessions: friendly device labels, first/last seen and a revoke trail per session.
-- RLS on, no client policies: browsers never touch these directly.

create table if not exists public.user_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  school_id     uuid,
  session_id    uuid not null,            -- the `session_id` claim of the login's JWT = auth.sessions.id
  device_label  text,                     -- "Chrome on Windows"
  browser       text,
  os            text,
  kind          text,                     -- desktop | mobile | tablet | app
  ip_address    text,
  user_agent    text,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text,                     -- user | user_others | admin
  unique (user_id, session_id)
);

create index if not exists idx_user_sessions_user_seen on public.user_sessions (user_id, last_seen desc);
alter table public.user_sessions enable row level security;

-- One jsonb row per live login of a user. to_jsonb keeps this working across auth versions
-- (older ones have no user_agent / ip / refreshed_at columns; they just come back absent).
create or replace function public.list_auth_sessions(p_user_id uuid)
returns setof jsonb
language sql security definer set search_path = public, auth as $$
  select to_jsonb(s) from auth.sessions s where s.user_id = p_user_id;
$$;

-- End sessions of a user. p_session_id: only that one. p_except: all but that one. Neither: all of them.
create or replace function public.revoke_auth_sessions(p_user_id uuid, p_session_id uuid default null, p_except uuid default null)
returns integer
language plpgsql security definer set search_path = public, auth as $$
declare n integer;
begin
  delete from auth.sessions
   where user_id = p_user_id
     and (p_session_id is null or id = p_session_id)
     and (p_except is null or id <> p_except);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.list_auth_sessions(uuid) from public, anon, authenticated;
revoke all on function public.revoke_auth_sessions(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_auth_sessions(uuid) to service_role;
grant execute on function public.revoke_auth_sessions(uuid, uuid, uuid) to service_role;

create or replace function public.prune_session_data() returns void
language sql security definer set search_path = public as $$
  delete from public.user_sessions where last_seen < now() - interval '90 days';
$$;
revoke all on function public.prune_session_data() from public, anon, authenticated;
