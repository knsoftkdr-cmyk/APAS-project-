-- Update RLS policy to restrict teachers to their own student assessments
-- This ensures only the teacher who evaluated a student can see that student's data

-- Drop the old policy that allows teachers to read all student assessments
DROP POLICY IF EXISTS "Teachers can read all student assessments" ON public.student_assessments;

-- Create new policy: Teachers can only read assessments for students they evaluated
CREATE POLICY "Teachers can read own student assessments"
ON public.student_assessments
FOR SELECT
TO authenticated
USING (
  teacher_id = auth.uid() 
  AND get_user_role(auth.uid()) = 'teacher'
);

-- Students can still read their own assessments
-- The existing "Users can read own assessments" policy remains unchanged
