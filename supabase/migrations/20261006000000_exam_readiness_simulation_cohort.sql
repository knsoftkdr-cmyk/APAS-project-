-- ============================================================================
-- EXAM READINESS SCORE  +  EXAM SIMULATION MODE  +  COHORT INTELLIGENCE
--
-- Purely additive on top of the mastery / knowledge-graph / forgetting-curve /
-- item-bank / blueprint / paper-assignment engines. No new tables for
-- readiness or cohort analytics - both are computed from data that already
-- exists (student_mastery, review_schedule, class_students, profiles).
--
--   1. Exam Simulation Mode
--        exam_pattern_templates   real-world exam structures (CBSE Class X
--                                 Science / Maths, generic unit-test, half-
--                                 yearly, annual) that generate-assessment-
--                                 paper turns into a blueprint + paper.
--        assignment columns       is_mock / strict_timer / grace_seconds /
--                                 opens_at   (server-enforced exam rules)
--        attempt columns          answers_draft (autosave), auto_submitted,
--                                 late_submission, time_taken_seconds,
--                                 analysis (post-exam breakdown)
--        + a scoring fix          open-ended scores are now scaled to the
--                                 marks the PAPER assigns the item.
--
--   2. Exam Readiness Score
--        get_exam_readiness()        one student: topic -> chapter -> subject
--                                    -> overall, optionally weighted by an
--                                    exam blueprint and projected to an exam
--                                    date using the forgetting curve.
--        get_class_exam_readiness()  a roster's readiness, for teachers.
--
--   3. Cohort Intelligence
--        cohort_student_scores()     one comparable score per student
--        cohort_topic_scores()       ... and per student per topic
--        get_student_cohort_comparison()   student vs section / class / grade /
--                                          school
--        get_class_cohort_intelligence()   a section vs its class-group, grade
--                                          and school + roster patterns
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Exam pattern templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_pattern_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name text NOT NULL,
  board text,
  grade text,
  subject text,
  description text,
  total_marks numeric NOT NULL CHECK (total_marks > 0),
  duration_minutes int NOT NULL CHECK (duration_minutes > 0),
  -- [{"question_type":"mcq","marks_per_item":1,"total_marks":20,"section_label":"Section A - Multiple Choice"}, ...]
  -- Same shape as assessment_blueprints.question_type_mix plus an optional
  -- section_label, so two "descriptive" sections (2-mark and 5-mark) stay
  -- distinct on the paper.
  question_type_mix jsonb NOT NULL CHECK (jsonb_typeof(question_type_mix) = 'array'),
  bloom_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty_distribution jsonb NOT NULL DEFAULT '{"easy":30,"medium":50,"hard":20}'::jsonb,
  instructions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(instructions) = 'array'),
  is_system boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Section marks must add up to the paper total; a CHECK can't hold a subquery,
-- so this is enforced by the trigger below.
CREATE OR REPLACE FUNCTION public.exam_pattern_validate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sum numeric;
  v_bad int;
BEGIN
  SELECT COALESCE(sum((e->>'total_marks')::numeric), 0),
         count(*) FILTER (WHERE COALESCE((e->>'marks_per_item')::numeric, 0) <= 0
                             OR COALESCE((e->>'total_marks')::numeric, 0) <= 0
                             OR (e->>'total_marks')::numeric % (e->>'marks_per_item')::numeric <> 0)
    INTO v_sum, v_bad
  FROM jsonb_array_elements(NEW.question_type_mix) e;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'exam pattern "%": every section needs positive marks_per_item and a total_marks that is a whole multiple of it', NEW.code;
  END IF;
  IF v_sum <> NEW.total_marks THEN
    RAISE EXCEPTION 'exam pattern "%": section marks (%) must add up to total_marks (%)', NEW.code, v_sum, NEW.total_marks;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exam_pattern_validate ON public.exam_pattern_templates;
CREATE TRIGGER trg_exam_pattern_validate
BEFORE INSERT OR UPDATE ON public.exam_pattern_templates
FOR EACH ROW EXECUTE FUNCTION public.exam_pattern_validate();

ALTER TABLE public.exam_pattern_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read exam patterns" ON public.exam_pattern_templates;
CREATE POLICY "Authenticated read exam patterns" ON public.exam_pattern_templates FOR SELECT
  USING (auth.role() = 'authenticated' AND status = 'active');

