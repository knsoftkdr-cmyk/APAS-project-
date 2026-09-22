-- ============================================================================
-- IRT + COMPUTERIZED ADAPTIVE TESTING (CAT) ENGINE
--
--   learning_objectives (Mastery Engine 2.0)
--        └── question_bank      persistent, LO-tagged MCQ items carrying IRT
--                               parameters (a, b, c) and calibration state
--   cat_sessions               one adaptive test attempt (θ, SE, stop state)
--   item_responses             append-only response log (params snapshotted)
--   student_ability            latest θ per student per scope (warm start)
--   irt_calibration_runs       audit trail for every calibration batch
--
-- Additive only. It reads learning_objectives / subtopics / topics /
-- curriculum_chapters / units / books / student_mastery and feeds BKT by
-- calling the existing record_mastery_evidence() - it changes none of them.
--
-- SECURITY MODEL
--   * question_bank holds the answer key. Students get NO policy on it, so
--     the key can never be read from the browser; the cat-session edge
--     function (service role) serves items without it.
--   * All writes to sessions / responses / ability go through service-role
--     edge functions or the SECURITY DEFINER functions below. Students only
--     get SELECT on their own rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ITEM BANK
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_objective_id bigint NOT NULL REFERENCES public.learning_objectives(id) ON DELETE CASCADE,
  -- Denormalized from the learning objective (set by trigger) so scope
  -- filtering doesn't need a join on every CAT step.
  subtopic_id bigint NOT NULL REFERENCES public.subtopics(id) ON DELETE CASCADE,

  stem text NOT NULL CHECK (length(btrim(stem)) > 0),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'object'),
  correct_option text NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  explanation text,
  -- {"A": <concept_misconceptions.id or null>, ...}: which known
  -- misconception each distractor is designed to catch.
  distractor_misconceptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  bloom_level text CHECK (bloom_level IN ('remember','understand','apply','analyze','evaluate','create')),

  -- draft   = AI-authored, awaiting teacher review (never served)
  -- active  = eligible for CAT
  -- retired = withdrawn (kept for response history)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),

  -- 3PL parameters. Defaults are the cold-start prior; calibration replaces them.
  irt_a numeric NOT NULL DEFAULT 1.0 CHECK (irt_a > 0),
  irt_b numeric NOT NULL DEFAULT 0.0 CHECK (irt_b BETWEEN -6 AND 6),
  irt_c numeric NOT NULL DEFAULT 0.25 CHECK (irt_c >= 0 AND irt_c < 0.5),
  b_prior numeric NOT NULL DEFAULT 0.0,          -- cold-start difficulty; anchors sparse items
  b_se numeric,
  calibration_status text NOT NULL DEFAULT 'prior' CHECK (calibration_status IN ('prior','rasch','2pl')),
  n_responses int NOT NULL DEFAULT 0,
  n_correct int NOT NULL DEFAULT 0,
  review_flag text CHECK (review_flag IN ('ok','review_key','low_discrimination','too_easy','too_hard')),
  review_note text,
  last_calibrated_at timestamptz,

  ai_generated boolean NOT NULL DEFAULT true,
  generation_model text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qbank_lo ON public.question_bank(learning_objective_id);
CREATE INDEX IF NOT EXISTS idx_qbank_subtopic_status ON public.question_bank(subtopic_id, status);
-- Same stem under the same objective is a duplicate; lets the generator upsert safely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qbank_lo_stem ON public.question_bank(learning_objective_id, md5(stem));

CREATE OR REPLACE FUNCTION public.qbank_sync_subtopic()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT subtopic_id INTO NEW.subtopic_id
  FROM public.learning_objectives WHERE id = NEW.learning_objective_id;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qbank_sync_subtopic ON public.question_bank;
CREATE TRIGGER trg_qbank_sync_subtopic
BEFORE INSERT OR UPDATE OF learning_objective_id ON public.question_bank
FOR EACH ROW EXECUTE FUNCTION public.qbank_sync_subtopic();

