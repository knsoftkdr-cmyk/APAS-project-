
-- Security definer function to check user role without RLS recursion
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = _user_id;
$$;

-- TABLE 1: students
CREATE TABLE public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  grade text,
  curriculum text CHECK (curriculum IN ('cbse', 'ib', 'cambridge')),
  vark_type text,
  zpd_score integer,
  dominant_intelligence text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- TABLE 2: assessments
CREATE TABLE public.assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  visual_score integer,
  auditory_score integer,
  kinesthetic_score integer,
  reading_score integer,
  zpd_math integer,
  zpd_science integer,
  zpd_english integer,
  mi_scores jsonb,
  completed_at timestamptz NOT NULL DEFAULT now()
);

-- TABLE 3: lessons
CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  curriculum text,
  subject text,
  vark_target text,
  approach text,
  delivery_method text,
  duration_minutes integer,
  content jsonb,
  ai_generated boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- TABLE 4: lesson_assignments
CREATE TABLE public.lesson_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'assigned',
  assigned_at timestamptz NOT NULL DEFAULT now()
);

-- TABLE 5: performance_records
CREATE TABLE public.performance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  pretest_score integer,
  posttest_score integer,
  mastery_score integer,
  effort_score integer,
  normalized_gain numeric GENERATED ALWAYS AS (
    CASE WHEN (100 - COALESCE(pretest_score, 0)) = 0 THEN 0
    ELSE (COALESCE(posttest_score, 0) - COALESCE(pretest_score, 0))::numeric / (100 - COALESCE(pretest_score, 0))
    END
  ) STORED,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- TABLE 6: mismatch_alerts
CREATE TABLE public.mismatch_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_group text,
  lesson_type text,
  trigger_condition text,
  fail_rate integer,
  recommendation text,
  status text NOT NULL DEFAULT 'flagged',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mismatch_alerts ENABLE ROW LEVEL SECURITY;

-- ===== STUDENTS RLS =====
CREATE POLICY "Admins full access to students" ON public.students FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read all students" ON public.students FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Students can read own record" ON public.students FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Students can insert own record" ON public.students FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Students can update own record" ON public.students FOR UPDATE
  USING (profile_id = auth.uid());

-- ===== ASSESSMENTS RLS =====
CREATE POLICY "Admins full access to assessments" ON public.assessments FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read all assessments" ON public.assessments FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Students can read own assessments" ON public.assessments FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

CREATE POLICY "Students can insert own assessments" ON public.assessments FOR INSERT
  WITH CHECK (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

-- ===== LESSONS RLS =====
CREATE POLICY "Admins full access to lessons" ON public.lessons FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers full access to lessons" ON public.lessons FOR ALL
  USING (public.get_user_role(auth.uid()) = 'teacher')
  WITH CHECK (public.get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Students can read lessons" ON public.lessons FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'student');

-- ===== LESSON_ASSIGNMENTS RLS =====
CREATE POLICY "Admins full access to assignments" ON public.lesson_assignments FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers full access to assignments" ON public.lesson_assignments FOR ALL
  USING (public.get_user_role(auth.uid()) = 'teacher')
  WITH CHECK (public.get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Students can read own assignments" ON public.lesson_assignments FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

-- ===== PERFORMANCE_RECORDS RLS =====
CREATE POLICY "Admins full access to performance" ON public.performance_records FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read all performance" ON public.performance_records FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Students can read own performance" ON public.performance_records FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

CREATE POLICY "Teachers can insert performance" ON public.performance_records FOR INSERT
  WITH CHECK (public.get_user_role(auth.uid()) = 'teacher');

-- ===== MISMATCH_ALERTS RLS =====
CREATE POLICY "Admins full access to alerts" ON public.mismatch_alerts FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read alerts" ON public.mismatch_alerts FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Teachers can insert alerts" ON public.mismatch_alerts FOR INSERT
  WITH CHECK (public.get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Teachers can update alerts" ON public.mismatch_alerts FOR UPDATE
  USING (public.get_user_role(auth.uid()) = 'teacher');