DROP POLICY IF EXISTS "Staff manage custom exam patterns" ON public.exam_pattern_templates;
CREATE POLICY "Staff manage custom exam patterns" ON public.exam_pattern_templates FOR ALL
  USING (is_system = false AND public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (is_system = false AND public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

-- Seed. CBSE structures follow the published Class X (2024-25 onward) theory
-- paper layout: 80 marks / 3 hours, sections A-E. The generic school patterns
-- are sensible defaults that schools can clone and edit.
INSERT INTO public.exam_pattern_templates
  (code, name, board, grade, subject, description, total_marks, duration_minutes, question_type_mix, bloom_distribution, difficulty_distribution, instructions, is_system)
VALUES
  ('cbse_10_science', 'CBSE Class X - Science (Board pattern)', 'CBSE', '10', 'Science',
   'Theory paper: 80 marks, 3 hours. Section A 20 x 1, B 6 x 2, C 7 x 3, D 3 x 5, E 3 case-based x 4.',
   80, 180,
   '[{"question_type":"mcq","marks_per_item":1,"total_marks":20,"section_label":"Section A - Multiple Choice (1 mark each)"},
     {"question_type":"descriptive","marks_per_item":2,"total_marks":12,"section_label":"Section B - Very Short Answer (2 marks each)"},
     {"question_type":"descriptive","marks_per_item":3,"total_marks":21,"section_label":"Section C - Short Answer (3 marks each)"},
     {"question_type":"descriptive","marks_per_item":5,"total_marks":15,"section_label":"Section D - Long Answer (5 marks each)"},
     {"question_type":"case_based","marks_per_item":4,"total_marks":12,"section_label":"Section E - Case/Source-Based (4 marks each)"}]'::jsonb,
   '{}'::jsonb, '{"easy":30,"medium":50,"hard":20}'::jsonb,
   '["All questions are compulsory.","Section A carries 20 questions of 1 mark each.","Section E contains three case-based questions of 4 marks each."]'::jsonb,
   true),
  ('cbse_10_maths_standard', 'CBSE Class X - Mathematics Standard (Board pattern)', 'CBSE', '10', 'Mathematics',
   'Theory paper: 80 marks, 3 hours. Section A 20 x 1, B 5 x 2, C 6 x 3, D 4 x 5, E 3 case-based x 4.',
   80, 180,
   '[{"question_type":"mcq","marks_per_item":1,"total_marks":20,"section_label":"Section A - Multiple Choice (1 mark each)"},
     {"question_type":"descriptive","marks_per_item":2,"total_marks":10,"section_label":"Section B - Very Short Answer (2 marks each)"},
     {"question_type":"descriptive","marks_per_item":3,"total_marks":18,"section_label":"Section C - Short Answer (3 marks each)"},
     {"question_type":"descriptive","marks_per_item":5,"total_marks":20,"section_label":"Section D - Long Answer (5 marks each)"},
     {"question_type":"case_based","marks_per_item":4,"total_marks":12,"section_label":"Section E - Case-Study Based (4 marks each)"}]'::jsonb,
   '{}'::jsonb, '{"easy":30,"medium":50,"hard":20}'::jsonb,
   '["All questions are compulsory.","Show all steps of working for Sections B-E."]'::jsonb,
   true),
  ('unit_test_25', 'Unit Test (25 marks)', 'School', NULL, NULL,
   'Short classroom test: 45 minutes.',
   25, 45,
   '[{"question_type":"mcq","marks_per_item":1,"total_marks":5,"section_label":"Section A - Multiple Choice"},
     {"question_type":"descriptive","marks_per_item":2,"total_marks":8,"section_label":"Section B - Short Answer (2 marks each)"},
     {"question_type":"descriptive","marks_per_item":3,"total_marks":6,"section_label":"Section C - Short Answer (3 marks each)"},
     {"question_type":"case_based","marks_per_item":6,"total_marks":6,"section_label":"Section D - Case-Based"}]'::jsonb,
   '{"remember":20,"understand":30,"apply":30,"analyze":20}'::jsonb, '{"easy":40,"medium":45,"hard":15}'::jsonb,
   '["All questions are compulsory."]'::jsonb, true),
  ('half_yearly_50', 'Half-Yearly Exam (50 marks)', 'School', NULL, NULL,
   'Mid-year exam: 90 minutes.',
   50, 90,
   '[{"question_type":"mcq","marks_per_item":1,"total_marks":10,"section_label":"Section A - Multiple Choice"},
     {"question_type":"descriptive","marks_per_item":2,"total_marks":10,"section_label":"Section B - Short Answer (2 marks each)"},
     {"question_type":"descriptive","marks_per_item":3,"total_marks":12,"section_label":"Section C - Short Answer (3 marks each)"},
     {"question_type":"descriptive","marks_per_item":5,"total_marks":10,"section_label":"Section D - Long Answer (5 marks each)"},
     {"question_type":"case_based","marks_per_item":4,"total_marks":8,"section_label":"Section E - Case-Based"}]'::jsonb,
   '{"remember":15,"understand":25,"apply":30,"analyze":15,"evaluate":10,"create":5}'::jsonb, '{"easy":30,"medium":50,"hard":20}'::jsonb,
   '["All questions are compulsory."]'::jsonb, true),
  ('annual_100', 'Annual Exam (100 marks)', 'School', NULL, NULL,
   'Full-length annual exam: 3 hours.',
   100, 180,
   '[{"question_type":"mcq","marks_per_item":1,"total_marks":20,"section_label":"Section A - Multiple Choice"},
     {"question_type":"descriptive","marks_per_item":2,"total_marks":20,"section_label":"Section B - Short Answer (2 marks each)"},
     {"question_type":"descriptive","marks_per_item":3,"total_marks":18,"section_label":"Section C - Short Answer (3 marks each)"},
     {"question_type":"descriptive","marks_per_item":5,"total_marks":20,"section_label":"Section D - Long Answer (5 marks each)"},
     {"question_type":"case_based","marks_per_item":4,"total_marks":12,"section_label":"Section E - Case-Based"},
     {"question_type":"hots","marks_per_item":5,"total_marks":10,"section_label":"Section F - Higher-Order Thinking"}]'::jsonb,
   '{"remember":15,"understand":25,"apply":25,"analyze":15,"evaluate":10,"create":10}'::jsonb, '{"easy":30,"medium":50,"hard":20}'::jsonb,
   '["All questions are compulsory."]'::jsonb, true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1b. Mock-exam rules on assignments + autosave / analysis on attempts
-- ---------------------------------------------------------------------------
ALTER TABLE public.assessment_blueprints
  ADD COLUMN IF NOT EXISTS exam_pattern_code text,
  ADD COLUMN IF NOT EXISTS instructions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.generated_assessment_papers
  ADD COLUMN IF NOT EXISTS exam_pattern_code text,
  ADD COLUMN IF NOT EXISTS instructions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.generated_assessment_paper_assignments
  ADD COLUMN IF NOT EXISTS is_mock boolean NOT NULL DEFAULT false,
  -- strict_timer: the SERVER enforces the deadline (started_at + limit + grace).
  ADD COLUMN IF NOT EXISTS strict_timer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grace_seconds int NOT NULL DEFAULT 60 CHECK (grace_seconds >= 0),
  -- The exam cannot be opened before this moment.
  ADD COLUMN IF NOT EXISTS opens_at timestamptz;

ALTER TABLE public.generated_assessment_paper_attempts
  ADD COLUMN IF NOT EXISTS answers_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS draft_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_submission boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_taken_seconds int,
  -- {"sections":[{label,marks,max_marks,pct}], "bloom":[...], "topics":[...], "weak_topics":[...]}
  ADD COLUMN IF NOT EXISTS analysis jsonb;

CREATE INDEX IF NOT EXISTS idx_paper_assign_mock ON public.generated_assessment_paper_assignments(is_mock) WHERE is_mock;

-- ---------------------------------------------------------------------------
-- 1c. Scoring fix: the paper, not the item, decides how many marks a question
--     is worth. A 5-mark bank item placed in a 3-mark slot must contribute at
--     most 3, and a teacher's 4/5 must count as 2.4/3 - otherwise the attempt
--     total can exceed the paper's maximum. Scales by paper_marks / item.max_marks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_assessment_attempt_grade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt RECORD;
  v_total int;
  v_reviewed int;
  v_teacher_sum numeric;
BEGIN
  IF NEW.source <> 'test' OR NEW.status <> 'teacher_reviewed' OR NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt FROM public.generated_assessment_paper_attempts WHERE id = NEW.source_id;
  IF NOT FOUND OR v_attempt.status = 'graded' THEN
    RETURN NEW;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE s.status = 'teacher_reviewed'),
         COALESCE(sum(
           CASE WHEN s.status = 'teacher_reviewed'
                THEN LEAST(
                       COALESCE(s.teacher_score, 0) * COALESCE(pi.marks / NULLIF(q.max_marks, 0), 1),
                       COALESCE(pi.marks, q.max_marks))
           END), 0)
    INTO v_total, v_reviewed, v_teacher_sum
  FROM public.open_response_submissions s
  JOIN public.question_bank_extended q ON q.id = s.item_id
  LEFT JOIN public.generated_assessment_paper_assignments asg ON asg.id = v_attempt.assignment_id
  LEFT JOIN public.generated_assessment_paper_items pi
         ON pi.paper_id = asg.paper_id AND pi.extended_item_id = s.item_id
  WHERE s.source = 'test' AND s.source_id = NEW.source_id;

  IF v_total > 0 AND v_reviewed = v_total THEN
    UPDATE public.generated_assessment_paper_attempts
    SET open_ended_teacher_score = round(v_teacher_sum, 2),
        total_score = round(COALESCE(v_attempt.mcq_score, 0) + v_teacher_sum, 2),
        status = 'graded',
        graded_at = now()
    WHERE id = NEW.source_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2a. get_exam_readiness(student, book?, blueprint?, exam_date?)
