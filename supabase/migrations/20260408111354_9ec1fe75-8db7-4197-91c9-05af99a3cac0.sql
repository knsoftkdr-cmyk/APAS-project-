
CREATE TABLE public.period_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID REFERENCES public.lessons(id) ON DELETE CASCADE NOT NULL,
  teacher_id UUID NOT NULL,
  class_level TEXT NOT NULL,
  section TEXT NOT NULL,
  subject TEXT,
  periods_per_week INTEGER NOT NULL DEFAULT 5,
  period_duration INTEGER NOT NULL DEFAULT 40,
  total_teaching_days INTEGER NOT NULL DEFAULT 20,
  plan_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.period_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage own period plans"
  ON public.period_plans FOR ALL
  TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Admins full access to period plans"
  ON public.period_plans FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "School admins can read period plans"
  ON public.period_plans FOR SELECT
  TO authenticated
  USING (get_user_role(auth.uid()) = 'school_admin');
