-- Gamification 2.0: adaptive missions, streak freezes, tiered/adaptive badges, progression.
-- Read and written by the already-deployed update-mastery edge function (service role) via
-- action = 'g2_state' / 'g2_event' / 'g2_claim'. No new edge function.
-- Existing tables (user_gamification, xp_transactions, achievement_definitions, user_achievements)
-- are REUSED so the current Leaderboard and Gamification behaviour is unchanged.

-- 1) Streak freeze bookkeeping on the existing XP row (additive, defaults keep old rows valid).
ALTER TABLE public.user_gamification
  ADD COLUMN IF NOT EXISTS streak_freezes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_freeze_date date,
  ADD COLUMN IF NOT EXISTS freeze_earned_at_streak integer NOT NULL DEFAULT 0;

-- 2) One row per completed game round (the raw material for adaptive missions and badges).
CREATE TABLE IF NOT EXISTS public.gamification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'round_completed',
  game_id text,
  subject text,
  accuracy numeric,            -- 0..100
  score integer,
  max_score integer,
  questions_attempted integer,
  duration_seconds integer,
  xp_awarded integer NOT NULL DEFAULT 0,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gamification_events_dedupe
  ON public.gamification_events (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS gamification_events_user_time
  ON public.gamification_events (user_id, created_at DESC);

-- 3) Missions generated per student per period.
CREATE TABLE IF NOT EXISTS public.gamification_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('daily','weekly')),
  period_start date NOT NULL,
  mission_key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  metric text NOT NULL,        -- rounds | accuracy_round | xp | weak_subject_round | new_game | active_days
  target integer NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  xp_reward integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','claimed')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period, period_start, mission_key)
);
CREATE INDEX IF NOT EXISTS gamification_missions_user_period
  ON public.gamification_missions (user_id, period_start DESC);

-- RLS on, no client policies: the edge function (service role) is the only writer; students may read their own.
ALTER TABLE public.gamification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gamification_missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own gamification events" ON public.gamification_events;
CREATE POLICY "Users read own gamification events" ON public.gamification_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users read own gamification missions" ON public.gamification_missions;
CREATE POLICY "Users read own gamification missions" ON public.gamification_missions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 4) Badge catalogue: tiered + adaptive badges are ordinary achievement_definitions rows (keys prefixed g2_),
--    so the existing Achievements UI keeps listing them.
INSERT INTO public.achievement_definitions (key, title, description, icon, xp_reward, category, threshold) VALUES
  ('g2_rounds_bronze',   'Round Starter',      'Complete 5 game rounds',                         'gamepad', 20,  'g2_rounds',   5),
  ('g2_rounds_silver',   'Round Regular',      'Complete 25 game rounds',                        'gamepad', 50,  'g2_rounds',   25),
  ('g2_rounds_gold',     'Round Champion',     'Complete 100 game rounds',                       'gamepad', 120, 'g2_rounds',   100),
  ('g2_accuracy_bronze', 'Sharp Eye',          'Score 80%+ accuracy in a round',                 'target',  20,  'g2_accuracy', 80),
  ('g2_accuracy_silver', 'Sharpshooter',       'Score 90%+ accuracy in 5 rounds',                'target',  50,  'g2_accuracy', 5),
  ('g2_accuracy_gold',   'Perfectionist',      'Score 100% accuracy in 3 rounds',                'target',  120, 'g2_accuracy', 3),
  ('g2_streak_bronze',   'On a Roll',          'Reach a 3-day streak',                           'flame',   20,  'g2_streak',   3),
  ('g2_streak_silver',   'Habit Builder',      'Reach a 14-day streak',                          'flame',   60,  'g2_streak',   14),
  ('g2_streak_gold',     'Unstoppable',        'Reach a 30-day streak',                          'flame',   150, 'g2_streak',   30),
  ('g2_missions_bronze', 'Mission Rookie',     'Claim 5 missions',                               'flag',    20,  'g2_missions', 5),
  ('g2_missions_silver', 'Mission Specialist', 'Claim 25 missions',                              'flag',    60,  'g2_missions', 25),
  ('g2_missions_gold',   'Mission Master',     'Claim 75 missions',                              'flag',    150, 'g2_missions', 75),
  ('g2_comeback',        'Comeback Kid',       'Play again after 3+ days away',                  'rocket',  30,  'g2_adaptive', 3),
  ('g2_personal_best',   'Personal Best',      'Beat your own best round accuracy (min 5 rounds played)', 'trophy', 30, 'g2_adaptive', 5),
  ('g2_steady_climber',  'Steady Climber',     'Raise your 7-day average accuracy by 10+ points over the week before', 'trending-up', 50, 'g2_adaptive', 10),
  ('g2_explorer',        'Explorer',           'Play 4 different game types',                    'compass', 40,  'g2_adaptive', 4)
ON CONFLICT (key) DO NOTHING;
