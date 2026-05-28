CREATE POLICY "Teachers can insert students"
ON public.students
FOR INSERT
TO authenticated
WITH CHECK (get_user_role(auth.uid()) = 'teacher'::text);