-- ---------------------------------------------------------------------------
-- 2. CAT SESSIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('concept','topic','chapter','subject')),
  scope_id bigint NOT NULL,                     -- subtopics.id / topics.id / curriculum_chapters.id / books.id
  scope_label text,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned')),

  theta numeric NOT NULL DEFAULT 0,
  se numeric NOT NULL DEFAULT 1,
  prior_mean numeric NOT NULL DEFAULT 0,        -- warm start from student_ability
  prior_sd numeric NOT NULL DEFAULT 1,

  min_items int NOT NULL DEFAULT 6 CHECK (min_items >= 1),
  max_items int NOT NULL DEFAULT 15 CHECK (max_items >= 1),
  se_target numeric NOT NULL DEFAULT 0.45 CHECK (se_target > 0),
  items_administered int NOT NULL DEFAULT 0,
  correct_count int NOT NULL DEFAULT 0,

  pending_item_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  pending_served_at timestamptz,

  stop_reason text CHECK (stop_reason IN ('precision','max_items','bank_exhausted')),
  -- Share of administered items whose parameters were calibrated from data
  -- (not cold-start priors). Below 0.5 the result is labelled provisional.
  calibrated_fraction numeric,

  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one live session per student per scope (Start resumes it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cat_one_live_session
  ON public.cat_sessions(student_id, scope_type, scope_id) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_cat_sessions_student ON public.cat_sessions(student_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- 3. RESPONSE LOG (append-only). Parameters are snapshotted at serve time so a
--    later recalibration never rewrites what a past θ was computed from.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.cat_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  learning_objective_id bigint NOT NULL,
  seq int NOT NULL,
  selected_option text NOT NULL CHECK (selected_option IN ('A','B','C','D')),
  is_correct boolean NOT NULL,
  response_time_ms int,
  item_a numeric NOT NULL,
  item_b numeric NOT NULL,
  item_c numeric NOT NULL,
  calibrated boolean NOT NULL DEFAULT false,
  theta_before numeric NOT NULL,
  theta_after numeric NOT NULL,
  se_after numeric NOT NULL,
  responded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq),
  UNIQUE (session_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_item_resp_item ON public.item_responses(item_id);
CREATE INDEX IF NOT EXISTS idx_item_resp_student ON public.item_responses(student_id, responded_at DESC);

-- ---------------------------------------------------------------------------
-- 4. STUDENT ABILITY (latest θ per scope; seeds the next session's prior)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_ability (
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('concept','topic','chapter','subject')),
  scope_id bigint NOT NULL,
  theta numeric NOT NULL,
  se numeric NOT NULL,
  n_items int NOT NULL,
  last_session_id uuid REFERENCES public.cat_sessions(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, scope_type, scope_id)
);

-- ---------------------------------------------------------------------------
-- 5. CALIBRATION AUDIT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.irt_calibration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scope_type text,
  scope_id bigint,
  dry_run boolean NOT NULL DEFAULT false,
  items_considered int NOT NULL,
  items_updated int NOT NULL,
  responses_used int NOT NULL,
  units_used int NOT NULL,
  iterations int,
  converged boolean,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. SCOPE RESOLUTION + CANDIDATE POOL (service role only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cat_scope_subtopic_ids(p_scope_type text, p_scope_id bigint)
RETURNS TABLE (subtopic_id bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT st.id FROM public.subtopics st
   WHERE p_scope_type = 'concept' AND st.id = p_scope_id
  UNION ALL
  SELECT st.id FROM public.subtopics st
   WHERE p_scope_type = 'topic' AND st.topic_id = p_scope_id
  UNION ALL
  SELECT st.id FROM public.subtopics st
   JOIN public.topics t ON t.id = st.topic_id
   WHERE p_scope_type = 'chapter' AND t.chapter_id = p_scope_id
  UNION ALL
  SELECT st.id FROM public.subtopics st
   JOIN public.topics t ON t.id = st.topic_id
   JOIN public.curriculum_chapters c ON c.id = t.chapter_id
   JOIN public.units u ON u.id = c.unit_id
   WHERE p_scope_type = 'subject' AND u.book_id = p_scope_id;
$$;

-- Everything CAT selection needs in one round trip: active items in scope,
-- their IRT parameters, and this student's current BKT state per objective.
CREATE OR REPLACE FUNCTION public.get_cat_candidates(
  p_student_id uuid,
  p_scope_type text,
  p_scope_id bigint,
  p_exclude uuid[] DEFAULT '{}'
)
RETURNS TABLE (
  item_id uuid,
  learning_objective_id bigint,
  irt_a numeric,
  irt_b numeric,
  irt_c numeric,
  calibrated boolean,
  p_mastery numeric,
  opportunities int
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    q.id,
    q.learning_objective_id,
    q.irt_a, q.irt_b, q.irt_c,
    (q.calibration_status <> 'prior') AS calibrated,
    sm.p_mastery,
    COALESCE(sm.opportunities_count, 0)
  FROM public.question_bank q
  JOIN public.cat_scope_subtopic_ids(p_scope_type, p_scope_id) s ON s.subtopic_id = q.subtopic_id
  JOIN public.learning_objectives lo ON lo.id = q.learning_objective_id AND lo.status = 'active'
  LEFT JOIN public.student_mastery sm
    ON sm.student_id = p_student_id AND sm.learning_objective_id = q.learning_objective_id
  WHERE q.status = 'active'
    AND NOT (q.id = ANY (p_exclude));
$$;

-- ---------------------------------------------------------------------------
-- 7. ATOMIC ANSWER APPLICATION
--    Locks the session row, verifies the answered item is the one that was
--    served (blocks replays, double-submits and answering arbitrary items),
--    logs the response, updates counters and feeds BKT - all or nothing.
--    θ / SE are computed by the caller (TypeScript IRT module) and passed in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_cat_response(
  p_session_id uuid,
  p_item_id uuid,
  p_selected_option text,
  p_is_correct boolean,
  p_theta_after numeric,
  p_se_after numeric
)
RETURNS TABLE (seq int, learning_objective_id bigint, p_mastery_before numeric, p_mastery_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.cat_sessions%ROWTYPE;
  v_item public.question_bank%ROWTYPE;
  v_seq int;
  v_ms int;
  v_before numeric;
  v_after numeric;
BEGIN
  SELECT * INTO v_session FROM public.cat_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_session.status <> 'in_progress' THEN RAISE EXCEPTION 'session_not_active'; END IF;
  IF v_session.pending_item_id IS DISTINCT FROM p_item_id THEN RAISE EXCEPTION 'item_not_pending'; END IF;

  SELECT * INTO v_item FROM public.question_bank WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;

  v_seq := v_session.items_administered + 1;
  v_ms := GREATEST(0, (EXTRACT(EPOCH FROM (now() - v_session.pending_served_at)) * 1000)::int);

  INSERT INTO public.item_responses
    (session_id, student_id, item_id, learning_objective_id, seq, selected_option, is_correct,
     response_time_ms, item_a, item_b, item_c, calibrated, theta_before, theta_after, se_after)
  VALUES
    (p_session_id, v_session.student_id, p_item_id, v_item.learning_objective_id, v_seq, p_selected_option, p_is_correct,
     v_ms, v_item.irt_a, v_item.irt_b, v_item.irt_c, v_item.calibration_status <> 'prior',
     v_session.theta, p_theta_after, p_se_after);

  UPDATE public.cat_sessions SET
    theta = p_theta_after,
    se = p_se_after,
    items_administered = v_seq,
    correct_count = correct_count + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
    pending_item_id = NULL,
    pending_served_at = NULL,
    updated_at = now()
  WHERE id = p_session_id;

  UPDATE public.question_bank SET
    n_responses = n_responses + 1,
    n_correct = n_correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END
  WHERE id = p_item_id;

  -- Feed the Bayesian Knowledge Tracing engine with this graded answer.
  SELECT r.p_mastery_before, r.p_mastery_after INTO v_before, v_after
  FROM public.record_mastery_evidence(
    v_session.student_id, v_item.learning_objective_id, p_is_correct, 'mcq', p_session_id
  ) r;

  RETURN QUERY SELECT v_seq, v_item.learning_objective_id, v_before, v_after;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_ability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irt_calibration_runs ENABLE ROW LEVEL SECURITY;

-- Item bank: staff only. Deliberately NO student policy (holds the answer key).
DROP POLICY IF EXISTS "Staff manage question bank" ON public.question_bank;
CREATE POLICY "Staff manage question bank" ON public.question_bank FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own CAT sessions" ON public.cat_sessions;
CREATE POLICY "Students read own CAT sessions" ON public.cat_sessions FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));
DROP POLICY IF EXISTS "Staff read CAT sessions" ON public.cat_sessions;
CREATE POLICY "Staff read CAT sessions" ON public.cat_sessions FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own item responses" ON public.item_responses;
CREATE POLICY "Students read own item responses" ON public.item_responses FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));
DROP POLICY IF EXISTS "Staff read item responses" ON public.item_responses;
CREATE POLICY "Staff read item responses" ON public.item_responses FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own ability" ON public.student_ability;
CREATE POLICY "Students read own ability" ON public.student_ability FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));
DROP POLICY IF EXISTS "Staff read ability" ON public.student_ability;
CREATE POLICY "Staff read ability" ON public.student_ability FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Staff read calibration runs" ON public.irt_calibration_runs;
CREATE POLICY "Staff read calibration runs" ON public.irt_calibration_runs FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

-- ---------------------------------------------------------------------------
-- 9. FUNCTION PRIVILEGES
--    Postgres grants EXECUTE to PUBLIC by default, and Supabase also grants it
--    to anon/authenticated. These functions trust their arguments (student id,
--    correctness), so they must be callable ONLY by the service role - i.e.
--    from the cat-session edge function, never straight from a browser.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.cat_scope_subtopic_ids(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cat_candidates(uuid, text, bigint, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_cat_response(uuid, uuid, text, boolean, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cat_scope_subtopic_ids(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cat_candidates(uuid, text, bigint, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_cat_response(uuid, uuid, text, boolean, numeric, numeric) TO service_role;
