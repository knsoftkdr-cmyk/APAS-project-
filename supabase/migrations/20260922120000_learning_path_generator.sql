-- ============================================================================
-- PERSONALIZED LEARNING PATH GENERATOR (module 8)
--
-- This is the orchestrator, not a new source of truth: it reads every prior
-- engine and turns their signals into one ranked "what should this student
-- do next" queue. No new tables besides a tiny log of what was generated;
-- no engine below it is modified.
--
--   Knowledge Graph (2)     -> which concepts are ready to attempt
--                              (get_prerequisite_readiness) and how many
--                              other concepts each one unblocks
--                              (concept_prerequisites out-degree)
--   Mastery/BKT (1,3)       -> which concepts are weak, partial, or untouched
--                              (student_mastery_labeled)
--   Spaced Repetition (6)   -> what's due for review right now
--                              (get_due_reviews)
--   Forgetting Curve (7)    -> what's about to be forgotten even though it
--                              isn't "due" yet (get_forgetting_forecast)
--   IRT (5)                 -> which item to hand them for a new/weak
--                              concept, matched near their ability
--                              (student_ability.theta vs question_bank.irt_b)
--
-- The output is a queue of typed steps, priority order:
--   1. review     - protect what's about to decay (cheapest, most urgent)
--   2. remediate  - fix a weak concept that's blocking progress and is
--                   itself fixable now (its own prerequisites are ready)
--   3. learn      - the next untouched concept in curriculum order whose
--                   prerequisites are ready
--   4. practice   - reinforce a partially-mastered concept that isn't
--                   urgent yet, to round out a short queue
--
-- Each step carries a plain-language `reason` and either a `schedule_id`
-- (review steps - answer via the existing spaced-repetition engine so its
-- SM-2 trigger keeps handling those) or an `item` to answer directly here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Widen the evidence source vocabulary for path-originated attempts that
--    aren't reviews (those already use 'spaced_review').
-- ---------------------------------------------------------------------------
ALTER TABLE public.mastery_evidence_log DROP CONSTRAINT IF EXISTS mastery_evidence_log_source_check;
ALTER TABLE public.mastery_evidence_log ADD CONSTRAINT mastery_evidence_log_source_check
  CHECK (source IN ('mcq','homework','worksheet','ai_tutor','diagnostic','manual','spaced_review','learning_path'));

-- ---------------------------------------------------------------------------
-- 1. GENERATED-PATH LOG
--    A lightweight audit trail: what did we recommend and when. Not read by
--    any other engine - purely for "why did it suggest this" history and for
--    a student to see their path didn't just reshuffle randomly on refresh.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learning_path_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  path jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learning_path_log_student ON public.learning_path_log(student_id, generated_at DESC);

