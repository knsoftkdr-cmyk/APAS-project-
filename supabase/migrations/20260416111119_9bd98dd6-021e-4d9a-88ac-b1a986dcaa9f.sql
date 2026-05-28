
-- Delete related records first (foreign key dependencies)
DELETE FROM public.homework_assignments;
DELETE FROM public.homework_submissions;
DELETE FROM public.lesson_assignments;
DELETE FROM public.performance_records WHERE lesson_id IS NOT NULL;
DELETE FROM public.period_plans;
DELETE FROM public.lessons;