--
-- THE MODEL (deliberately simple and fully explainable):
--
--   effective_mastery(objective) = P(mastery) x retention
--
--     P(mastery)  the student's BKT estimate for that learning objective
--                 (the unassessed prior, p_init, if they have never been
--                 assessed on it - so gaps in coverage pull readiness DOWN
--                 rather than being ignored).
--     retention   Ebbinghaus retention from the forgetting-curve engine,
--                 evaluated AT THE EXAM DATE when one is given (otherwise
--                 now). Objectives with no review history are not decayed.
--
--   readiness(topic)   = mean effective mastery of the topic's objectives
--   readiness(chapter) = objective-weighted mean of its topics
--   readiness(subject) = objective-weighted mean of its chapters
--   readiness(overall) = objective-weighted mean of the subjects
--
--   Weighting by objective count means a big topic counts for more than a
--   small one, exactly as it does on a real syllabus. When a blueprint is
--   supplied, `blueprint.readiness` instead weights each syllabus scope by
--   the marks the exam gives it (syllabus_weightage.weight_pct), which is the
--   number that predicts the mark on THAT paper.
--
--   readiness is reported on a 0-100 scale and doubles as the predicted
--   score (%) for a paper drawn evenly from the objectives in scope.
--
--   Bands:  >= 80 exam_ready | >= 65 nearly_ready | >= 45 needs_work | else at_risk
--   Confidence is about EVIDENCE, not the score: the share of objectives the
--   student has actually been assessed on (coverage) and how many attempts
--   sit behind them. A high score on thin evidence is flagged low-confidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_exam_readiness(
  p_student_id uuid,
  p_book_id bigint DEFAULT NULL,
  p_blueprint_id uuid DEFAULT NULL,
  p_exam_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT
      GREATEST(now(), COALESCE((p_exam_date::timestamp AT TIME ZONE 'UTC'), now())) AS at_ts,
      CASE WHEN p_exam_date IS NULL THEN NULL
           ELSE GREATEST(0, p_exam_date - CURRENT_DATE) END AS days_to_exam
  ),
  obj AS (
    SELECT
      lo.id AS lo_id, lo.subtopic_id, lo.bloom_level,
      st.subtopic_name,
      t.id AS topic_id, t.topic_name,
      c.id AS chapter_id, c.chapter_name,
      b.id AS book_id, b.subject, b.class_name,
      LEAST(1, GREATEST(0, COALESCE(sm.p_mastery, bp.p_init, 0.30))) AS p_mastery,
      COALESCE(sm.opportunities_count, 0) AS opps,
      CASE WHEN rs.last_reviewed_at IS NOT NULL AND rs.suspended = false
           THEN LEAST(1, GREATEST(0, public.predict_retention(rs.last_reviewed_at, rs.interval_days, (SELECT at_ts FROM cfg))))
      END AS retention
    FROM public.learning_objectives lo
    JOIN public.subtopics st ON st.id = lo.subtopic_id
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    JOIN public.books b ON b.id = u.book_id
    LEFT JOIN public.mastery_bkt_params bp ON bp.learning_objective_id = lo.id
    LEFT JOIN public.student_mastery sm ON sm.learning_objective_id = lo.id AND sm.student_id = p_student_id
    LEFT JOIN public.review_schedule rs ON rs.learning_objective_id = lo.id AND rs.student_id = p_student_id
    WHERE lo.status = 'active'
      AND (p_book_id IS NULL OR b.id = p_book_id)
  ),
  obj_eff AS (
    SELECT o.*, o.p_mastery * COALESCE(o.retention, 1) AS eff
    FROM obj o
  ),
  topic_r AS (
    SELECT book_id, subject, class_name, chapter_id, chapter_name, topic_id, topic_name,
           count(*) AS n_obj,
           count(*) FILTER (WHERE opps > 0) AS n_att,
           count(*) FILTER (WHERE eff < 0.5) AS n_weak,
           avg(eff) AS eff, avg(p_mastery) AS cur
    FROM obj_eff
    GROUP BY book_id, subject, class_name, chapter_id, chapter_name, topic_id, topic_name
  ),
  chapter_r AS (
    SELECT book_id, subject, class_name, chapter_id, chapter_name,
           sum(n_obj) AS n_obj, sum(n_att) AS n_att, sum(n_weak) AS n_weak,
           sum(eff * n_obj) / sum(n_obj) AS eff, sum(cur * n_obj) / sum(n_obj) AS cur
    FROM topic_r
    GROUP BY book_id, subject, class_name, chapter_id, chapter_name
  ),
  subject_r AS (
    SELECT book_id, subject, class_name,
           sum(n_obj) AS n_obj, sum(n_att) AS n_att, sum(n_weak) AS n_weak,
           sum(eff * n_obj) / sum(n_obj) AS eff, sum(cur * n_obj) / sum(n_obj) AS cur
    FROM chapter_r
    GROUP BY book_id, subject, class_name
  ),
  overall_r AS (
    SELECT sum(n_obj) AS n_obj, sum(n_att) AS n_att, sum(n_weak) AS n_weak,
           sum(eff * n_obj) / NULLIF(sum(n_obj), 0) AS eff,
           sum(cur * n_obj) / NULLIF(sum(n_obj), 0) AS cur
    FROM subject_r
  ),
  avg_opps AS (
    SELECT COALESCE(avg(opps) FILTER (WHERE opps > 0), 0) AS a FROM obj_eff
  ),
  -- ── Blueprint-weighted view (marks the exam gives each syllabus scope) ──
  bp AS (SELECT id, title, syllabus_weightage FROM public.assessment_blueprints WHERE id = p_blueprint_id),
  bp_scopes AS (
    SELECT (e->>'scope_type') AS scope_type,
           (e->>'scope_id')::bigint AS scope_id,
           COALESCE(e->>'label', 'scope ' || (e->>'scope_id')) AS label,
           COALESCE((e->>'weight_pct')::numeric, 0) AS w
    FROM bp, jsonb_array_elements(bp.syllabus_weightage) e
  ),
  bp_scope_scores AS (
    SELECT s.scope_type, s.scope_id, s.label, s.w,
           count(o.lo_id) AS n_obj,
           count(o.lo_id) FILTER (WHERE o.opps > 0) AS n_att,
           avg(o.eff) AS eff
    FROM bp_scopes s
    LEFT JOIN obj_eff o
      ON (s.scope_type = 'topic' AND o.topic_id = s.scope_id)
      OR (s.scope_type <> 'topic' AND o.chapter_id = s.scope_id)
    GROUP BY s.scope_type, s.scope_id, s.label, s.w
  ),
  bp_result AS (
    SELECT
      (SELECT id FROM bp) AS id, (SELECT title FROM bp) AS title,
      sum(eff * w) FILTER (WHERE n_obj > 0) / NULLIF(sum(w) FILTER (WHERE n_obj > 0), 0) AS eff,
      COALESCE(sum(w) FILTER (WHERE n_obj = 0), 0) AS unmapped_weight_pct
    FROM bp_scope_scores
  ),
  -- ── What to study first: syllabus share x how far from ready ──
  focus AS (
    SELECT t.*, (t.n_obj::numeric / NULLIF((SELECT n_obj FROM overall_r), 0)) * (1 - t.eff) AS priority
    FROM topic_r t
    WHERE t.eff < 0.80
    ORDER BY priority DESC NULLS LAST
    LIMIT 6
  ),
  weak_concepts AS (
    SELECT subtopic_id, subtopic_name, topic_name, chapter_name, subject,
           count(*) AS n_obj, avg(eff) AS eff, avg(p_mastery) AS cur,
           count(*) FILTER (WHERE opps > 0) AS n_att
    FROM obj_eff
    GROUP BY subtopic_id, subtopic_name, topic_name, chapter_name, subject
    HAVING avg(eff) < 0.65
    ORDER BY (1 - avg(eff)) * count(*) DESC
    LIMIT 8
  ),
  bloom_r AS (
    SELECT COALESCE(bloom_level, 'unclassified') AS bloom_level, count(*) AS n_obj,
           count(*) FILTER (WHERE opps > 0) AS n_att, avg(eff) AS eff
    FROM obj_eff GROUP BY COALESCE(bloom_level, 'unclassified')
  ),
  mocks AS (
    SELECT a.id AS attempt_id, asg.title, a.total_score, a.total_max_marks, a.submitted_at, a.status,
           round(100 * a.total_score / NULLIF(a.total_max_marks, 0), 1) AS pct
    FROM public.generated_assessment_paper_attempts a
    JOIN public.generated_assessment_paper_assignments asg ON asg.id = a.assignment_id
    WHERE a.student_id = p_student_id AND asg.is_mock AND a.status IN ('submitted','graded')
      AND a.total_score IS NOT NULL
    ORDER BY a.submitted_at DESC NULLS LAST
    LIMIT 5
  )
  SELECT CASE WHEN (SELECT n_obj FROM overall_r) IS NULL THEN
    jsonb_build_object(
      'student_id', p_student_id, 'has_data', false, 'overall', NULL, 'subjects', '[]'::jsonb,
      'message', 'No learning objectives exist for this scope yet, so readiness cannot be computed.')
  ELSE
    jsonb_build_object(
      'student_id', p_student_id,
      'has_data', true,
      'generated_at', now(),
      'exam_date', p_exam_date,
      'days_to_exam', (SELECT days_to_exam FROM cfg),
      'projected_to', (SELECT at_ts FROM cfg),
      'overall', (
        SELECT jsonb_build_object(
          'readiness', round((eff * 100)::numeric, 1),
          'current_mastery', round((cur * 100)::numeric, 1),
          'forgetting_loss', round(((cur - eff) * 100)::numeric, 1),
          'predicted_score_pct', round((eff * 100)::numeric, 1),
          'band', CASE WHEN eff >= 0.80 THEN 'exam_ready' WHEN eff >= 0.65 THEN 'nearly_ready'
                       WHEN eff >= 0.45 THEN 'needs_work' ELSE 'at_risk' END,
          'objective_count', n_obj, 'assessed_count', n_att,
          'weak_objective_count', n_weak,
          'coverage_pct', round((100.0 * n_att / n_obj)::numeric, 1),
          'confidence', CASE
             WHEN n_att::numeric / n_obj >= 0.70 AND (SELECT a FROM avg_opps) >= 2 THEN 'high'
             WHEN n_att::numeric / n_obj >= 0.40 THEN 'medium'
             ELSE 'low' END
        ) FROM overall_r),
      'subjects', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'book_id', s.book_id, 'subject', s.subject, 'class_name', s.class_name,
          'readiness', round((s.eff * 100)::numeric, 1),
          'current_mastery', round((s.cur * 100)::numeric, 1),
          'band', CASE WHEN s.eff >= 0.80 THEN 'exam_ready' WHEN s.eff >= 0.65 THEN 'nearly_ready'
                       WHEN s.eff >= 0.45 THEN 'needs_work' ELSE 'at_risk' END,
          'objective_count', s.n_obj, 'assessed_count', s.n_att,
          'coverage_pct', round((100.0 * s.n_att / s.n_obj)::numeric, 1),
          'chapters', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'chapter_id', c.chapter_id, 'name', c.chapter_name,
              'readiness', round((c.eff * 100)::numeric, 1),
              'current_mastery', round((c.cur * 100)::numeric, 1),
              'band', CASE WHEN c.eff >= 0.80 THEN 'exam_ready' WHEN c.eff >= 0.65 THEN 'nearly_ready'
                           WHEN c.eff >= 0.45 THEN 'needs_work' ELSE 'at_risk' END,
              'objective_count', c.n_obj, 'assessed_count', c.n_att,
              'coverage_pct', round((100.0 * c.n_att / c.n_obj)::numeric, 1),
              'topics', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'topic_id', t.topic_id, 'name', t.topic_name,
                  'readiness', round((t.eff * 100)::numeric, 1),
                  'current_mastery', round((t.cur * 100)::numeric, 1),
                  'band', CASE WHEN t.eff >= 0.80 THEN 'exam_ready' WHEN t.eff >= 0.65 THEN 'nearly_ready'
                               WHEN t.eff >= 0.45 THEN 'needs_work' ELSE 'at_risk' END,
                  'objective_count', t.n_obj, 'assessed_count', t.n_att,
                  'coverage_pct', round((100.0 * t.n_att / t.n_obj)::numeric, 1)
                ) ORDER BY t.topic_id)
                FROM topic_r t WHERE t.chapter_id = c.chapter_id AND t.book_id = c.book_id
              ), '[]'::jsonb)
            ) ORDER BY c.chapter_id)
            FROM chapter_r c WHERE c.book_id = s.book_id
          ), '[]'::jsonb)
        ) ORDER BY s.subject, s.book_id)
        FROM subject_r s
      ), '[]'::jsonb),
      'blueprint', CASE WHEN p_blueprint_id IS NULL OR (SELECT id FROM bp_result) IS NULL THEN NULL ELSE (
        SELECT jsonb_build_object(
          'blueprint_id', r.id, 'title', r.title,
          'readiness', CASE WHEN r.eff IS NULL THEN NULL ELSE round((r.eff * 100)::numeric, 1) END,
          'predicted_score_pct', CASE WHEN r.eff IS NULL THEN NULL ELSE round((r.eff * 100)::numeric, 1) END,
          'band', CASE WHEN r.eff IS NULL THEN NULL WHEN r.eff >= 0.80 THEN 'exam_ready' WHEN r.eff >= 0.65 THEN 'nearly_ready'
                       WHEN r.eff >= 0.45 THEN 'needs_work' ELSE 'at_risk' END,
          'unmapped_weight_pct', round(r.unmapped_weight_pct, 1),
          'scopes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'scope_type', s.scope_type, 'scope_id', s.scope_id, 'label', s.label, 'weight_pct', s.w,
              'readiness', CASE WHEN s.n_obj = 0 THEN NULL ELSE round((s.eff * 100)::numeric, 1) END,
              'coverage_pct', CASE WHEN s.n_obj = 0 THEN NULL ELSE round((100.0 * s.n_att / s.n_obj)::numeric, 1) END
            ) ORDER BY s.w DESC)
            FROM bp_scope_scores s
          ), '[]'::jsonb)
        ) FROM bp_result r) END,
      'focus_areas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'topic_id', f.topic_id, 'topic_name', f.topic_name, 'chapter_name', f.chapter_name, 'subject', f.subject,
          'readiness', round((f.eff * 100)::numeric, 1), 'coverage_pct', round((100.0 * f.n_att / f.n_obj)::numeric, 1),
          'priority', round(f.priority::numeric, 4)
        ) ORDER BY f.priority DESC)
        FROM focus f
      ), '[]'::jsonb),
      'weakest_concepts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'subtopic_id', w.subtopic_id, 'name', w.subtopic_name, 'topic_name', w.topic_name,
          'chapter_name', w.chapter_name, 'subject', w.subject,
          'readiness', round((w.eff * 100)::numeric, 1), 'assessed', w.n_att > 0
        ) ORDER BY (1 - w.eff) * w.n_obj DESC)
        FROM weak_concepts w
      ), '[]'::jsonb),
      'bloom', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'bloom_level', b.bloom_level, 'readiness', round((b.eff * 100)::numeric, 1),
          'objective_count', b.n_obj, 'assessed_count', b.n_att
        ) ORDER BY CASE b.bloom_level WHEN 'remember' THEN 1 WHEN 'understand' THEN 2 WHEN 'apply' THEN 3
                                      WHEN 'analyze' THEN 4 WHEN 'evaluate' THEN 5 WHEN 'create' THEN 6 ELSE 7 END)
        FROM bloom_r b
      ), '[]'::jsonb),
      'mock_exams', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'attempt_id', m.attempt_id, 'title', m.title, 'score', m.total_score, 'max_marks', m.total_max_marks,
          'pct', m.pct, 'status', m.status, 'submitted_at', m.submitted_at
        ) ORDER BY m.submitted_at DESC NULLS LAST)
        FROM mocks m
      ), '[]'::jsonb)
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- 2b. get_class_exam_readiness(students[], book?, blueprint?, exam_date?)
--     Teacher rollup: every student's overall readiness + the class-average
--     readiness of every topic, plus a band histogram.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_class_exam_readiness(
  p_student_ids uuid[],
  p_book_id bigint DEFAULT NULL,
  p_blueprint_id uuid DEFAULT NULL,
  p_exam_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per AS (
    SELECT s.id AS student_id, COALESCE(pr.full_name, 'Student') AS student_name,
           public.get_exam_readiness(s.id, p_book_id, p_blueprint_id, p_exam_date) AS r
    FROM public.students s
    LEFT JOIN public.profiles pr ON pr.id = s.profile_id
    WHERE s.id = ANY(p_student_ids)
  ),
  scored AS (
    SELECT student_id, student_name, r,
           (r->'overall'->>'readiness')::numeric AS readiness,
           r->'overall'->>'band' AS band,
           (r->'overall'->>'coverage_pct')::numeric AS coverage_pct,
           r->'overall'->>'confidence' AS confidence,
           (r->'blueprint'->>'readiness')::numeric AS blueprint_readiness
    FROM per
  ),
  topics AS (
    SELECT (t->>'topic_id')::bigint AS topic_id, t->>'name' AS topic_name, ch->>'name' AS chapter_name,
           (t->>'readiness')::numeric AS readiness
    FROM scored,
         jsonb_array_elements(r->'subjects') sj,
         jsonb_array_elements(sj->'chapters') ch,
         jsonb_array_elements(ch->'topics') t
    WHERE (r->>'has_data')::boolean
  ),
  topic_avg AS (
    SELECT topic_id, topic_name, chapter_name,
           round(avg(readiness), 1) AS class_readiness,
           count(*) FILTER (WHERE readiness < 45) AS students_at_risk,
           count(*) AS students
    FROM topics GROUP BY topic_id, topic_name, chapter_name
  )
  SELECT jsonb_build_object(
    'roster_size', (SELECT count(*) FROM scored),
    'students_with_data', (SELECT count(*) FROM scored WHERE readiness IS NOT NULL),
    'class_avg_readiness', (SELECT round(avg(readiness), 1) FROM scored),
    'class_avg_blueprint_readiness', (SELECT round(avg(blueprint_readiness), 1) FROM scored),
    'bands', jsonb_build_object(
      'exam_ready',   (SELECT count(*) FROM scored WHERE band = 'exam_ready'),
      'nearly_ready', (SELECT count(*) FROM scored WHERE band = 'nearly_ready'),
      'needs_work',   (SELECT count(*) FROM scored WHERE band = 'needs_work'),
      'at_risk',      (SELECT count(*) FROM scored WHERE band = 'at_risk')),
    'students', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'student_id', student_id, 'name', student_name, 'readiness', readiness, 'band', band,
        'blueprint_readiness', blueprint_readiness, 'coverage_pct', coverage_pct, 'confidence', confidence,
        'weakest_topic', (SELECT f->>'topic_name' FROM jsonb_array_elements(r->'focus_areas') f LIMIT 1)
      ) ORDER BY readiness ASC NULLS LAST, student_name)
      FROM scored
    ), '[]'::jsonb),
    'topics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'topic_id', topic_id, 'topic_name', topic_name, 'chapter_name', chapter_name,
        'class_readiness', class_readiness, 'students_at_risk', students_at_risk, 'students', students
      ) ORDER BY class_readiness ASC)
      FROM topic_avg
    ), '[]'::jsonb)
  );