-- ---------------------------------------------------------------------------
-- 2. generate_learning_path(student, book, length?)
--    SECURITY DEFINER: joins question_bank (answer key) and curriculum
--    tables the same way the CAT/knowledge-graph engines do. Locked to
--    service_role below; the edge function resolves/enforces student_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_learning_path(
  p_student_id uuid,
  p_book_id bigint,
  p_length int DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_theta numeric;
  v_reviews jsonb;
  v_at_risk jsonb;
  v_result jsonb;
BEGIN
  -- Ability estimate to pick appropriately-hard items for new/weak concepts.
  -- Falls back to 0 (population-average ability) if this student has never
  -- taken a CAT session for this subject yet.
  SELECT COALESCE(theta, 0) INTO v_theta
  FROM public.student_ability
  WHERE student_id = p_student_id AND scope_type = 'subject' AND scope_id = p_book_id;
  v_theta := COALESCE(v_theta, 0);

  -- ── Step type 1: REVIEW ────────────────────────────────────────────────
  -- Reuse the Spaced Repetition Engine's own queue verbatim (it already
  -- picks an item per objective) rather than re-deriving it.
  SELECT COALESCE(jsonb_agg(r || jsonb_build_object(
      'step_type', 'review',
      'reason', CASE
        WHEN (r->>'days_overdue')::numeric > 0.5
          THEN format('Overdue by %s day(s) — review before it fades further', round((r->>'days_overdue')::numeric))
        ELSE 'Due for review today'
      END
    )), '[]'::jsonb)
  INTO v_reviews
  FROM jsonb_array_elements(public.get_due_reviews(p_student_id, p_length, p_book_id)) AS r;

  -- ── Step type 1b: EARLY-WARNING REVIEW ───────────────────────────────────
  -- Objects the Forgetting Curve Engine predicts will drop below 50%
  -- retention soon, even though SM-2 hasn't marked them "due" yet. Excludes
  -- anything already picked up above to avoid duplicates.
  WITH already AS (
    SELECT (r->>'learning_objective_id')::bigint AS lo_id FROM jsonb_array_elements(v_reviews) r
  ),
  risky AS (
    SELECT f
    FROM jsonb_array_elements(public.get_forgetting_forecast(p_student_id, 0.5, 5, p_book_id)) AS f
    WHERE (f->>'is_at_risk')::boolean = true
      AND (f->>'learning_objective_id')::bigint NOT IN (SELECT lo_id FROM already)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'step_type', 'review',
      'learning_objective_id', (f->>'learning_objective_id')::bigint,
      'objective_text', f->>'objective_text',
      'subtopic_id', (f->>'subtopic_id')::bigint, 'subtopic_name', f->>'subtopic_name',
      'topic_id', (f->>'topic_id')::bigint, 'topic_name', f->>'topic_name',
      'chapter_name', f->>'chapter_name', 'subject', f->>'subject', 'class_name', f->>'class_name',
      'p_mastery', f->'retention_now',
      'schedule_id', rs.id,
      'reason', format('Predicted to slip below 50%% recall in ~%s day(s), before its next scheduled review',
                        GREATEST(0, round((f->>'days_until_forgotten')::numeric))),
      'item', (
        SELECT jsonb_build_object('item_id', q.id, 'stem', q.stem, 'options', q.options, 'bloom_level', q.bloom_level)
        FROM public.question_bank q
        WHERE q.learning_objective_id = (f->>'learning_objective_id')::bigint AND q.status = 'active'
        ORDER BY random() LIMIT 1
      )
    )), '[]'::jsonb)
  INTO v_at_risk
  FROM risky, LATERAL (
    SELECT id FROM public.review_schedule
    WHERE student_id = p_student_id AND learning_objective_id = (risky.f->>'learning_objective_id')::bigint
  ) rs;

  v_reviews := v_reviews || v_at_risk;

  -- ── Steps 2-4: REMEDIATE / LEARN / PRACTICE ─────────────────────────────
  WITH used_los AS (
    SELECT (r->>'learning_objective_id')::bigint AS lo_id FROM jsonb_array_elements(v_reviews) r
  ),
  book_subtopics AS (
    SELECT DISTINCT st.id AS subtopic_id, st.subtopic_name, t.id AS topic_id, t.topic_name,
      t.display_order AS topic_order, c.id AS chapter_id, c.chapter_name, b.subject, b.class_name
    FROM public.subtopics st
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    JOIN public.books b ON b.id = u.book_id
    WHERE u.book_id = p_book_id
      AND EXISTS (SELECT 1 FROM public.learning_objectives lo WHERE lo.subtopic_id = st.id AND lo.status = 'active')
  ),
  blocking AS (
    SELECT prerequisite_subtopic_id AS subtopic_id, COUNT(*) AS blocking_count
    FROM public.concept_prerequisites GROUP BY prerequisite_subtopic_id
  ),
  readiness AS (
    SELECT bs.subtopic_id, public.get_prerequisite_readiness(p_student_id, bs.subtopic_id) AS r
    FROM book_subtopics bs
  ),
  subtopic_rollup AS (
    SELECT
      bs.*,
      COALESCE(bk.blocking_count, 0) AS blocking_count,
      COALESCE((rd.r->>'is_ready')::boolean, true) AS prereqs_ready,
      COUNT(*) FILTER (WHERE sml.opportunities_count > 0) AS attempted_count,
      COUNT(*) AS objective_count,
      AVG(sml.p_mastery) FILTER (WHERE sml.opportunities_count > 0) AS avg_mastery
    FROM book_subtopics bs
    LEFT JOIN blocking bk ON bk.subtopic_id = bs.subtopic_id
    LEFT JOIN readiness rd ON rd.subtopic_id = bs.subtopic_id
    JOIN public.learning_objectives lo ON lo.subtopic_id = bs.subtopic_id AND lo.status = 'active'
    LEFT JOIN public.student_mastery_labeled sml ON sml.learning_objective_id = lo.id AND sml.student_id = p_student_id
    GROUP BY bs.subtopic_id, bs.subtopic_name, bs.topic_id, bs.topic_name, bs.topic_order,
             bs.chapter_id, bs.chapter_name, bs.subject, bs.class_name, bk.blocking_count, rd.r
  ),

  -- Weakest concepts the student has already engaged with, blocking others,
  -- and fixable right now (their own prerequisites are in place).
  remediate_candidates AS (
    SELECT sr.*, 'remediate' AS step_type,
      format('Weak spot (%s%% mastery) that %s other concept(s) depend on — worth fixing before moving on',
             round(sr.avg_mastery * 100), sr.blocking_count) AS reason,
      1 AS type_rank,
      -(sr.blocking_count::numeric) + sr.avg_mastery AS tiebreak -- more-blocking, then weaker, first
    FROM subtopic_rollup sr
    WHERE sr.attempted_count > 0 AND sr.avg_mastery < 0.5 AND sr.prereqs_ready
  ),

  -- Untouched concepts, ready to start, in curriculum order.
  learn_candidates AS (
    SELECT sr.*, 'learn' AS step_type,
      CASE WHEN sr.blocking_count > 0
        THEN format('Next in sequence — prerequisites are in place, and it unlocks %s more concept(s)', sr.blocking_count)
        ELSE 'Next in sequence — prerequisites are in place'
      END AS reason,
      2 AS type_rank,
      (sr.chapter_id * 100000 + COALESCE(sr.topic_order, 1) * 1000 - sr.blocking_count)::numeric AS tiebreak
    FROM subtopic_rollup sr
    WHERE sr.attempted_count = 0 AND sr.prereqs_ready
  ),

  -- Partially-mastered concepts, not urgent, used to round out a short queue.
  practice_candidates AS (
    SELECT sr.*, 'practice' AS step_type,
      format('A bit more practice would help (%s%% mastery so far)', round(sr.avg_mastery * 100)) AS reason,
      3 AS type_rank,
      sr.avg_mastery AS tiebreak
    FROM subtopic_rollup sr
    WHERE sr.attempted_count > 0 AND sr.avg_mastery BETWEEN 0.5 AND 0.85 AND sr.prereqs_ready
      AND NOT EXISTS (
        SELECT 1 FROM public.review_schedule rs
        JOIN public.learning_objectives lo2 ON lo2.id = rs.learning_objective_id
        WHERE rs.student_id = p_student_id AND lo2.subtopic_id = sr.subtopic_id AND rs.suspended = false
      )
  ),

  candidates AS (
    SELECT * FROM remediate_candidates
    UNION ALL SELECT * FROM learn_candidates
    UNION ALL SELECT * FROM practice_candidates
  ),
  ranked AS (
    SELECT c.*, ROW_NUMBER() OVER (ORDER BY type_rank, tiebreak) AS rn
    FROM candidates c
  ),

  -- Pick one target learning objective per chosen subtopic: the weakest
  -- attempted one for remediate/practice, the earliest untouched one for
  -- learn - excluding anything already used by a review step above.
  targeted AS (
    SELECT r.*, tgt.learning_objective_id, tgt.objective_text
    FROM ranked r
    JOIN LATERAL (
      SELECT lo.id AS learning_objective_id, lo.objective_text
      FROM public.learning_objectives lo
      LEFT JOIN public.student_mastery_labeled sml ON sml.learning_objective_id = lo.id AND sml.student_id = p_student_id
      WHERE lo.subtopic_id = r.subtopic_id AND lo.status = 'active'
        AND lo.id NOT IN (SELECT lo_id FROM used_los)
        AND (
          (r.step_type = 'learn' AND COALESCE(sml.opportunities_count, 0) = 0)
          OR (r.step_type IN ('remediate','practice') AND sml.opportunities_count > 0)
        )
      ORDER BY CASE WHEN r.step_type = 'learn' THEN lo.display_order ELSE COALESCE(sml.p_mastery, 1) END
      LIMIT 1
    ) tgt ON true
    WHERE r.rn <= p_length * 2 -- headroom before the final LIMIT below
  )
  SELECT v_reviews || COALESCE(jsonb_agg(jsonb_build_object(
      'step_type', t.step_type,
      'learning_objective_id', t.learning_objective_id,
      'objective_text', t.objective_text,
      'subtopic_id', t.subtopic_id, 'subtopic_name', t.subtopic_name,
      'topic_id', t.topic_id, 'topic_name', t.topic_name,
      'chapter_name', t.chapter_name, 'subject', t.subject, 'class_name', t.class_name,
      'reason', t.reason,
      'item', (
        SELECT jsonb_build_object('item_id', q.id, 'stem', q.stem, 'options', q.options, 'bloom_level', q.bloom_level)
        FROM public.question_bank q
        WHERE q.learning_objective_id = t.learning_objective_id AND q.status = 'active'
        ORDER BY abs(q.irt_b - v_theta)
        LIMIT 1
      )
    ) ORDER BY t.rn), '[]'::jsonb)
  INTO v_result
  FROM targeted t
  WHERE t.learning_objective_id IS NOT NULL;

  -- Drop any step that ended up without an actual item to serve (empty
  -- item bank for that objective), then cap to the requested length.
  SELECT jsonb_agg(step) INTO v_result
  FROM (
    SELECT step FROM jsonb_array_elements(COALESCE(v_result, '[]'::jsonb)) AS step
    -- step->'item' is a JSON null (not SQL NULL) when no active item was found for that
    -- objective, so it must be checked explicitly rather than with a plain IS NOT NULL.
    WHERE (step ? 'schedule_id') OR (jsonb_typeof(step->'item') = 'object')
    LIMIT p_length
  ) filtered;

  INSERT INTO public.learning_path_log (student_id, book_id, path)
  VALUES (p_student_id, p_book_id, COALESCE(v_result, '[]'::jsonb));

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS for the log (students read their own; staff read all; writes only
--    via the SECURITY DEFINER function above).
-- ---------------------------------------------------------------------------
ALTER TABLE public.learning_path_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to learning path log" ON public.learning_path_log;
CREATE POLICY "Admins full access to learning path log" ON public.learning_path_log FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Staff read learning path log" ON public.learning_path_log;
CREATE POLICY "Staff read learning path log" ON public.learning_path_log FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own learning path log" ON public.learning_path_log;
CREATE POLICY "Students read own learning path log" ON public.learning_path_log FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. GRANTS
--    generate_learning_path touches question_bank directly, so - same
--    reasoning as get_due_reviews in the Spaced Repetition Engine - it is
--    service_role only; the edge function resolves/enforces student_id.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.generate_learning_path(uuid, bigint, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_learning_path(uuid, bigint, int) TO service_role;
