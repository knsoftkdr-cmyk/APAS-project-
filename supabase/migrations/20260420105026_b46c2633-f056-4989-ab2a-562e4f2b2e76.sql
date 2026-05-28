ALTER TABLE public.homework_submissions DROP CONSTRAINT IF EXISTS homework_submissions_student_id_fkey;

ALTER TABLE public.homework_submissions
  ADD CONSTRAINT homework_submissions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE;