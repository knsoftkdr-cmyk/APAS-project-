
-- Add RLS policies for school_admin role (new "Admin" role)
-- school_admin can: view classes, manage classes & students, view reports & analytics

-- Classes: full access for school_admin
CREATE POLICY "School admins full access to classes"
ON public.classes FOR ALL TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin')
WITH CHECK (get_user_role(auth.uid()) = 'school_admin');

-- Class students: full access for school_admin
CREATE POLICY "School admins full access to class_students"
ON public.class_students FOR ALL TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin')
WITH CHECK (get_user_role(auth.uid()) = 'school_admin');

-- Class teachers: full access for school_admin
CREATE POLICY "School admins full access to class_teachers"
ON public.class_teachers FOR ALL TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin')
WITH CHECK (get_user_role(auth.uid()) = 'school_admin');

-- Students: full access for school_admin
CREATE POLICY "School admins full access to students"
ON public.students FOR ALL TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin')
WITH CHECK (get_user_role(auth.uid()) = 'school_admin');

-- Profiles: school_admin can read all profiles
CREATE POLICY "School admins can read all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin');

-- Assessments: school_admin can read
CREATE POLICY "School admins can read assessments"
ON public.assessments FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin');

-- Performance records: school_admin can read
CREATE POLICY "School admins can read performance"
ON public.performance_records FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin');

-- Student assessments: school_admin can read
CREATE POLICY "School admins can read student assessments"
ON public.student_assessments FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin');

-- Teacher assessments: school_admin can read
CREATE POLICY "School admins can read teacher assessments"
ON public.teacher_assessments FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin');

-- Diagnostic requests: school_admin can read (no approval)
CREATE POLICY "School admins can read diagnostic requests"
ON public.diagnostic_requests FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin');

-- Diagnostic submissions: school_admin can read
CREATE POLICY "School admins can read diagnostic submissions"
ON public.diagnostic_submissions FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin');

-- Lessons: school_admin can read
CREATE POLICY "School admins can read lessons"
ON public.lessons FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'school_admin');

-- Governance notifications: school_admin can read own and insert
CREATE POLICY "School admins can insert notifications"
ON public.governance_notifications FOR INSERT TO authenticated
WITH CHECK (get_user_role(auth.uid()) = 'school_admin');
