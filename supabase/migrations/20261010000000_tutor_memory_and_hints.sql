-- AI Tutor memory (chat history) + Hint Engine storage. Additive only.
--
-- 1. tutor_chat_messages - the student's persistent tutor conversation, one thread per (student, mode).
--    Written ONLY by the `student-tutor-chat` edge function (service role) after it has verified the
--    caller's JWT matches the student, so there is deliberately no INSERT policy. Students can read and
--    delete (clear) their own rows, which is all the frontend needs.
--
-- 2. question_hints - cache of the 3-step hint ladder per practice question (+ language). Hints describe the
--    question, not the student, so one model call serves everyone. RLS on, no policies: service role only
--    (hints are derived from the answer key and must only be reachable through the gated edge function).
--
-- 3. practice_hint_usage - how many hints a student has been given per (practice session, question). The
--    server uses it to enforce the ladder (hint 1, then 2, then 3) and it is a record teachers/analytics can
--    use later. Service role only for now.

CREATE TABLE IF NOT EXISTS public.tutor_chat_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode        text NOT NULL DEFAULT 'tutor' CHECK (mode IN ('tutor', 'career')),
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,
  style       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tutor_chat_messages_thread_idx
  ON public.tutor_chat_messages (student_id, mode, id DESC);

ALTER TABLE public.tutor_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tutor_chat_messages_select_own" ON public.tutor_chat_messages;
CREATE POLICY "tutor_chat_messages_select_own" ON public.tutor_chat_messages
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS "tutor_chat_messages_delete_own" ON public.tutor_chat_messages;
CREATE POLICY "tutor_chat_messages_delete_own" ON public.tutor_chat_messages
  FOR DELETE TO authenticated USING (student_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.question_hints (
  item_id     uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  language    text NOT NULL DEFAULT 'en',
  hints       jsonb NOT NULL,
  model       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, language)
);
ALTER TABLE public.question_hints ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.practice_hint_usage (
  session_id  uuid NOT NULL REFERENCES public.cat_sessions(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  hints_used  int  NOT NULL DEFAULT 0 CHECK (hints_used BETWEEN 0 AND 3),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, item_id)
);
ALTER TABLE public.practice_hint_usage ENABLE ROW LEVEL SECURITY;