$$;

-- ===========================================================================
-- 3. COHORT INTELLIGENCE
--
-- How the four comparison levels map onto APAS's data model:
--
--   section  the student's own class roster  (classes row = name + section,
--            e.g. "Grade 8 - A"); if a student is on several rosters, the most
--            recently assigned one is their primary section.
--   class    every section sharing that classes.name ("Grade 8" = A+B+C).
--   grade    every student in the school with the same students.grade.
--   school   every student in the school (profiles.school_id).
--
-- Comparisons never cross schools. A student's comparable "score" is the mean
-- BKT mastery over the learning objectives they have actually been assessed on
-- (opportunities_count > 0) - so a student is never penalised for content the
-- class has not reached yet. A student needs at least p_min_objectives
-- assessed objectives to be ranked; below that they are excluded from every
-- distribution (not treated as zero) and reported as "insufficient data".
--
-- Percentile is the mid-rank definition: (below + 0.5 x equal) / n x 100,
-- where "equal" includes the student themself.
-- ===========================================================================

-- 3a. One comparable score per student ---------------------------------------
CREATE OR REPLACE FUNCTION public.cohort_student_scores(
  p_school_id uuid,
  p_book_id bigint DEFAULT NULL,
  p_min_objectives int DEFAULT 5
)
RETURNS TABLE (student_id uuid, grade text, score numeric, assessed_objectives int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.grade, avg(sm.p_mastery)::numeric, count(*)::int
  FROM public.students s
  JOIN public.profiles p ON p.id = s.profile_id
  JOIN public.student_mastery sm ON sm.student_id = s.id AND sm.opportunities_count > 0
  JOIN public.learning_objectives lo ON lo.id = sm.learning_objective_id AND lo.status = 'active'
  JOIN public.subtopics st ON st.id = lo.subtopic_id
  JOIN public.topics t ON t.id = st.topic_id
  JOIN public.curriculum_chapters c ON c.id = t.chapter_id
  JOIN public.units u ON u.id = c.unit_id
  WHERE p.school_id IS NOT DISTINCT FROM p_school_id
    AND (p_book_id IS NULL OR u.book_id = p_book_id)
  GROUP BY s.id, s.grade
  HAVING count(*) >= GREATEST(p_min_objectives, 1);
$$;

-- 3b. One score per student per topic -----------------------------------------
CREATE OR REPLACE FUNCTION public.cohort_topic_scores(
  p_school_id uuid,
  p_book_id bigint DEFAULT NULL
)
RETURNS TABLE (student_id uuid, topic_id bigint, topic_name text, chapter_name text, score numeric, assessed_objectives int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, t.id, t.topic_name, c.chapter_name, avg(sm.p_mastery)::numeric, count(*)::int
  FROM public.students s
  JOIN public.profiles p ON p.id = s.profile_id
  JOIN public.student_mastery sm ON sm.student_id = s.id AND sm.opportunities_count > 0
  JOIN public.learning_objectives lo ON lo.id = sm.learning_objective_id AND lo.status = 'active'
  JOIN public.subtopics st ON st.id = lo.subtopic_id
  JOIN public.topics t ON t.id = st.topic_id
  JOIN public.curriculum_chapters c ON c.id = t.chapter_id
  JOIN public.units u ON u.id = c.unit_id
  WHERE p.school_id IS NOT DISTINCT FROM p_school_id
    AND (p_book_id IS NULL OR u.book_id = p_book_id)
  GROUP BY s.id, t.id, t.topic_name, c.chapter_name;
$$;

-- 3c. Student vs section / class / grade / school ------------------------------
CREATE OR REPLACE FUNCTION public.get_student_cohort_comparison(
  p_student_id uuid,
  p_book_id bigint DEFAULT NULL,
  p_min_objectives int DEFAULT 5
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT s.id AS student_id, s.grade, p.school_id
    FROM public.students s JOIN public.profiles p ON p.id = s.profile_id
    WHERE s.id = p_student_id
  ),
  my_class AS (
    SELECT c.id AS class_id, c.name, c.section
    FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id
    WHERE cs.student_id = p_student_id
    ORDER BY cs.assigned_at DESC LIMIT 1
  ),
  school_students AS (
    SELECT s.id AS student_id, s.grade
    FROM public.students s JOIN public.profiles p ON p.id = s.profile_id
    WHERE p.school_id IS NOT DISTINCT FROM (SELECT school_id FROM me)
  ),
  scores AS (
    SELECT * FROM public.cohort_student_scores((SELECT school_id FROM me), p_book_id, p_min_objectives)
  ),
  my_score AS (SELECT (SELECT score FROM scores WHERE student_id = p_student_id) AS score),
  members AS (
    SELECT 'section'::text AS lvl, (SELECT name || ' - ' || section FROM my_class) AS label, cs.student_id
    FROM public.class_students cs
    JOIN school_students ss ON ss.student_id = cs.student_id
    WHERE cs.class_id = (SELECT class_id FROM my_class)
    UNION ALL
    SELECT DISTINCT 'class', (SELECT name FROM my_class), cs.student_id
    FROM public.class_students cs
    JOIN public.classes c ON c.id = cs.class_id
    JOIN school_students ss ON ss.student_id = cs.student_id
    WHERE c.name = (SELECT name FROM my_class)
    UNION ALL
    SELECT 'grade', 'Grade ' || (SELECT grade FROM me), ss.student_id
    FROM school_students ss
    WHERE (SELECT grade FROM me) IS NOT NULL AND ss.grade = (SELECT grade FROM me)
    UNION ALL
    SELECT 'school', 'School', ss.student_id FROM school_students ss
  ),
  level_stats AS (
    SELECT
      m.lvl, m.label,
      count(*) AS roster_size,
      count(sc.student_id) AS n_scored,
      avg(sc.score) AS avg_score,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY sc.score) AS median_score,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY sc.score) AS p25,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY sc.score) AS p75,
      stddev_samp(sc.score) AS sd,
      min(sc.score) AS min_score, max(sc.score) AS max_score,
      count(*) FILTER (WHERE sc.score < (SELECT score FROM my_score)) AS below,
      count(*) FILTER (WHERE sc.score = (SELECT score FROM my_score)) AS equal_to,
      count(*) FILTER (WHERE sc.score > (SELECT score FROM my_score)) AS above
    FROM members m
    LEFT JOIN scores sc ON sc.student_id = m.student_id
    GROUP BY m.lvl, m.label
  ),
  level_json AS (
    SELECT lvl, jsonb_build_object(
      'label', label,
      'roster_size', roster_size,
      'compared_with', n_scored,
      'avg_pct', round((avg_score * 100)::numeric, 1),
      'median_pct', round((median_score * 100)::numeric, 1),
      'p25_pct', round((p25 * 100)::numeric, 1),
      'p75_pct', round((p75 * 100)::numeric, 1),
      'top_pct', round((max_score * 100)::numeric, 1),
      'gap_vs_avg_pts', CASE WHEN (SELECT score FROM my_score) IS NULL OR avg_score IS NULL THEN NULL
                             ELSE round((((SELECT score FROM my_score) - avg_score) * 100)::numeric, 1) END,
      'percentile', CASE WHEN (SELECT score FROM my_score) IS NULL OR n_scored < 2 THEN NULL
                         ELSE round((100.0 * (below + 0.5 * equal_to) / n_scored)::numeric, 1) END,
      'rank', CASE WHEN (SELECT score FROM my_score) IS NULL THEN NULL ELSE above + 1 END,
      'z_score', CASE WHEN (SELECT score FROM my_score) IS NULL OR sd IS NULL OR sd = 0 THEN NULL
                      ELSE round((((SELECT score FROM my_score) - avg_score) / sd)::numeric, 2) END
    ) AS j
    FROM level_stats
  ),
  topic_scores AS (SELECT * FROM public.cohort_topic_scores((SELECT school_id FROM me), p_book_id)),
  topic_cmp AS (
    SELECT
      mt.topic_id, mt.topic_name, mt.chapter_name, mt.score AS student_score,
      (SELECT CASE WHEN count(*) >= 3 THEN avg(ts.score) END FROM topic_scores ts
         WHERE ts.topic_id = mt.topic_id AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'section')) AS section_avg,
      (SELECT CASE WHEN count(*) >= 3 THEN avg(ts.score) END FROM topic_scores ts
         WHERE ts.topic_id = mt.topic_id AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'class')) AS class_avg,
      (SELECT CASE WHEN count(*) >= 3 THEN avg(ts.score) END FROM topic_scores ts
         WHERE ts.topic_id = mt.topic_id AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'grade')) AS grade_avg,
      (SELECT CASE WHEN count(*) >= 3 THEN avg(ts.score) END FROM topic_scores ts
         WHERE ts.topic_id = mt.topic_id AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'school')) AS school_avg
    FROM topic_scores mt
    WHERE mt.student_id = p_student_id
  ),
  topic_ref AS (
    SELECT *, COALESCE(section_avg, class_avg, grade_avg, school_avg) AS ref_avg,
           student_score - COALESCE(section_avg, class_avg, grade_avg, school_avg) AS gap
    FROM topic_cmp
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM me) THEN
    jsonb_build_object('error', 'student_not_found')
  ELSE jsonb_build_object(
    'student_id', p_student_id,
    'book_id', p_book_id,
    'min_objectives', p_min_objectives,
    'insufficient_data', (SELECT score FROM my_score) IS NULL,
    'student_score_pct', (SELECT round((score * 100)::numeric, 1) FROM my_score),
    'levels', COALESCE((SELECT jsonb_object_agg(lvl, j) FROM level_json), '{}'::jsonb),
    'topics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'topic_id', topic_id, 'topic_name', topic_name, 'chapter_name', chapter_name,
        'student_pct', round((student_score * 100)::numeric, 1),
        'section_avg_pct', round((section_avg * 100)::numeric, 1),
        'class_avg_pct', round((class_avg * 100)::numeric, 1),
        'grade_avg_pct', round((grade_avg * 100)::numeric, 1),
        'school_avg_pct', round((school_avg * 100)::numeric, 1),
        'gap_pts', round((gap * 100)::numeric, 1),
        'standing', CASE WHEN gap IS NULL THEN 'no_reference'
                         WHEN gap >= 0.05 THEN 'above' WHEN gap <= -0.05 THEN 'below' ELSE 'on_par' END
      ) ORDER BY gap ASC NULLS LAST)
      FROM topic_ref
    ), '[]'::jsonb)
  ) END;
