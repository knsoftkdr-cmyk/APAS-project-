-- Parent-Teacher Meeting Intelligence: cache for the generated meeting brief.
--
-- OPTIONAL. The feature works without this migration (the brief is simply regenerated each time it is opened).
-- With it, an AI-written brief is stored per appointment and reused for 12 hours, or until the agenda changes,
-- so reopening a meeting card does not cost another AI call.
--
-- Deliberately a SEPARATE table, not columns on `appointments`: parents read their appointments with
-- select("*"), and this brief is teacher-side material (it is derived from the teacher's own notes and records).
-- RLS is enabled with NO policies, so no client (teacher, parent or student) can read or write it directly;
-- only the `ptm_prep` handler (service role, inside ai-teacher-assistant) touches it.

CREATE TABLE IF NOT EXISTS public.ptm_prep_briefs (
  appointment_id uuid PRIMARY KEY,
  prep           jsonb NOT NULL,
  source         text  NOT NULL DEFAULT 'ai',
  model          text,
  fingerprint    text  NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now()
);

-- Cascade when the appointment is deleted (guarded: the appointments table is not defined in these migrations).
DO $$
BEGIN
  IF to_regclass('public.appointments') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ptm_prep_briefs_appointment_fk') THEN
    ALTER TABLE public.ptm_prep_briefs
      ADD CONSTRAINT ptm_prep_briefs_appointment_fk
      FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.ptm_prep_briefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ptm_prep_briefs FROM anon, authenticated;
