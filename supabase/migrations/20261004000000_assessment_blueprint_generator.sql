-- ============================================================================
-- ASSESSMENT BLUEPRINT GENERATOR (Feature 22)
--
--   assessment_blueprints    a reusable exam TEMPLATE: syllabus weightage
--                            (marks per chapter/topic), Bloom's taxonomy mix,
--                            difficulty mix, and the question-type/marks
--                            scheme (e.g. "10 MCQ @1 mark + 2 descriptive
--                            @4 marks + 1 case-based @6 marks").
--   generated_assessment_papers        one concrete exam ASSEMBLED from a blueprint -
--                            actual items pulled from question_bank /
--                            question_bank_extended, plus a coverage report
--                            showing how closely the assembly hit its targets.
--   generated_assessment_paper_items   the selected questions for one paper, in order.
--
-- Deliberately pulls from BOTH item banks (question_bank for MCQ,
-- question_bank_extended for everything else) rather than introducing a
-- third pool - a real exam mixes formats, and both banks already carry the
-- quality/calibration signals (quality_flag, review_flag, distractor_flag,
-- calibration_status) the assembler should prefer.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Blueprint (template) - authored once, reused across papers/terms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  subject text,

  -- Syllabus weightage: which chapters/topics this exam draws from, and how
  -- much of the total marks each should carry.
  -- [{"scope_type":"chapter","scope_id":12,"label":"Light","weight_pct":40}, ...]
  -- weight_pct across all entries should sum to ~100 (validated in the edge
  -- function, not the DB, so a teacher can save an intentionally partial
  -- draft blueprint).
  syllabus_weightage jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(syllabus_weightage) = 'array'),

  total_marks numeric NOT NULL CHECK (total_marks > 0),
  duration_minutes int CHECK (duration_minutes > 0),

  -- {"remember":10,"understand":20,"apply":30,"analyze":20,"evaluate":10,"create":10}
  bloom_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"easy":30,"medium":50,"hard":20}
  difficulty_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{"question_type":"mcq","marks_per_item":1,"total_marks":10},
  --  {"question_type":"descriptive","marks_per_item":4,"total_marks":8}, ...]
  -- question_type "mcq" pulls from question_bank; any other value
  -- (descriptive/case_based/hots/scenario/competency) pulls from
  -- question_bank_extended filtered to that question_type.
  question_type_mix jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(question_type_mix) = 'array'),

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blueprints_status ON public.assessment_blueprints(status);

-- ---------------------------------------------------------------------------
-- 2. A concrete assembled paper
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_assessment_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid REFERENCES public.assessment_blueprints(id) ON DELETE SET NULL,
  title text NOT NULL,

  -- draft     = just assembled, a teacher can regenerate/swap items
  -- finalized = locked in, ready to administer
  -- archived  = no longer in use (kept for records)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','archived')),

  target_total_marks numeric NOT NULL,
  assembled_total_marks numeric NOT NULL,

  -- Transparency on how well the assembly hit the blueprint's targets:
  -- {"bloom":{"target":{...},"actual":{...}},
  --  "difficulty":{"target":{...},"actual":{...}},
  --  "syllabus":[{"label":"Light","target_marks":10,"actual_marks":9}],
  --  "match_score":0-100,
  --  "shortfalls":[{"question_type":"case_based","difficulty":"hard","chapter":"Light","needed":2,"found":0,"reason":"not enough active hard case-based items for this chapter"}]}
  coverage_report jsonb NOT NULL DEFAULT '{}'::jsonb,

  generated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_papers_blueprint ON public.generated_assessment_papers(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_papers_status ON public.generated_assessment_papers(status);

-- ---------------------------------------------------------------------------
-- 3. The selected items, one row per question on the paper
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_assessment_paper_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.generated_assessment_papers(id) ON DELETE CASCADE,

  mcq_item_id uuid REFERENCES public.question_bank(id) ON DELETE CASCADE,
  extended_item_id uuid REFERENCES public.question_bank_extended(id) ON DELETE CASCADE,
  CHECK (num_nonnulls(mcq_item_id, extended_item_id) = 1),

  section_label text,   -- e.g. "Section A - MCQs", grouped by question type at assembly time
  marks numeric NOT NULL CHECK (marks > 0),
  order_index int NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, mcq_item_id),
  UNIQUE (paper_id, extended_item_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_items_paper ON public.generated_assessment_paper_items(paper_id, order_index);

-- ---------------------------------------------------------------------------
-- 4. RLS - staff author/view; no student policy (papers aren't a
--    student-facing surface yet - that's a future "assign this paper" step)
-- ---------------------------------------------------------------------------
ALTER TABLE public.assessment_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_assessment_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_assessment_paper_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage assessment blueprints" ON public.assessment_blueprints;
CREATE POLICY "Staff manage assessment blueprints" ON public.assessment_blueprints FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Staff manage assessment papers" ON public.generated_assessment_papers;
CREATE POLICY "Staff manage assessment papers" ON public.generated_assessment_papers FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Staff manage assessment paper items" ON public.generated_assessment_paper_items;
CREATE POLICY "Staff manage assessment paper items" ON public.generated_assessment_paper_items FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));
