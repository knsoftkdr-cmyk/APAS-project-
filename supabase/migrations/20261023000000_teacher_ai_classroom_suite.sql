-- Teacher & AI suite (sheet rows 27, 28, 40, 41, 42, 43).
--
-- No new edge function (deployment limit). Everything below is read/written by handlers in
-- supabase/functions/_shared/handlers/ that run inside already-deployed anchors:
--   ai-hooks             action quality_evaluate / quality_list      -> ai_quality_evaluations
--   ai-teacher-assistant action class_briefing                       -> teacher_class_briefings
--   ai-teacher-assistant action classroom                            -> classroom_posts / _comments / _materials
--   ai-teacher-assistant action whiteboard_draw                      (no table)
--   evaluate-assessment  action build_paper                          -> existing generated_assessment_papers
--   student-tutor-chat   (voice mode)                                -> ai_quality_evaluations (sampled replies)
--
-- RLS ON with no client policies: the handlers (service role) are the only readers/writers and do their own
-- access checks (teacher of the class / student on the roster / school staff), same as competency_missions.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 40. AI quality and safety control
create table if not exists public.ai_quality_evaluations (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid,
  source             text not null,            -- 'ai_tutor' | 'voice_tutor' | 'whiteboard' | 'class_briefing' | 'manual' | ...
  source_ref         text,                     -- optional id of the thing evaluated (message id, paper id, ...)
  requested_by       uuid,                     -- who asked for a manual check (null for automatic checks)
  content_excerpt    text not null,            -- first 2000 chars of the evaluated output (never the student's name)
  grade_band         text,
  subject            text,
  -- 0-100 per dimension, higher = safer / better
  score_hallucination   int check (score_hallucination between 0 and 100),
  score_bias            int check (score_bias between 0 and 100),
  score_alignment       int check (score_alignment between 0 and 100),
  score_privacy         int check (score_privacy between 0 and 100),
  score_age_suitability int check (score_age_suitability between 0 and 100),
  overall_score      int check (overall_score between 0 and 100),
  verdict            text not null check (verdict in ('pass','warn','block')),
  issues             jsonb not null default '[]'::jsonb,   -- [{dimension, severity, detail}]
  rule_flags         jsonb not null default '[]'::jsonb,   -- deterministic PII / banned-term hits
  evaluator_model    text,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz not null default now()
);
create index if not exists ai_quality_evaluations_school_created on public.ai_quality_evaluations (school_id, created_at desc);
create index if not exists ai_quality_evaluations_verdict on public.ai_quality_evaluations (verdict, created_at desc);
alter table public.ai_quality_evaluations enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 41. AI class briefing (one cached briefing per teacher per day; "Refresh" overwrites it)
create table if not exists public.teacher_class_briefings (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references public.profiles(id) on delete cascade,
  briefing_date date not null,
  payload       jsonb not null,
  model         text,
  created_at    timestamptz not null default now(),
  unique (teacher_id, briefing_date)
);
alter table public.teacher_class_briefings enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 43. Digital classroom workspace: stream/discussion + materials per class
create table if not exists public.classroom_posts (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'discussion' check (kind in ('announcement','discussion','question')),
  body        text not null check (length(btrim(body)) > 0 and length(body) <= 5000),
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists classroom_posts_class_created on public.classroom_posts (class_id, pinned desc, created_at desc);

create table if not exists public.classroom_post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.classroom_posts(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  created_at  timestamptz not null default now()
);
create index if not exists classroom_post_comments_post on public.classroom_post_comments (post_id, created_at);

create table if not exists public.classroom_materials (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes(id) on delete cascade,
  uploaded_by  uuid not null references public.profiles(id) on delete cascade,
  title        text not null check (length(btrim(title)) > 0),
  description  text,
  topic        text,
  kind         text not null check (kind in ('file','link')),
  url          text,          -- kind = 'link'
  storage_path text,          -- kind = 'file' (bucket classroom-materials)
  file_name    text,
  mime_type    text,
  size_bytes   bigint,
  created_at   timestamptz not null default now(),
  check ((kind = 'link' and url is not null) or (kind = 'file' and storage_path is not null))
);
create index if not exists classroom_materials_class_created on public.classroom_materials (class_id, created_at desc);

alter table public.classroom_posts enable row level security;
alter table public.classroom_post_comments enable row level security;
alter table public.classroom_materials enable row level security;

-- Private bucket; the handler hands out short-lived signed upload / download URLs, so no storage policies.
insert into storage.buckets (id, name, public, file_size_limit)
values ('classroom-materials', 'classroom-materials', false, 26214400)
on conflict (id) do nothing;
