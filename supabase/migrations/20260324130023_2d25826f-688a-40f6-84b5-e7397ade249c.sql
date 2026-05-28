ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS class_level text;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS lesson_content text;