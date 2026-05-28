CREATE POLICY "Teachers can delete own diagnostic requests"
ON public.diagnostic_requests
FOR DELETE
USING (teacher_id = auth.uid() AND get_user_role(auth.uid()) = 'teacher');