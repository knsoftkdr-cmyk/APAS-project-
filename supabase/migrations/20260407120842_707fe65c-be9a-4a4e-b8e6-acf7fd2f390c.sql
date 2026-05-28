CREATE POLICY "Students can read assigned diagnostic requests"
ON public.diagnostic_requests
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'student'
  AND status IN ('assigned', 'approved')
);