$$;

-- 3d. A section vs its class-group / grade / school + roster patterns ----------
CREATE OR REPLACE FUNCTION public.get_class_cohort_intelligence(
  p_class_id uuid,
  p_book_id bigint DEFAULT NULL,
  p_min_objectives int DEFAULT 5
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cls AS (SELECT id AS class_id, name, section FROM public.classes WHERE id = p_class_id),
  roster AS (
    SELECT cs.student_id, s.grade, p.school_id, COALESCE(p.full_name, 'Student') AS student_name
    FROM public.class_students cs
    JOIN public.students s ON s.id = cs.student_id
    JOIN public.profiles p ON p.id = s.profile_id
    WHERE cs.class_id = p_class_id
  ),
  -- The school the section belongs to = the most common school on its roster.
  school AS (
    SELECT school_id FROM roster GROUP BY school_id ORDER BY count(*) DESC, school_id NULLS LAST LIMIT 1
  ),
  -- The grade the section belongs to = the most common grade on its roster.
  grade AS (
    SELECT grade FROM roster WHERE grade IS NOT NULL GROUP BY grade ORDER BY count(*) DESC, grade LIMIT 1
  ),
  school_students AS (
    SELECT s.id AS student_id, s.grade
    FROM public.students s JOIN public.profiles p ON p.id = s.profile_id
    WHERE p.school_id IS NOT DISTINCT FROM (SELECT school_id FROM school)
  ),
  scores AS (
    SELECT * FROM public.cohort_student_scores((SELECT school_id FROM school), p_book_id, p_min_objectives)
  ),
  members AS (
    SELECT 'section'::text AS lvl, student_id FROM roster
    UNION ALL
    SELECT DISTINCT 'class', cs.student_id
    FROM public.class_students cs
    JOIN public.classes c ON c.id = cs.class_id
    JOIN school_students ss ON ss.student_id = cs.student_id
    WHERE c.name = (SELECT name FROM cls)
    UNION ALL
    SELECT 'grade', ss.student_id FROM school_students ss
    WHERE (SELECT grade FROM grade) IS NOT NULL AND ss.grade = (SELECT grade FROM grade)
    UNION ALL
    SELECT 'school', student_id FROM school_students
  ),
  level_stats AS (
    SELECT m.lvl, count(*) AS roster_size, count(sc.student_id) AS n_scored,
           avg(sc.score) AS avg_score,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY sc.score) AS median_score
    FROM members m LEFT JOIN scores sc ON sc.student_id = m.student_id
    GROUP BY m.lvl
  ),
  sec_avg AS (SELECT avg_score FROM level_stats WHERE lvl = 'section'),
  cls_avg AS (SELECT avg_score FROM level_stats WHERE lvl = 'class'),
  grd_avg AS (SELECT avg_score FROM level_stats WHERE lvl = 'grade'),
  sch_avg AS (SELECT avg_score FROM level_stats WHERE lvl = 'school'),
  -- Every section in this class-group, so a principal can see which is ahead.
  sections AS (
    -- classes has no school_id, so a section only counts as part of THIS school
    -- if it has at least one student from it (inner joins drop other schools'
    -- same-named sections entirely rather than leaking their labels).
    SELECT c.id AS class_id, c.name || ' - ' || c.section AS label,
           count(ss.student_id) AS roster_size, count(sc.student_id) AS n_scored,
           avg(sc.score) AS avg_score
    FROM public.classes c
    JOIN public.class_students cs ON cs.class_id = c.id
    JOIN school_students ss ON ss.student_id = cs.student_id
    LEFT JOIN scores sc ON sc.student_id = cs.student_id
    WHERE c.name = (SELECT name FROM cls)
    GROUP BY c.id, c.name, c.section
  ),
  roster_scored AS (
    SELECT r.student_id, r.student_name, sc.score, sc.assessed_objectives,
      (SELECT count(*) FROM scores x JOIN members m ON m.student_id = x.student_id AND m.lvl = 'section' WHERE x.score < sc.score) AS sec_below,
      (SELECT count(*) FROM scores x JOIN members m ON m.student_id = x.student_id AND m.lvl = 'section' WHERE x.score = sc.score) AS sec_eq,
      (SELECT count(*) FROM scores x JOIN members m ON m.student_id = x.student_id AND m.lvl = 'section') AS sec_n,
      (SELECT count(*) FROM scores x JOIN members m ON m.student_id = x.student_id AND m.lvl = 'grade' WHERE x.score < sc.score) AS grd_below,
      (SELECT count(*) FROM scores x JOIN members m ON m.student_id = x.student_id AND m.lvl = 'grade' WHERE x.score = sc.score) AS grd_eq,
      (SELECT count(*) FROM scores x JOIN members m ON m.student_id = x.student_id AND m.lvl = 'grade') AS grd_n,
      (SELECT count(*) FROM scores x WHERE x.score < sc.score) AS sch_below,
      (SELECT count(*) FROM scores x WHERE x.score = sc.score) AS sch_eq,
      (SELECT count(*) FROM scores) AS sch_n
    FROM roster r
    LEFT JOIN scores sc ON sc.student_id = r.student_id
  ),
  roster_pat AS (
    SELECT rs.*,
      CASE WHEN sec_n >= 2 AND score IS NOT NULL THEN 100.0 * (sec_below + 0.5 * sec_eq) / sec_n END AS sec_pct,
      CASE WHEN grd_n >= 2 AND score IS NOT NULL THEN 100.0 * (grd_below + 0.5 * grd_eq) / grd_n END AS grd_pct,
      CASE WHEN sch_n >= 2 AND score IS NOT NULL THEN 100.0 * (sch_below + 0.5 * sch_eq) / sch_n END AS sch_pct,
      CASE
        WHEN score IS NULL THEN 'insufficient_data'
        WHEN score < (SELECT avg_score FROM sec_avg) AND score < (SELECT avg_score FROM grd_avg)
             AND score < (SELECT avg_score FROM sch_avg) THEN 'below_all_levels'
        WHEN score >= (SELECT avg_score FROM sec_avg) AND score >= (SELECT avg_score FROM grd_avg)
             AND score >= (SELECT avg_score FROM sch_avg) THEN 'above_all_levels'
        WHEN score >= (SELECT avg_score FROM sec_avg) AND score < (SELECT avg_score FROM grd_avg) THEN 'strong_in_section_weak_in_grade'
        WHEN score < (SELECT avg_score FROM sec_avg) AND score >= (SELECT avg_score FROM grd_avg) THEN 'weak_in_section_strong_in_grade'
        ELSE 'mixed'
      END AS pattern
    FROM roster_scored rs
  ),
  topic_scores AS (SELECT * FROM public.cohort_topic_scores((SELECT school_id FROM school), p_book_id)),
  topic_names AS (SELECT DISTINCT topic_id, topic_name, chapter_name FROM topic_scores),
  topic_cmp AS (
    SELECT tn.topic_id, tn.topic_name, tn.chapter_name,
      (SELECT CASE WHEN count(*) >= 3 THEN avg(ts.score) END FROM topic_scores ts
         WHERE ts.topic_id = tn.topic_id AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'section')) AS section_avg,
      (SELECT CASE WHEN count(*) >= 3 THEN avg(ts.score) END FROM topic_scores ts
         WHERE ts.topic_id = tn.topic_id AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'class')) AS class_avg,
      (SELECT CASE WHEN count(*) >= 3 THEN avg(ts.score) END FROM topic_scores ts
         WHERE ts.topic_id = tn.topic_id AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'grade')) AS grade_avg,
      (SELECT CASE WHEN count(*) >= 3 THEN avg(ts.score) END FROM topic_scores ts
         WHERE ts.topic_id = tn.topic_id AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'school')) AS school_avg,
      (SELECT count(*) FROM topic_scores ts WHERE ts.topic_id = tn.topic_id
         AND ts.student_id IN (SELECT student_id FROM members WHERE lvl = 'section')) AS section_students
    FROM topic_names tn
  ),
  topic_gap AS (
    SELECT *, section_avg - COALESCE(grade_avg, class_avg, school_avg) AS gap FROM topic_cmp
    WHERE section_avg IS NOT NULL
  ),
  histogram AS (
    SELECT b.band, b.lo, b.hi, count(sc.student_id) AS students
    FROM (VALUES ('0-20',0.0,0.2),('20-40',0.2,0.4),('40-60',0.4,0.6),('60-80',0.6,0.8),('80-100',0.8,1.0001)) AS b(band, lo, hi)
    LEFT JOIN (SELECT sc.student_id, sc.score FROM scores sc JOIN members m ON m.student_id = sc.student_id AND m.lvl = 'section') sc
           ON sc.score >= b.lo AND sc.score < b.hi
    GROUP BY b.band, b.lo, b.hi
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cls) THEN jsonb_build_object('error', 'class_not_found')
  ELSE jsonb_build_object(
    'class_id', p_class_id,
    'class_label', (SELECT name || ' - ' || section FROM cls),
    'grade', (SELECT grade FROM grade),
    'book_id', p_book_id,
    'min_objectives', p_min_objectives,
    'levels', COALESCE((
      SELECT jsonb_object_agg(lvl, jsonb_build_object(
        'roster_size', roster_size, 'compared_with', n_scored,
        'avg_pct', round((avg_score * 100)::numeric, 1), 'median_pct', round((median_score * 100)::numeric, 1)))
      FROM level_stats), '{}'::jsonb),
    'section_gap_vs_grade_pts', (SELECT CASE WHEN (SELECT avg_score FROM grd_avg) IS NULL OR (SELECT avg_score FROM sec_avg) IS NULL THEN NULL
        ELSE round((((SELECT avg_score FROM sec_avg) - (SELECT avg_score FROM grd_avg)) * 100)::numeric, 1) END),
    'section_gap_vs_school_pts', (SELECT CASE WHEN (SELECT avg_score FROM sch_avg) IS NULL OR (SELECT avg_score FROM sec_avg) IS NULL THEN NULL
        ELSE round((((SELECT avg_score FROM sec_avg) - (SELECT avg_score FROM sch_avg)) * 100)::numeric, 1) END),
    'sections_in_class', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'class_id', class_id, 'label', label, 'roster_size', roster_size, 'compared_with', n_scored,
        'avg_pct', round((avg_score * 100)::numeric, 1), 'is_this_section', class_id = p_class_id
      ) ORDER BY avg_score DESC NULLS LAST) FROM sections), '[]'::jsonb),
    'distribution', COALESCE((SELECT jsonb_agg(jsonb_build_object('band', band, 'students', students) ORDER BY lo) FROM histogram), '[]'::jsonb),
    'pattern_counts', COALESCE((SELECT jsonb_object_agg(pattern, n) FROM (SELECT pattern, count(*) AS n FROM roster_pat GROUP BY pattern) x), '{}'::jsonb),
    'students', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'student_id', student_id, 'name', student_name,
        'score_pct', round((score * 100)::numeric, 1), 'assessed_objectives', assessed_objectives,
        'section_percentile', round(sec_pct::numeric, 1), 'grade_percentile', round(grd_pct::numeric, 1),
        'school_percentile', round(sch_pct::numeric, 1),
        'gap_vs_section_pts', round(((score - (SELECT avg_score FROM sec_avg)) * 100)::numeric, 1),
        'gap_vs_grade_pts', round(((score - (SELECT avg_score FROM grd_avg)) * 100)::numeric, 1),
        'gap_vs_school_pts', round(((score - (SELECT avg_score FROM sch_avg)) * 100)::numeric, 1),
        'pattern', pattern
      ) ORDER BY score ASC NULLS LAST, student_name) FROM roster_pat), '[]'::jsonb),
    'topics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'topic_id', topic_id, 'topic_name', topic_name, 'chapter_name', chapter_name,
        'section_avg_pct', round((section_avg * 100)::numeric, 1),
        'class_avg_pct', round((class_avg * 100)::numeric, 1),
        'grade_avg_pct', round((grade_avg * 100)::numeric, 1),
        'school_avg_pct', round((school_avg * 100)::numeric, 1),
        'gap_pts', round((gap * 100)::numeric, 1),
        'section_students', section_students,
        'standing', CASE WHEN gap IS NULL THEN 'no_reference' WHEN gap >= 0.05 THEN 'above'
                         WHEN gap <= -0.05 THEN 'below' ELSE 'on_par' END
      ) ORDER BY gap ASC NULLS LAST) FROM topic_gap), '[]'::jsonb)
  ) END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Access. These functions read other students' data, so unlike the older
--    rollups they are NOT exposed to browser JWTs: the edge functions check
--    the caller's role/roster access and then call them with the service role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_exam_readiness(uuid, bigint, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_class_exam_readiness(uuid[], bigint, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cohort_student_scores(uuid, bigint, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cohort_topic_scores(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_student_cohort_comparison(uuid, bigint, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_class_cohort_intelligence(uuid, bigint, int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_exam_readiness(uuid, bigint, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_class_exam_readiness(uuid[], bigint, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.cohort_student_scores(uuid, bigint, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.cohort_topic_scores(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_student_cohort_comparison(uuid, bigint, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_class_cohort_intelligence(uuid, bigint, int) TO service_role;
