
-- Classes table
CREATE TABLE public.classes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'A',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint on name + section
ALTER TABLE public.classes ADD CONSTRAINT classes_name_section_unique UNIQUE (name, section);

-- Class-Student assignments
CREATE TABLE public.class_students (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id),
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id)
);

-- Class-Teacher assignments
CREATE TABLE public.class_teachers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id),
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (class_id, teacher_id)
);

-- Teacher question assignments (diagnostic questions)
CREATE TABLE public.teacher_question_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  age_group INTEGER NOT NULL,
  question_indices JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS for classes
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to classes" ON public.classes
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read classes" ON public.classes
  FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Students can read classes" ON public.classes
  FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = 'student');

-- RLS for class_students
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to class_students" ON public.class_students
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read class_students" ON public.class_students
  FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Students can read own class assignment" ON public.class_students
  FOR SELECT TO authenticated
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

-- RLS for class_teachers
ALTER TABLE public.class_teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to class_teachers" ON public.class_teachers
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read own class assignment" ON public.class_teachers
  FOR SELECT TO authenticated
  USING (teacher_id = auth.uid());

-- RLS for teacher_question_assignments
ALTER TABLE public.teacher_question_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to question assignments" ON public.teacher_question_assignments
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read own question assignments" ON public.teacher_question_assignments
  FOR SELECT TO authenticated
  USING (teacher_id = auth.uid());
