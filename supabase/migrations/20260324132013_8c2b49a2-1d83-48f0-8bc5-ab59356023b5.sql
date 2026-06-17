DROP POLICY IF EXISTS "Teachers can update performance" ON public.performance_records;

CREATE POLICY "Teachers can update performance"
ON public.performance_records
FOR UPDATE
USING (get_user_role(auth.uid()) = 'teacher'::text)
WITH CHECK (get_user_role(auth.uid()) = 'teacher'::text);