
-- Achievement definitions (predefined badges/milestones)
CREATE TABLE public.achievement_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL DEFAULT 'trophy',
  xp_reward integer NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'general',
  threshold integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- User XP and level tracking
CREATE TABLE public.user_gamification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_xp integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 1,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_activity_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- XP transaction log
CREATE TABLE public.xp_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  xp_amount integer NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- User achievements (earned badges)
CREATE TABLE public.user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES public.achievement_definitions(id) ON DELETE CASCADE,
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);

-- RLS
ALTER TABLE public.achievement_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_gamification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

-- Achievement definitions: everyone can read
CREATE POLICY "Anyone can read achievements" ON public.achievement_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage achievements" ON public.achievement_definitions FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin') WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- User gamification: users read own, teachers read all
CREATE POLICY "Users read own gamification" ON public.user_gamification FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Teachers read all gamification" ON public.user_gamification FOR SELECT TO authenticated USING (get_user_role(auth.uid()) IN ('teacher', 'admin'));
CREATE POLICY "Users can upsert own gamification" ON public.user_gamification FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own gamification" ON public.user_gamification FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- XP transactions
CREATE POLICY "Users read own xp" ON public.xp_transactions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Teachers read all xp" ON public.xp_transactions FOR SELECT TO authenticated USING (get_user_role(auth.uid()) IN ('teacher', 'admin'));
CREATE POLICY "Users insert own xp" ON public.xp_transactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- User achievements
CREATE POLICY "Users read own achievements" ON public.user_achievements FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Teachers read all achievements" ON public.user_achievements FOR SELECT TO authenticated USING (get_user_role(auth.uid()) IN ('teacher', 'admin'));
CREATE POLICY "Users insert own achievements" ON public.user_achievements FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
