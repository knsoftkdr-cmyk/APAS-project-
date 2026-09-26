-- ============================================================================
-- ADAPTIVE HOMEWORK GENERATOR (module 16)
--
-- Not a new source of truth, like the Learning Path Generator (module 8):
-- it reads the same engines and turns their signals into differentiated
-- homework, one set per student in a class, instead of one shared set.
--
--   Mastery/BKT (1,3)       -> avg mastery across the assigned scope decides
--                              each student's mastery_band
--   Knowledge Graph (2)     -> skip concepts whose prerequisites aren't
--                              ready yet (get_prerequisite_readiness)
--   Spaced Repetition (6)   -> a couple of due reviews are folded into every
--                              student's set (get_due_reviews)
--   IRT (5)                 -> item difficulty/bloom level within a concept
--                              is biased by band (easier for beginning/
--                              developing, harder for mastered)
--
-- Band -> homework shape:
--   beginning / developing  -> remediate weakest attempted concepts first,
--                              topped up with easy, ready, untouched ones
--   proficient              -> balanced mix of practice + next-new concept
--   mastered                -> enrichment: untouched/advanced concepts,
--                              biased toward higher-order bloom levels
--
-- Two new tables only:
--   adaptive_homework_assignments  - one row per teacher-triggered batch
--   adaptive_homework_items        - one row per student's generated set,
--                                    plus their answers/score once submitted
--
-- No engine below this one is modified, other than widening the evidence
-- source vocabulary (same pattern module 8 used).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Widen the evidence source vocabulary for adaptive-homework attempts.
-- ---------------------------------------------------------------------------
ALTER TABLE public.mastery_evidence_log DROP CONSTRAINT IF EXISTS mastery_evidence_log_source_check;
ALTER TABLE public.mastery_evidence_log ADD CONSTRAINT mastery_evidence_log_source_check
  CHECK (source IN ('mcq','homework','worksheet','ai_tutor','diagnostic','manual','spaced_review','learning_path','adaptive_homework'));

