-- ============================================================================
-- AI AUTO FLASHCARDS
--
--   flashcards              shared, curriculum-grounded cards (one row per card per topic)
--   student_flashcards      one row per (student, card): the student's own deck + SM-2 state
--   flashcard_reviews       append-only revision history (every Easy / Medium / Difficult)
--
-- Additive only. Nothing existing is altered except one new function that is only
-- ever called by the flashcards edge handler.
--
-- HOW IT PLUGS INTO DAILY REVIEW / SPACED REPETITION
--   * Cards carry their own SM-2 style schedule in student_flashcards (Difficult comes back
--     in minutes / the next day, Easy goes out to days and weeks). The Daily Review page
--     shows "flashcards due" from the same data.
--   * A Difficult card that is linked to a learning objective also calls
--     flashcard_pull_review_forward(): it can only move that objective's review_schedule.due_at
--     EARLIER (never later), so the MCQ Daily Review brings the weak concept back sooner.
--   * Flashcard ratings are SELF-assessed, so they are deliberately NOT written to
--     mastery_evidence_log (that would let a self-rating change BKT mastery / IRT data).
--
-- SECURITY MODEL (same as question_bank / review_schedule)
--   * All writes go through the cat-session edge function (service role) after it has
--     resolved the caller's own student row from the verified JWT.
--   * RLS: a student can SELECT only their own progress / history rows and only the cards in
--     their own deck. Staff can read cards / progress for their own school. No client policy
--     allows INSERT / UPDATE / DELETE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. FLASHCARDS (shared content)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid,                                   -- NULL = platform-wide book (no school)
  book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  chapter_id bigint NOT NULL REFERENCES public.curriculum_chapters(id) ON DELETE CASCADE,
  topic_id bigint NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  subtopic_id bigint REFERENCES public.subtopics(id) ON DELETE SET NULL,
  learning_objective_id bigint REFERENCES public.learning_objectives(id) ON DELETE SET NULL,

  card_type text NOT NULL CHECK (card_type IN ('definition','concept','fact','qa')),
  question text NOT NULL CHECK (length(btrim(question)) BETWEEN 5 AND 400),
  answer text NOT NULL CHECK (length(btrim(answer)) BETWEEN 1 AND 800),
  hint text CHECK (hint IS NULL OR length(hint) <= 200),
  difficulty text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),

  -- Grounding: the short passage of the APAS material this card was built from, and where it is.
  -- A card is only saved if this passage was verified to exist in the source text that was sent to the AI.
  source_excerpt text NOT NULL CHECK (length(btrim(source_excerpt)) > 0),
  source_pages int[] NOT NULL DEFAULT '{}',
  grounding text NOT NULL DEFAULT 'textbook' CHECK (grounding IN ('textbook','syllabus')),

  question_hash text NOT NULL,                      -- normalised-question fingerprint; stops duplicates
  ai_generated boolean NOT NULL DEFAULT true,
  generation_model text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  report_count int NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  created_by uuid REFERENCES public.students(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, question_hash)
);

