-- Add assigned_at column to homework_assignments table
ALTER TABLE public.homework_assignments 
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ DEFAULT now();
