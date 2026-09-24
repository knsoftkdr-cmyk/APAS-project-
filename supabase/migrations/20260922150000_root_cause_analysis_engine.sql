-- ============================================================================
-- ROOT-CAUSE LEARNING ANALYSIS ENGINE (module 11)
--
-- Given one student and one learning objective they're struggling with,
-- this doesn't just say "mastery is low" - it differentiates WHY, across
-- four causes this migration can see directly:
--
--   prerequisite_gap    <- Knowledge Graph (2):  get_prerequisite_readiness
--   misconception       <- Misconception Engine (10): get_student_misconception_events
--   difficulty_mismatch <- IRT (5): attempted items' irt_b vs the student's theta
--   practice_deficiency <- Mastery Engine (1): opportunities_count
--
-- A fifth cause, attendance, is intentionally NOT computed in this SQL
-- function. This codebase already has a live `calculate_attendance_risk`
-- RPC (used by src/components/attendance/AttendanceRiskView.tsx) that this
-- migration does not define and cannot introspect - it isn't part of any
-- tracked migration in this repo, so its exact return columns can't be
-- verified from here. Rather than guess at its shape inside plpgsql (a
-- wrong assumption there would silently break every other cause in the same
-- function call), the root-cause-analysis EDGE FUNCTION calls it the same
-- way AttendanceRiskView.tsx already does - via the JS client, which
-- doesn't care about the underlying Postgres return type - and merges it in
-- as a fifth cause, degrading gracefully to "unavailable" if that call
-- fails for any reason. See that function's comments for the merge logic.
--
-- Each cause gets an evidence_strength ('strong'/'moderate'/'none') from a
-- fixed, documented threshold - not a trained model. This is a differential
-- checklist, not a diagnosis: several causes can be true at once (a
-- prerequisite gap AND a misconception commonly co-occur), so the output is
-- a ranked breakdown, not a single label.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_root_cause_analysis_core(
  p_student_id uuid,
  p_learning_objective_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtopic_id bigint;
  v_topic_id bigint;
  v_book_id bigint;
  v_objective_text text;
  v_subtopic_name text;
  v_topic_name text;
  v_chapter_name text;
  v_subject text;
  v_opportunities int;
  v_p_mastery numeric;
  v_readiness jsonb;
  v_theta numeric;
  v_avg_item_b numeric;
  v_n_attempts int;
  v_misconceptions jsonb;
  v_causes jsonb := '[]'::jsonb;
  v_strength text;
  v_readiness_score numeric;
BEGIN
  SELECT lo.subtopic_id, t.id, u.book_id, lo.objective_text, st.subtopic_name, t.topic_name, c.chapter_name, b.subject
  INTO v_subtopic_id, v_topic_id, v_book_id, v_objective_text, v_subtopic_name, v_topic_name, v_chapter_name, v_subject
  FROM public.learning_objectives lo
  JOIN public.subtopics st ON st.id = lo.subtopic_id
  JOIN public.topics t ON t.id = st.topic_id
  JOIN public.curriculum_chapters c ON c.id = t.chapter_id
  JOIN public.units u ON u.id = c.unit_id
  JOIN public.books b ON b.id = u.book_id
  WHERE lo.id = p_learning_objective_id;

  IF v_subtopic_id IS NULL THEN
    RETURN jsonb_build_object('error', 'learning_objective_not_found');
  END IF;

  -- ── Signal 1: practice deficiency (Mastery Engine) ───────────────────────
  SELECT opportunities_count, p_mastery INTO v_opportunities, v_p_mastery
  FROM public.student_mastery_labeled
  WHERE student_id = p_student_id AND learning_objective_id = p_learning_objective_id;
  v_opportunities := COALESCE(v_opportunities, 0);

  v_strength := CASE
    WHEN v_opportunities <= 1 THEN 'strong'
    WHEN v_opportunities <= 3 THEN 'moderate'
    ELSE 'none'
  END;
  v_causes := v_causes || jsonb_build_array(jsonb_build_object(
    'cause_type', 'practice_deficiency',
    'evidence_strength', v_strength,
    'explanation', CASE
      WHEN v_strength = 'strong' THEN format('Only %s attempt(s) so far — not enough reps for this to have stuck yet, regardless of understanding', v_opportunities)
      WHEN v_strength = 'moderate' THEN format('%s attempts so far — still early; more practice would sharpen this either way', v_opportunities)
      ELSE format('%s attempts recorded — enough reps that low performance likely reflects something more specific than "not enough practice"', v_opportunities)
    END,
    'evidence', jsonb_build_object('opportunities_count', v_opportunities, 'p_mastery', round(COALESCE(v_p_mastery, 0.3)::numeric, 3))
  ));

  -- ── Signal 2: prerequisite gap (Knowledge Graph Engine) ──────────────────
  v_readiness := public.get_prerequisite_readiness(p_student_id, v_subtopic_id);
  v_readiness_score := COALESCE((v_readiness->>'readiness_score')::numeric, 1.0);

  v_strength := CASE
    WHEN (v_readiness->>'prerequisite_count')::int = 0 THEN 'none'
    WHEN v_readiness_score < 0.35 THEN 'strong'
    WHEN v_readiness_score < 0.5 THEN 'moderate'
    ELSE 'none'
  END;
  v_causes := v_causes || jsonb_build_array(jsonb_build_object(
    'cause_type', 'prerequisite_gap',
    'evidence_strength', v_strength,
    'explanation', CASE
      WHEN (v_readiness->>'prerequisite_count')::int = 0 THEN 'No prerequisite concepts are modelled for this one'
      WHEN v_strength = 'none' THEN 'Prerequisite concepts are solid — this isn''t a foundation problem'
      ELSE format('Prerequisite readiness is only %s%% — the concepts this builds on aren''t solid yet', round(v_readiness_score * 100))
    END,
    'evidence', v_readiness
  ));

  -- ── Signal 3: difficulty mismatch (IRT Engine) ───────────────────────────
  SELECT COALESCE(theta, 0) INTO v_theta
  FROM public.student_ability
  WHERE student_id = p_student_id
    AND ((scope_type = 'concept' AND scope_id = v_subtopic_id) OR (scope_type = 'subject' AND scope_id = v_book_id))
  ORDER BY (scope_type = 'concept') DESC
  LIMIT 1;
  v_theta := COALESCE(v_theta, 0);

  SELECT AVG(irt_b), COUNT(*) INTO v_avg_item_b, v_n_attempts
  FROM (
    SELECT qb.irt_b FROM public.item_responses ir JOIN public.question_bank qb ON qb.id = ir.item_id
      WHERE ir.student_id = p_student_id AND ir.learning_objective_id = p_learning_objective_id
    UNION ALL
    SELECT qb.irt_b FROM public.item_response_log irl JOIN public.question_bank qb ON qb.id = irl.item_id
      WHERE irl.student_id = p_student_id AND irl.learning_objective_id = p_learning_objective_id
  ) attempted;

  v_strength := CASE
    WHEN COALESCE(v_n_attempts, 0) = 0 THEN 'none'
    WHEN v_avg_item_b - v_theta > 1.5 THEN 'strong'
    WHEN v_avg_item_b - v_theta > 0.75 THEN 'moderate'
    ELSE 'none'
  END;
  v_causes := v_causes || jsonb_build_array(jsonb_build_object(
    'cause_type', 'difficulty_mismatch',
    'evidence_strength', v_strength,
    'explanation', CASE
      WHEN COALESCE(v_n_attempts, 0) = 0 THEN 'No items attempted yet for this objective — nothing to compare difficulty against'
      WHEN v_strength = 'none' THEN 'Items attempted were reasonably matched to ability — difficulty alone doesn''t explain this'
      ELSE format('Items attempted (avg. difficulty %s logits) were notably harder than current ability (%s logits) — some misses may reflect item difficulty, not the concept itself',
                   round(v_avg_item_b::numeric, 2), round(v_theta::numeric, 2))
    END,
    'evidence', jsonb_build_object('theta', round(v_theta::numeric, 2), 'avg_item_difficulty', round(COALESCE(v_avg_item_b, 0)::numeric, 2), 'attempts', COALESCE(v_n_attempts, 0))
  ));

  -- ── Signal 4: misconception (Misconception Detection Engine) ─────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'misconception_id', ev.misconception_id, 'text', cm.misconception_text,
      'correction_hint', cm.correction_hint, 'severity', cm.severity, 'occurrence_count', ev.occurrence_count
    ) ORDER BY ev.occurrence_count DESC), '[]'::jsonb)
  INTO v_misconceptions
  FROM (
    SELECT misconception_id, COUNT(*) AS occurrence_count
    FROM public.get_student_misconception_events(p_student_id)
    WHERE learning_objective_id = p_learning_objective_id
    GROUP BY misconception_id
  ) ev
  JOIN public.concept_misconceptions cm ON cm.id = ev.misconception_id;

  v_strength := CASE
    WHEN jsonb_array_length(v_misconceptions) = 0 THEN 'none'
    WHEN (SELECT MAX((m->>'occurrence_count')::int) FROM jsonb_array_elements(v_misconceptions) m) >= 2 THEN 'strong'
    ELSE 'moderate'
  END;
  v_causes := v_causes || jsonb_build_array(jsonb_build_object(
    'cause_type', 'misconception',
    'evidence_strength', v_strength,
    'explanation', CASE
      WHEN v_strength = 'none' THEN 'No specific misunderstanding detected from wrong-answer patterns on this objective'
      ELSE format('%s: %s', (v_misconceptions->0->>'text'), COALESCE(v_misconceptions->0->>'correction_hint', ''))
    END,
    'evidence', v_misconceptions
  ));

  RETURN jsonb_build_object(
    'learning_objective_id', p_learning_objective_id,
    'objective_text', v_objective_text,
    'subtopic_id', v_subtopic_id, 'subtopic_name', v_subtopic_name,
    'topic_id', v_topic_id, 'topic_name', v_topic_name,
    'chapter_name', v_chapter_name, 'subject', v_subject, 'book_id', v_book_id,
    'causes', v_causes,
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_root_cause_analysis_core(uuid, bigint) TO authenticated;