CREATE INDEX IF NOT EXISTS idx_flashcards_topic ON public.flashcards(topic_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flashcards_chapter ON public.flashcards(chapter_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flashcards_book ON public.flashcards(book_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_lo ON public.flashcards(learning_objective_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_creator_time ON public.flashcards(created_by, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. STUDENT DECK + SCHEDULE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  flashcard_id uuid NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,

  ease_factor numeric NOT NULL DEFAULT 2.5 CHECK (ease_factor >= 1.3 AND ease_factor <= 3.0),
  interval_days int NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  repetitions int NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  lapses int NOT NULL DEFAULT 0 CHECK (lapses >= 0),

  times_seen int NOT NULL DEFAULT 0 CHECK (times_seen >= 0),      -- also the optimistic-lock version
  times_correct int NOT NULL DEFAULT 0 CHECK (times_correct >= 0), -- Easy or Medium
  easy_count int NOT NULL DEFAULT 0,
  medium_count int NOT NULL DEFAULT 0,
  difficult_count int NOT NULL DEFAULT 0,
  last_rating text CHECK (last_rating IN ('easy','medium','difficult')),
  last_reviewed_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT now(),

  reported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, flashcard_id),
  CHECK (times_correct <= times_seen)
);

CREATE INDEX IF NOT EXISTS idx_student_flashcards_due ON public.student_flashcards(student_id, due_at);
CREATE INDEX IF NOT EXISTS idx_student_flashcards_card ON public.student_flashcards(flashcard_id);

-- ---------------------------------------------------------------------------
-- 3. REVISION HISTORY (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcard_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  flashcard_id uuid NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  rating text NOT NULL CHECK (rating IN ('easy','medium','difficult')),
  correct boolean NOT NULL,
  interval_before int NOT NULL DEFAULT 0,
  interval_after int NOT NULL DEFAULT 0,
  due_after timestamptz NOT NULL,
  session_id text,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_student_time ON public.flashcard_reviews(student_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_card ON public.flashcard_reviews(flashcard_id);

-- ---------------------------------------------------------------------------
-- 4. RLS - read-only for clients; every write is service-role (edge function)
-- ---------------------------------------------------------------------------
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read flashcards" ON public.flashcards;
CREATE POLICY "Admins read flashcards" ON public.flashcards FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Staff read own school flashcards" ON public.flashcards;
CREATE POLICY "Staff read own school flashcards" ON public.flashcards FOR SELECT
  USING (
    public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin')
    AND (school_id IS NULL OR school_id = (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid()))
  );

DROP POLICY IF EXISTS "Students read cards in own deck" ON public.flashcards;
CREATE POLICY "Students read cards in own deck" ON public.flashcards FOR SELECT
  USING (
    status = 'active'
    AND id IN (
      SELECT sf.flashcard_id FROM public.student_flashcards sf
      WHERE sf.student_id IN (SELECT s.id FROM public.students s WHERE s.profile_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins read student flashcards" ON public.student_flashcards;
CREATE POLICY "Admins read student flashcards" ON public.student_flashcards FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Students read own flashcard progress" ON public.student_flashcards;
CREATE POLICY "Students read own flashcard progress" ON public.student_flashcards FOR SELECT
  USING (student_id IN (SELECT s.id FROM public.students s WHERE s.profile_id = auth.uid()));

DROP POLICY IF EXISTS "Staff read flashcard progress" ON public.student_flashcards;
CREATE POLICY "Staff read flashcard progress" ON public.student_flashcards FOR SELECT
  USING (
    public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin')
    AND student_id IN (
      SELECT s.id FROM public.students s
      JOIN public.profiles sp ON sp.id = s.profile_id
      WHERE sp.school_id = (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Admins read flashcard reviews" ON public.flashcard_reviews;
CREATE POLICY "Admins read flashcard reviews" ON public.flashcard_reviews FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Students read own flashcard reviews" ON public.flashcard_reviews;
CREATE POLICY "Students read own flashcard reviews" ON public.flashcard_reviews FOR SELECT
  USING (student_id IN (SELECT s.id FROM public.students s WHERE s.profile_id = auth.uid()));

DROP POLICY IF EXISTS "Staff read flashcard reviews" ON public.flashcard_reviews;
CREATE POLICY "Staff read flashcard reviews" ON public.flashcard_reviews FOR SELECT
  USING (
    public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin')
    AND student_id IN (
      SELECT s.id FROM public.students s
      JOIN public.profiles sp ON sp.id = s.profile_id
      WHERE sp.school_id = (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Difficult card -> bring the linked objective's Daily Review forward.
--    Can only move due_at EARLIER; never touches ease / interval / repetitions, never touches a
--    suspended schedule, never writes mastery evidence. Creates the schedule row if the student
--    has none yet for that objective (so a weak concept enters Daily Review).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flashcard_pull_review_forward(
  p_student_id uuid,
  p_learning_objective_id bigint,
  p_days int DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due timestamptz := now() + make_interval(days => GREATEST(0, LEAST(p_days, 30)));
  v_rows int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.learning_objectives lo
    WHERE lo.id = p_learning_objective_id AND lo.status = 'active'
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.review_schedule AS rs (student_id, learning_objective_id, due_at)
  VALUES (p_student_id, p_learning_objective_id, v_due)
  ON CONFLICT (student_id, learning_objective_id) DO UPDATE
    SET due_at = EXCLUDED.due_at, updated_at = now()
    WHERE rs.suspended = false AND EXCLUDED.due_at < rs.due_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.flashcard_pull_review_forward(uuid, bigint, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flashcard_pull_review_forward(uuid, bigint, int) TO service_role;

-- Grants: RLS does the row filtering; clients never write.
REVOKE INSERT, UPDATE, DELETE ON public.flashcards, public.student_flashcards, public.flashcard_reviews FROM anon, authenticated;
