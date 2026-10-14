-- Competency Missions: gamification tied to verified mastery, not arbitrary points.
--
-- Served by the already-deployed `update-mastery` edge function (actions cm_state / cm_claim; no new function).
-- Missions are generated from a student's own student_mastery rows and completed ONLY when the server sees the BKT
-- mastery score cross the target AND enough graded evidence in mastery_evidence_log (spread over several days).
-- XP is paid once per skill tier, into the existing user_gamification / xp_transactions, so levels and the
-- Leaderboard pick it up with no other change.
--
-- RLS ON, no client policies: the edge function (service role) is the only reader/writer.

create table if not exists public.competency_missions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  student_id            uuid not null,
  kind                  text not null check (kind in ('level_up','topic_quest')),
  scope_key             text not null,          -- "lo:123:proficient" | "topic:45:65": what the mission is about
  title                 text not null,
  description           text not null,
  subject               text,
  topic_id              bigint,
  topic_name            text,
  learning_objective_id bigint,
  tier_from             text,
  tier_to               text,
  start_value           numeric not null,       -- mastery (0..1) when the mission was created
  target_value          numeric not null,       -- mastery (0..1) to reach
  xp_reward             integer not null,
  min_evidence          integer not null,       -- graded answers needed since the mission started
  min_correct           integer not null,
  min_days              integer not null,       -- distinct calendar days those answers must span
  meta                  jsonb not null default '{}'::jsonb,   -- topic quests: objective_ids, coverage_needed
  progress              numeric not null default 0,
  evidence_count        integer not null default 0,
  correct_count         integer not null default 0,
  status                text not null default 'active' check (status in ('active','completed','claimed','expired')),
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  completed_at          timestamptz,
  claimed_at            timestamptz
);

-- never two live missions for the same thing
create unique index if not exists competency_missions_live_scope
  on public.competency_missions (user_id, scope_key) where status in ('active','completed');
create index if not exists competency_missions_user_status
  on public.competency_missions (user_id, status, created_at desc);

-- One row per paid milestone. UNIQUE(user_id, scope_key) = a skill tier or topic target can only ever pay XP once,
-- so forgetting and re-learning something can't be farmed.
create table if not exists public.competency_xp_awards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  scope_key  text not null,
  mission_id uuid,
  xp         integer not null,
  awarded_at timestamptz not null default now(),
  unique (user_id, scope_key)
);

alter table public.competency_missions enable row level security;
alter table public.competency_xp_awards enable row level security;
