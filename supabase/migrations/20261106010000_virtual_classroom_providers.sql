-- Video platform integrations: remember which external meeting a class was created on, so the teacher can get a
-- fresh host link later. The host (start) link itself is never stored: it would let anyone who can read the
-- session row, including students, start the meeting as the host.
ALTER TABLE IF EXISTS public.virtual_classroom_sessions
  ADD COLUMN IF NOT EXISTS external_provider text,
  ADD COLUMN IF NOT EXISTS external_meeting_id text;
