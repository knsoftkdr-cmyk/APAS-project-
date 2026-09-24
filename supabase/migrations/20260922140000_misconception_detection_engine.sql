-- ============================================================================
-- MISCONCEPTION DETECTION ENGINE (module 10)
--
-- The Knowledge Graph Engine (module 2) already catalogues *known* possible
-- misconceptions per concept (concept_misconceptions), and the IRT/CAT
-- Engine (module 5) already tags each MCQ distractor with which of those
-- misconceptions it's designed to catch (question_bank.distractor_
-- misconceptions, e.g. {"A": null, "B": 42, "C": null, "D": null}). Nobody
-- was reading that link yet - this engine is what actually reads it and
-- turns "wrong answer" into "which specific misunderstanding, how many
-- times, on how many different questions."
--
-- WHY "REPEATED", NOT JUST "WRONG"
--   A single wrong answer is noise (a slip, a guess, a misread question). A
--   student picking the *same* distractor-linked misconception across
--   *multiple, different* items is a pattern - that's what actually
--   indicates a conceptual misunderstanding worth re-teaching, as opposed
--   to an isolated mistake the Mastery/BKT Engine already accounts for on
--   its own. Every function below has a p_min_occurrences floor (default 2)
--   for exactly this reason: nothing surfaces here from a single miss.
--
-- DATA SOURCES (read-only; nothing here modifies another engine's tables)
--   * item_responses (module 5, CAT) already stores selected_option per
--     response, so CAT history has misconception coverage immediately,
--     with zero integration work, the moment this migration runs.
--   * item_response_log (new, below) extends the same coverage to every
--     other practice surface (Daily Review, Learning Path, Next Best
--     Action) going forward, via record_item_response() - see the
--     accompanying note for the small, additive edge-function change that
--     turns it on for each.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ITEM RESPONSE LOG
--    Engine-agnostic response detail (which option, which misconception) for
--    every practice surface that isn't a CAT session. Deliberately separate
--    from mastery_evidence_log (which stays correct/incorrect-only and
--    unmodified) and from item_responses (which stays CAT-session-specific
--    with its own IRT/theta columns) - this just fills the one gap: nowhere
--    outside CAT was capturing *which* wrong option a student picked.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_response_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  learning_objective_id bigint NOT NULL REFERENCES public.learning_objectives(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('spaced_review','learning_path')),
  selected_option text NOT NULL CHECK (selected_option IN ('A','B','C','D')),
  is_correct boolean NOT NULL,
  misconception_id bigint REFERENCES public.concept_misconceptions(id) ON DELETE SET NULL,
  responded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_response_log_student ON public.item_response_log(student_id, responded_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_response_log_misconception ON public.item_response_log(misconception_id) WHERE misconception_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. record_item_response(student, item, selected_option, source)
--    Resolves correctness + misconception in one lookup and logs it. Does
--    NOT call record_mastery_evidence itself - callers keep doing that
--    exactly as before; this is one additional, independent call, so
--    adopting it can never change BKT behaviour. GRANTed to authenticated
--    like record_mastery_evidence: it only ever writes the caller-supplied
--    student_id, so - same trust model as that function - the safety comes
--    from edge functions always passing their own resolved student id, not
--    from a check inside this function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_item_response(
  p_student_id uuid,
  p_item_id uuid,
  p_selected_option text,
  p_source text
)
RETURNS TABLE (is_correct boolean, misconception_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_correct_option text;
  v_lo_id bigint;
  v_distractor jsonb;
  v_selected text := upper(p_selected_option);
  v_is_correct boolean;
  v_misconception_id bigint;
BEGIN
  SELECT correct_option, learning_objective_id, distractor_misconceptions
  INTO v_correct_option, v_lo_id, v_distractor
  FROM public.question_bank
  WHERE id = p_item_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found';
  END IF;

  v_is_correct := (v_selected = v_correct_option);
  v_misconception_id := CASE WHEN NOT v_is_correct THEN (v_distractor ->> v_selected)::bigint ELSE NULL END;

  INSERT INTO public.item_response_log
    (student_id, item_id, learning_objective_id, source, selected_option, is_correct, misconception_id)
  VALUES (p_student_id, p_item_id, v_lo_id, p_source, v_selected, v_is_correct, v_misconception_id);

  RETURN QUERY SELECT v_is_correct, v_misconception_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_student_misconception_events(student)
--    Internal building block: every wrong response that maps to a known
--    misconception, from BOTH sources, unified. Not meant to be called
--    directly by the frontend - get_student_misconceptions() below
--    aggregates it into the actual patterns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_misconception_events(p_student_id uuid)
RETURNS TABLE (item_id uuid, learning_objective_id bigint, misconception_id bigint, responded_at timestamptz, source text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ir.item_id, ir.learning_objective_id,
    (qb.distractor_misconceptions ->> ir.selected_option)::bigint AS misconception_id,
    ir.responded_at, 'cat'::text AS source
  FROM public.item_responses ir
  JOIN public.question_bank qb ON qb.id = ir.item_id
  WHERE ir.student_id = p_student_id AND ir.is_correct = false
    AND (qb.distractor_misconceptions ->> ir.selected_option) IS NOT NULL

  UNION ALL

  SELECT irl.item_id, irl.learning_objective_id, irl.misconception_id, irl.responded_at, irl.source
  FROM public.item_response_log irl
  WHERE irl.student_id = p_student_id AND irl.is_correct = false AND irl.misconception_id IS NOT NULL;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_student_misconceptions(student, min_occurrences?, book?)
--    The actual detector: misconceptions repeated at least min_occurrences
--    times, across how many distinct items (a stronger signal than the same
--    question missed twice), ranked by severity then frequency then
--    recency. SECURITY DEFINER (joins question_bank/curriculum tables the
--    same way get_prerequisite_readiness/get_forgetting_forecast do);
--    GRANTed to authenticated the same way those are.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_misconceptions(
  p_student_id uuid,
  p_min_occurrences int DEFAULT 2,
  p_book_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH events AS (
    SELECT * FROM public.get_student_misconception_events(p_student_id)
  ),
  scoped AS (
    SELECT e.*
    FROM events e
    JOIN public.learning_objectives lo ON lo.id = e.learning_objective_id
    JOIN public.subtopics st ON st.id = lo.subtopic_id
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    WHERE p_book_id IS NULL OR u.book_id = p_book_id
  ),
  grouped AS (
    SELECT
      misconception_id,
      COUNT(*) AS occurrence_count,
      COUNT(DISTINCT item_id) AS distinct_items,
      MIN(responded_at) AS first_seen_at,
      MAX(responded_at) AS last_seen_at
    FROM scoped
    GROUP BY misconception_id
    HAVING COUNT(*) >= GREATEST(p_min_occurrences, 1)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'misconception_id', g.misconception_id,
      'misconception_text', cm.misconception_text,
      'why_it_happens', cm.why_it_happens,
      'correction_hint', cm.correction_hint,
      'severity', cm.severity,
      'occurrence_count', g.occurrence_count,
      'distinct_items', g.distinct_items,
      'first_seen_at', g.first_seen_at,
      'last_seen_at', g.last_seen_at,
      'subtopic_id', st.id, 'subtopic_name', st.subtopic_name,
      'topic_id', t.id, 'topic_name', t.topic_name,
      'chapter_name', c.chapter_name, 'subject', b.subject, 'class_name', b.class_name
    ) ORDER BY
      CASE cm.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      g.occurrence_count DESC,
      g.last_seen_at DESC
    ), '[]'::jsonb)
  FROM grouped g
  JOIN public.concept_misconceptions cm ON cm.id = g.misconception_id
  JOIN public.subtopics st ON st.id = cm.subtopic_id
  JOIN public.topics t ON t.id = st.topic_id
  JOIN public.curriculum_chapters c ON c.id = t.chapter_id
  JOIN public.units u ON u.id = c.unit_id
  JOIN public.books b ON b.id = u.book_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_class_misconception_hotspots(students[], book, min_occurrences?)
--    Teacher rollup: which misconceptions are shared across the most
--    students in a class - the actionable "12 students all confuse X with
--    Y, worth a whole-class re-teach" view. Same per-student-then-aggregate
--    shape as get_class_mastery / get_class_forgetting_risk.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_class_misconception_hotspots(
  p_student_ids uuid[],
  p_book_id bigint,
  p_min_occurrences int DEFAULT 2
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_student AS (
    SELECT sid AS student_id,
      public.get_student_misconceptions(sid, p_min_occurrences, p_book_id) AS items
    FROM unnest(p_student_ids) AS sid
  ),
  rows AS (
    SELECT
      per_student.student_id,
      (i->>'misconception_id')::bigint AS misconception_id,
      i->>'misconception_text' AS misconception_text,
      i->>'correction_hint' AS correction_hint,
      i->>'severity' AS severity,
      i->>'topic_name' AS topic_name,
      i->>'chapter_name' AS chapter_name,
      (i->>'occurrence_count')::int AS occurrence_count
    FROM per_student, jsonb_array_elements(items) AS i
  ),
  hotspots AS (
    SELECT
      misconception_id, misconception_text, correction_hint, severity, topic_name, chapter_name,
      COUNT(DISTINCT student_id) AS students_affected,
      SUM(occurrence_count) AS total_occurrences
    FROM rows
    GROUP BY misconception_id, misconception_text, correction_hint, severity, topic_name, chapter_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'misconception_id', misconception_id,
      'misconception_text', misconception_text,
      'correction_hint', correction_hint,
      'severity', severity,
      'topic_name', topic_name,
      'chapter_name', chapter_name,
      'students_affected', students_affected,
      'total_occurrences', total_occurrences
    ) ORDER BY students_affected DESC, total_occurrences DESC), '[]'::jsonb)
  FROM hotspots;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS for item_response_log (writes only via record_item_response above)
-- ---------------------------------------------------------------------------
ALTER TABLE public.item_response_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to item response log" ON public.item_response_log;
CREATE POLICY "Admins full access to item response log" ON public.item_response_log FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Staff read item response log" ON public.item_response_log;
CREATE POLICY "Staff read item response log" ON public.item_response_log FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own item response log" ON public.item_response_log;
CREATE POLICY "Students read own item response log" ON public.item_response_log FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. GRANTS
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.record_item_response(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_misconceptions(uuid, int, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_misconception_hotspots(uuid[], bigint, int) TO authenticated;

-- get_student_misconception_events is an internal building block only
-- (no curriculum/book filtering, no catalog join) - not meant to be called
-- directly from the client.
REVOKE ALL ON FUNCTION public.get_student_misconception_events(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_misconception_events(uuid) TO service_role;
