-- 20261008000000_dynamic_learning_groups.sql
--
-- Dynamic Student Grouping: persists each student's current remedial / regular / enrichment placement
-- (per class, optionally per subject/book) and an append-only history of moves.
--
-- Additive only: two new tables, no change to existing ones. All writes go through the existing
-- `get-class-mastery` edge function (mode "dynamic_groups", service role); clients get read-only
-- access, scoped to staff who may see the class. Students cannot read placements.
--
-- book_id = 0 means "all subjects" (kept NOT NULL so the UNIQUE constraint works without partial indexes).

CREATE TABLE IF NOT EXISTS public.student_learning_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      uuid   NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  book_id       bigint NOT NULL DEFAULT 0,
  student_id    uuid   NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  tier          text   NOT NULL CHECK (tier IN ('remedial', 'regular', 'enrichment')),
  previous_tier text   CHECK (previous_tier IS NULL OR previous_tier IN ('remedial', 'regular', 'enrichment')),
  composite     numeric CHECK (composite IS NULL OR composite BETWEEN 0 AND 1),
  reasons       jsonb  NOT NULL DEFAULT '[]'::jsonb,
  provisional   boolean NOT NULL DEFAULT false,
  pinned        boolean NOT NULL DEFAULT false,
  pinned_by     uuid,
  pinned_note   text,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  applied_by    uuid,
  UNIQUE (class_id, book_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_slg_class_book ON public.student_learning_groups (class_id, book_id);
CREATE INDEX IF NOT EXISTS idx_slg_student    ON public.student_learning_groups (student_id);

CREATE TABLE IF NOT EXISTS public.student_learning_group_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid   NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  book_id     bigint NOT NULL DEFAULT 0,
  student_id  uuid   NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  from_tier   text   CHECK (from_tier IS NULL OR from_tier IN ('remedial', 'regular', 'enrichment')),
  to_tier     text   NOT NULL CHECK (to_tier IN ('remedial', 'regular', 'enrichment')),
  composite   numeric CHECK (composite IS NULL OR composite BETWEEN 0 AND 1),
  source      text   NOT NULL CHECK (source IN ('auto', 'manual')),
  changed_by  uuid,
  note        text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slgh_class_book_time ON public.student_learning_group_history (class_id, book_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_slgh_student_time    ON public.student_learning_group_history (student_id, changed_at DESC);

ALTER TABLE public.student_learning_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_learning_group_history ENABLE ROW LEVEL SECURITY;

-- Read-only for staff. Admin-type roles see everything; a teacher only sees classes they are assigned to.
-- (Same visibility rule the edge function enforces; the function itself uses the service role.)
DROP POLICY IF EXISTS "Staff read learning groups" ON public.student_learning_groups;
CREATE POLICY "Staff read learning groups" ON public.student_learning_groups FOR SELECT
  USING (
    public.get_user_role(auth.uid()) IN ('admin', 'principal', 'hod', 'school_admin')
    OR (
      public.get_user_role(auth.uid()) = 'teacher'
      AND EXISTS (
        SELECT 1 FROM public.class_teachers ct
        WHERE ct.class_id = student_learning_groups.class_id AND ct.teacher_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Staff read learning group history" ON public.student_learning_group_history;
CREATE POLICY "Staff read learning group history" ON public.student_learning_group_history FOR SELECT
  USING (
    public.get_user_role(auth.uid()) IN ('admin', 'principal', 'hod', 'school_admin')
    OR (
      public.get_user_role(auth.uid()) = 'teacher'
      AND EXISTS (
        SELECT 1 FROM public.class_teachers ct
        WHERE ct.class_id = student_learning_group_history.class_id AND ct.teacher_id = auth.uid()
      )
    )
  );

GRANT SELECT ON public.student_learning_groups        TO authenticated;
GRANT SELECT ON public.student_learning_group_history TO authenticated;
GRANT ALL    ON public.student_learning_groups        TO service_role;
GRANT ALL    ON public.student_learning_group_history TO service_role;