-- ---------------------------------------------------------------------------
-- 1. ASSIGNMENTS (one row per teacher-triggered generation batch)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adaptive_homework_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  chapter_id bigint REFERENCES public.curriculum_chapters(id) ON DELETE SET NULL,
  title text NOT NULL,
  items_per_student int NOT NULL DEFAULT 6 CHECK (items_per_student BETWEEN 1 AND 20),
  due_at timestamptz,
  assigned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  student_count int NOT NULL DEFAULT 0,
  -- {"beginning": 3, "developing": 5, "proficient": 10, "mastered": 2}
  band_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adaptive_hw_assign_class ON public.adaptive_homework_assignments(class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_adaptive_hw_assign_teacher ON public.adaptive_homework_assignments(assigned_by, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. PER-STUDENT SETS
--    `items` carries the same step shape as the Learning Path Generator's
--    queue (step_type/learning_objective_id/item{item_id,stem,options,
--    bloom_level}) so it never leaks the answer key to the browser and can
--    be graded with the exact same logic.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adaptive_homework_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.adaptive_homework_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  mastery_band text NOT NULL CHECK (mastery_band IN ('beginning','developing','proficient','mastered')),
  avg_mastery numeric,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{item_id, learning_objective_id, selected_option, is_correct}, ...]
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','submitted')),
  score numeric,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_adaptive_hw_items_assignment ON public.adaptive_homework_items(assignment_id);
CREATE INDEX IF NOT EXISTS idx_adaptive_hw_items_student ON public.adaptive_homework_items(student_id, status);

-- ---------------------------------------------------------------------------
-- 3. CORE ENGINE: generate_adaptive_homework_for_student()
--    One student's differentiated set. SECURITY DEFINER because it joins
--    question_bank (answer key) exactly like generate_learning_path;
--    locked to service_role below - the edge function loops this over a
--    class roster after checking the caller is the teacher of that class.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_adaptive_homework_for_student(
  p_student_id uuid,
  p_book_id bigint,
  p_chapter_id bigint DEFAULT NULL,
  p_length int DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review jsonb;
  v_review_count int;
  v_remaining int;
  v_avg_mastery numeric;
  v_band text;
  v_generated jsonb;
BEGIN
  -- A due review or two, folded into every band's set (protects retention
  -- regardless of how the rest of the homework is shaped).
  v_review_count := LEAST(3, GREATEST(0, p_length / 3));
  SELECT COALESCE(jsonb_agg(r || jsonb_build_object(
      'step_type', 'review',
      'reason', CASE
        WHEN (r->>'days_overdue')::numeric > 0.5
          THEN format('Overdue by %s day(s) — review before it fades further', round((r->>'days_overdue')::numeric))
        ELSE 'Due for review today'
      END
    )), '[]'::jsonb)
  INTO v_review
  FROM jsonb_array_elements(public.get_due_reviews(p_student_id, v_review_count, p_book_id)) AS r;

  v_remaining := GREATEST(0, p_length - jsonb_array_length(v_review));

  WITH used_los AS (
    SELECT (r->>'learning_objective_id')::bigint AS lo_id FROM jsonb_array_elements(v_review) r
  ),
  scope_lo AS (
    SELECT lo.id AS learning_objective_id, lo.objective_text,
      st.id AS subtopic_id, st.subtopic_name,
      t.id AS topic_id, t.topic_name, t.display_order,
      c.id AS chapter_id, c.chapter_name, b.subject, b.class_name,
      COALESCE(sml.p_mastery, bp.p_init, 0.30) AS p_mastery,
      COALESCE(sml.opportunities_count, 0) AS opportunities_count
    FROM public.learning_objectives lo
    JOIN public.subtopics st ON st.id = lo.subtopic_id
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    JOIN public.books b ON b.id = u.book_id
    LEFT JOIN public.mastery_bkt_params bp ON bp.learning_objective_id = lo.id
    LEFT JOIN public.student_mastery_labeled sml
      ON sml.learning_objective_id = lo.id AND sml.student_id = p_student_id
    WHERE lo.status = 'active' AND u.book_id = p_book_id
      AND (p_chapter_id IS NULL OR c.id = p_chapter_id)
      AND lo.id NOT IN (SELECT lo_id FROM used_los)
  ),
  readiness AS (
    SELECT DISTINCT sl.subtopic_id,
      COALESCE((public.get_prerequisite_readiness(p_student_id, sl.subtopic_id)->>'is_ready')::boolean, true) AS is_ready
    FROM scope_lo sl
  ),
  scoped AS (
    SELECT sl.* FROM scope_lo sl
    JOIN readiness r ON r.subtopic_id = sl.subtopic_id
    WHERE r.is_ready
  )
  SELECT round(AVG(p_mastery)::numeric, 3) INTO v_avg_mastery FROM scoped WHERE opportunities_count > 0;

  v_avg_mastery := COALESCE(v_avg_mastery, 0.30);
  v_band := CASE
    WHEN v_avg_mastery >= 0.85 THEN 'mastered'
    WHEN v_avg_mastery >= 0.60 THEN 'proficient'
    WHEN v_avg_mastery >= 0.35 THEN 'developing'
    ELSE 'beginning'
  END;

  WITH used_los AS (
    SELECT (r->>'learning_objective_id')::bigint AS lo_id FROM jsonb_array_elements(v_review) r
  ),
  scope_lo AS (
    SELECT lo.id AS learning_objective_id, lo.objective_text,
      st.id AS subtopic_id, st.subtopic_name,
      t.id AS topic_id, t.topic_name, t.display_order,
      c.id AS chapter_id, c.chapter_name, b.subject, b.class_name,
      COALESCE(sml.p_mastery, bp.p_init, 0.30) AS p_mastery,
      COALESCE(sml.opportunities_count, 0) AS opportunities_count
    FROM public.learning_objectives lo
    JOIN public.subtopics st ON st.id = lo.subtopic_id
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    JOIN public.books b ON b.id = u.book_id
    LEFT JOIN public.mastery_bkt_params bp ON bp.learning_objective_id = lo.id
    LEFT JOIN public.student_mastery_labeled sml
      ON sml.learning_objective_id = lo.id AND sml.student_id = p_student_id
    WHERE lo.status = 'active' AND u.book_id = p_book_id
      AND (p_chapter_id IS NULL OR c.id = p_chapter_id)
      AND lo.id NOT IN (SELECT lo_id FROM used_los)
  ),
  readiness AS (
    SELECT DISTINCT sl.subtopic_id,
      COALESCE((public.get_prerequisite_readiness(p_student_id, sl.subtopic_id)->>'is_ready')::boolean, true) AS is_ready
    FROM scope_lo sl
  ),
  scoped AS (
    SELECT sl.* FROM scope_lo sl
    JOIN readiness r ON r.subtopic_id = sl.subtopic_id
    WHERE r.is_ready
  ),
  -- Band-differentiated ranking: bucket 0 goes first, ties broken by tiebreak.
  ranked AS (
    SELECT s.*,
      CASE
        WHEN v_band IN ('beginning','developing') THEN (CASE WHEN s.opportunities_count > 0 THEN 0 ELSE 1 END)
        WHEN v_band = 'proficient' THEN (CASE WHEN s.opportunities_count > 0 AND s.p_mastery < 0.85 THEN 0 ELSE 1 END)
        ELSE (CASE WHEN s.opportunities_count = 0 THEN 0 ELSE 1 END) -- mastered: enrichment first
      END AS bucket,
      CASE
        WHEN v_band = 'mastered' THEN -(s.chapter_id * 100000 + COALESCE(s.display_order, 1) * 1000)::numeric
        ELSE s.p_mastery
      END AS tiebreak,
      CASE
        WHEN v_band IN ('beginning','developing') AND s.opportunities_count > 0
          THEN format('Needs reinforcement — %s%% mastery so far', round(s.p_mastery * 100))
        WHEN v_band IN ('beginning','developing')
          THEN 'A gentler starting point, ready to attempt now'
        WHEN v_band = 'mastered' AND s.opportunities_count = 0
          THEN 'Enrichment — a stretch concept building on what is already mastered'
        WHEN v_band = 'mastered'
          THEN 'A tougher pass at a concept already close to mastered'
        WHEN s.opportunities_count = 0
          THEN 'Next new concept, prerequisites are in place'
        ELSE format('A bit more practice to lock this in (%s%% mastery so far)', round(s.p_mastery * 100))
      END AS reason
    FROM scoped s
  ),
  picked AS (
    SELECT r.*, ROW_NUMBER() OVER (ORDER BY bucket, tiebreak) AS rn
    FROM ranked r
  ),
  with_item AS (
    SELECT p.*, (
      SELECT jsonb_build_object('item_id', q.id, 'stem', q.stem, 'options', q.options, 'bloom_level', q.bloom_level)
      FROM public.question_bank q
      WHERE q.learning_objective_id = p.learning_objective_id AND q.status = 'active'
      ORDER BY
        CASE
          WHEN v_band IN ('beginning','developing') THEN
            (CASE q.bloom_level WHEN 'remember' THEN 0 WHEN 'understand' THEN 1 ELSE 2 END) + q.irt_b
          WHEN v_band = 'mastered' THEN
            -((CASE q.bloom_level WHEN 'evaluate' THEN 4 WHEN 'analyze' THEN 3 WHEN 'apply' THEN 2 ELSE 0 END) - q.irt_b)
          ELSE q.irt_b
        END,
        random()
      LIMIT 1
    ) AS item
    FROM picked p
    WHERE p.rn <= v_remaining * 2 -- headroom before the item-availability filter below
  )
  SELECT jsonb_agg(step) INTO v_generated
  FROM (
    SELECT jsonb_build_object(
        'step_type', CASE
          WHEN v_band IN ('beginning','developing') AND wi.opportunities_count > 0 THEN 'remediate'
          WHEN wi.opportunities_count = 0 THEN 'learn'
          ELSE 'practice'
        END,
        'learning_objective_id', wi.learning_objective_id,
        'objective_text', wi.objective_text,
        'subtopic_id', wi.subtopic_id, 'subtopic_name', wi.subtopic_name,
        'topic_id', wi.topic_id, 'topic_name', wi.topic_name,
        'chapter_name', wi.chapter_name, 'subject', wi.subject, 'class_name', wi.class_name,
        'p_mastery', wi.p_mastery,
        'reason', wi.reason,
        'item', wi.item
      ) AS step
    FROM with_item wi
    WHERE wi.item IS NOT NULL
    ORDER BY wi.rn
    LIMIT v_remaining
  ) capped;

  RETURN jsonb_build_object(
    'mastery_band', v_band,
    'avg_mastery', v_avg_mastery,
    'items', v_review || COALESCE(v_generated, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_adaptive_homework_for_student(uuid, bigint, bigint, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_adaptive_homework_for_student(uuid, bigint, bigint, int) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. GRADING HELPER: grade one item and finalize a set once all are answered.
--    Mirrors module 8's `answer` logic (record_item_response for module 10,
--    then record_mastery_evidence for BKT) but also updates this student's
--    row: appended answer, status, and score once complete.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_adaptive_homework_answer(
  p_item_row_id uuid,
  p_student_id uuid,
  p_item_id uuid,
  p_learning_objective_id bigint,
  p_selected_option text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_correct_option text;
  v_explanation text;
  v_is_correct boolean;
  v_before numeric; v_after numeric;
  v_answers jsonb;
  v_total int; v_correct_total int;
BEGIN
  SELECT correct_option, explanation INTO v_correct_option, v_explanation
  FROM public.question_bank WHERE id = p_item_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  v_is_correct := upper(p_selected_option) = v_correct_option;

  PERFORM public.record_item_response(p_student_id, p_item_id, p_selected_option, 'adaptive_homework');

  SELECT p_mastery_before, p_mastery_after INTO v_before, v_after
  FROM public.record_mastery_evidence(p_student_id, p_learning_objective_id, v_is_correct, 'adaptive_homework', p_item_row_id);

  UPDATE public.adaptive_homework_items
  SET
    answers = answers || jsonb_build_array(jsonb_build_object(
      'item_id', p_item_id, 'learning_objective_id', p_learning_objective_id,
      'selected_option', upper(p_selected_option), 'is_correct', v_is_correct
    )),
    status = 'in_progress',
    updated_at = now()
  WHERE id = p_item_row_id AND student_id = p_student_id
  RETURNING answers, jsonb_array_length(items) INTO v_answers, v_total;

  SELECT COUNT(*) INTO v_correct_total FROM jsonb_array_elements(v_answers) a WHERE (a->>'is_correct')::boolean;

  IF v_total IS NOT NULL AND jsonb_array_length(v_answers) >= v_total THEN
    UPDATE public.adaptive_homework_items
    SET status = 'submitted', submitted_at = now(),
        score = round(100.0 * v_correct_total / GREATEST(v_total, 1), 1)
    WHERE id = p_item_row_id AND student_id = p_student_id;
  END IF;

  RETURN jsonb_build_object(
    'is_correct', v_is_correct, 'correct_option', v_correct_option, 'explanation', v_explanation,
    'p_mastery_before', v_before, 'p_mastery_after', v_after
  );
END;
$$;

-- Unlike generate_adaptive_homework_for_student, this one is safe to grant
-- to authenticated directly (same trust model as record_mastery_evidence
-- and update-mastery/spaced-repetition/learning-path's "answer" action):
-- the edge function only ever calls it with the caller's *own* JWT and
-- ownStudentId, never a value taken from the request body.
REVOKE ALL ON FUNCTION public.submit_adaptive_homework_answer(uuid, uuid, uuid, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_adaptive_homework_answer(uuid, uuid, uuid, bigint, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS
--    Same shape as learning_path_log / question_bank: staff manage what
--    they created, students read only their own generated set. All writes
--    (assignment creation, batch generation, grading) go through the
--    service-role edge function, which enforces class-teacher ownership
--    before calling the functions above - not through these policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.adaptive_homework_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adaptive_homework_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to adaptive homework assignments" ON public.adaptive_homework_assignments;
CREATE POLICY "Admins full access to adaptive homework assignments" ON public.adaptive_homework_assignments FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Staff read adaptive homework assignments" ON public.adaptive_homework_assignments;
CREATE POLICY "Staff read adaptive homework assignments" ON public.adaptive_homework_assignments FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own adaptive homework assignments" ON public.adaptive_homework_assignments;
CREATE POLICY "Students read own adaptive homework assignments" ON public.adaptive_homework_assignments FOR SELECT
  USING (id IN (
    SELECT assignment_id FROM public.adaptive_homework_items ahi
    JOIN public.students s ON s.id = ahi.student_id
    WHERE s.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins full access to adaptive homework items" ON public.adaptive_homework_items;
CREATE POLICY "Admins full access to adaptive homework items" ON public.adaptive_homework_items FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Staff read adaptive homework items" ON public.adaptive_homework_items;
CREATE POLICY "Staff read adaptive homework items" ON public.adaptive_homework_items FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own adaptive homework items" ON public.adaptive_homework_items;
CREATE POLICY "Students read own adaptive homework items" ON public.adaptive_homework_items FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));
