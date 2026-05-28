
-- Skills registry
CREATE TABLE public.ai_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  target_function TEXT NOT NULL,
  default_model TEXT,
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view active skills"
ON public.ai_skills FOR SELECT
TO authenticated
USING (is_active = true OR public.get_user_role(auth.uid()) IN ('admin','school_admin'));

CREATE POLICY "Admins manage skills insert"
ON public.ai_skills FOR INSERT
TO authenticated
WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','school_admin'));

CREATE POLICY "Admins manage skills update"
ON public.ai_skills FOR UPDATE
TO authenticated
USING (public.get_user_role(auth.uid()) IN ('admin','school_admin'));

CREATE POLICY "Admins manage skills delete"
ON public.ai_skills FOR DELETE
TO authenticated
USING (public.get_user_role(auth.uid()) IN ('admin','school_admin'));

CREATE TRIGGER trg_ai_skills_updated_at
BEFORE UPDATE ON public.ai_skills
FOR EACH ROW EXECUTE FUNCTION public.update_ai_memory_updated_at();

-- Invocation logs
CREATE TABLE public.ai_skill_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key TEXT NOT NULL,
  caller_id UUID,
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'success',
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_skill_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own invocations"
ON public.ai_skill_invocations FOR SELECT
TO authenticated
USING (caller_id = auth.uid() OR public.get_user_role(auth.uid()) IN ('admin','school_admin'));

CREATE POLICY "System inserts invocations"
ON public.ai_skill_invocations FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE INDEX idx_skill_invocations_skill_key ON public.ai_skill_invocations(skill_key);
CREATE INDEX idx_skill_invocations_caller ON public.ai_skill_invocations(caller_id);
CREATE INDEX idx_skill_invocations_created ON public.ai_skill_invocations(created_at DESC);

-- Seed core skills
INSERT INTO public.ai_skills (skill_key, name, description, category, target_function, default_model) VALUES
('lesson_plan_generator', 'Lesson Plan Generator', 'Generates structured, curriculum-aligned lesson plans with BBL pedagogy.', 'teaching', 'generate-lessons', 'google/gemini-2.5-flash'),
('homework_generator', 'Homework Generator', 'Extracts/generates homework questions from lesson plans (Exit Tickets).', 'teaching', 'curative-assistant', 'google/gemini-2.5-flash'),
('weakness_detector', 'Weakness Detector', 'Analyzes performance data to identify learning weaknesses and at-risk students.', 'analytics', 'detect-learning-issues', 'llama-3.3-70b-versatile'),
('doubt_solver', 'Doubt Solver (RAG)', 'Answers student doubts using RAG over curriculum + teacher content.', 'student', 'student-tutor-chat', 'google/gemini-2.5-flash'),
('exam_predictor', 'Exam Predictor', 'Predicts student performance and risk level on upcoming assessments.', 'analytics', 'predict-performance', 'llama-3.3-70b-versatile');
