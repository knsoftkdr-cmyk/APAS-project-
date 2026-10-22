-- ============================================================================
-- Smart Universal Search
--
-- One read-only RPC, public.universal_search(), that powers the header search
-- dialog. It is ADDITIVE: no table, column, policy or existing function is
-- changed or dropped. Safe to run more than once.
--
-- SECURITY MODEL (read this before changing anything)
--   * SECURITY INVOKER (the default, stated explicitly): every table read below
--     still goes through the caller's Row Level Security. The function can only
--     ever return a SUBSET of what the caller could already SELECT. It does not
--     use SECURITY DEFINER for any table read.
--   * Existing RLS on students / profiles / lessons / paper assignments is NOT
--     school-scoped (e.g. "Teachers can read all students"). So RLS alone would
--     let a School A teacher discover School B records through search. This
--     function therefore ALSO filters every school-owned record to the CALLER'S
--     school(s), resolved here from auth.uid() -> profiles.school_id (plus
--     school_admin_schools for multi-school admins). The function takes NO
--     school id, role or user id argument, so nothing can be spoofed by the client.
--   * The role is read from profiles (never from the client or the JWT metadata).
--   * Only the platform admin (profiles.role = 'knsoft_admin') gets cross-school
--     data, and only the `schools` list - never student/teacher/homework rows.
--   * Output is limited to: category, record id, a title, a short subtitle and a
--     tiny meta object. No phone, e-mail, date of birth, parent details, medical
--     or SEN data is selected anywhere in this function.
--   * Not granted to anon.
--
-- Category access (enforced here AND by RLS):
--   students  teacher/hod: only students in classes they are assigned to
--             principal/admin/school_admin: students of their school(s)
--             parent: only their linked children (parent_students)
--             student: none
--   staff     principal/admin/school_admin: staff of their school(s); others: none
--   lessons   students: lessons assigned to them; staff: lessons assigned or
--             set as homework by someone in their school (lessons has no
--             school_id/creator column, so this is the only safe scoping)
--   exams     paper assignments: student -> their own; teacher/hod -> own or
--             for their classes; principal/admin/school_admin -> their school
--   homework  homework_assignments of the caller's school (RLS narrows further)
--   classes   my_school_classes() (existing school-scoped helper); teacher/hod
--             only classes they are assigned to
--   schools   knsoft_admin only
--
-- Depends on existing objects: profiles, students, classes, class_students,
-- class_teachers, lessons, lesson_assignments, homework_assignments,
-- generated_assessment_paper_assignments, generated_assessment_papers,
-- assessment_blueprints, schools, school_admin_schools, parent_students,
-- my_school_classes() (migration 20261010000000).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trigram indexes so ILIKE '%term%' does not scan whole tables.
--    pg_trgm is a standard, non-destructive extension. The operator class is
--    resolved dynamically because Supabase may install extensions outside the
--    default search_path. Each index is skipped if its table/column is missing.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
DECLARE
  v_ns text;
  r record;
BEGIN
  SELECT n.nspname INTO v_ns
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF v_ns IS NULL THEN
    RAISE NOTICE 'pg_trgm not available - skipping search indexes (search still works, just slower on big tables)';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('students',               'full_name', 'idx_trgm_students_full_name'),
      ('profiles',               'full_name', 'idx_trgm_profiles_full_name'),
      ('lessons',                'title',     'idx_trgm_lessons_title'),
      ('homework_assignments',   'title',     'idx_trgm_homework_title'),
      ('generated_assessment_paper_assignments', 'title', 'idx_trgm_paper_assign_title')
    ) AS t(tbl, col, idx)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (%I %I.gin_trgm_ops)',
        r.idx, r.tbl, r.col, v_ns
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The search function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.universal_search(
  p_query      text,
  p_categories text[] DEFAULT NULL,   -- NULL = every category the caller may search
  p_limit      int    DEFAULT 5       -- per category, clamped to 1..10
)
RETURNS TABLE (
  r_category text,
  r_id       text,
  r_title    text,
  r_subtitle text,
  r_meta     jsonb,
  r_rank     int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text;
  v_schools uuid[];
  v_q       text;
  v_lc      text;   -- lower-cased normalised query
  v_pat     text;   -- %escaped% for contains
  v_pre     text;   -- escaped% for prefix
  v_word    text;   -- % escaped% for word-start
  v_limit   int := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 10);
  v_staff   boolean;
  v_admin   boolean;   -- sees the whole school
  v_teach   boolean;   -- sees only assigned classes
  v_all     boolean := (p_categories IS NULL OR cardinality(p_categories) = 0);
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Normalise: trim, collapse runs of whitespace. Minimum 2 characters.
  v_q := btrim(regexp_replace(COALESCE(p_query, ''), '\s+', ' ', 'g'));
  IF char_length(v_q) < 2 OR char_length(v_q) > 80 THEN RETURN; END IF;
  v_lc := lower(v_q);

  -- Escape LIKE metacharacters so '%' and '_' typed by the user are literal.
  v_pat  := '%' || replace(replace(replace(v_lc, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_pre  := replace(replace(replace(v_lc, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_word := '% ' || replace(replace(replace(v_lc, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Identity + school scope come from the database, never from the client.
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = v_uid;
  IF v_role IS NULL THEN RETURN; END IF;

  SELECT COALESCE(array_agg(DISTINCT x.sid), '{}') INTO v_schools FROM (
    SELECT p.school_id AS sid FROM public.profiles p WHERE p.id = v_uid AND p.school_id IS NOT NULL
    UNION
    SELECT sas.school_id FROM public.school_admin_schools sas WHERE sas.school_admin_id = v_uid
  ) x;

  v_admin := v_role IN ('principal', 'admin', 'school_admin');
  v_teach := v_role IN ('teacher', 'hod');
  v_staff := v_admin OR v_teach;

  -- Platform admin: the school list only. Never other schools' people or records.
  IF v_role = 'knsoft_admin' THEN
    IF v_all OR 'schools' = ANY(p_categories) THEN
      RETURN QUERY
        SELECT 'schools'::text, s.id::text, s.name::text,
               NULLIF(btrim(COALESCE(s.address, '')), '')::text,
               '{}'::jsonb,
               CASE WHEN lower(s.name) = v_lc THEN 0
                    WHEN lower(s.name) LIKE v_pre  ESCAPE '\' THEN 1
                    WHEN lower(s.name) LIKE v_word ESCAPE '\' THEN 2 ELSE 3 END
        FROM public.schools s
        WHERE s.name ILIKE v_pat ESCAPE '\' OR s.address ILIKE v_pat ESCAPE '\'
        ORDER BY 6, s.name
        LIMIT v_limit;
    END IF;
    RETURN;
  END IF;

  -- Everyone else needs a school; with none, show nothing rather than everything.
  IF cardinality(v_schools) = 0 THEN RETURN; END IF;

  -- ------------------------------------------------------------------ students
  IF (v_all OR 'students' = ANY(p_categories)) AND (v_staff OR v_role = 'parent') THEN
    RETURN QUERY
      SELECT 'students'::text,
             s.id::text,
             COALESCE(NULLIF(btrim(s.full_name), ''), sp.full_name, 'Student')::text,
             NULLIF(btrim(
               CASE WHEN COALESCE(s.class, sp.class_grade) IS NOT NULL
                    THEN CASE WHEN btrim(COALESCE(s.class, sp.class_grade)) ~* '^(class|grade|std|standard)' THEN btrim(COALESCE(s.class, sp.class_grade))
                              WHEN btrim(COALESCE(s.class, sp.class_grade)) ~ '^[0-9]' THEN 'Class ' || btrim(COALESCE(s.class, sp.class_grade)) ELSE btrim(COALESCE(s.class, sp.class_grade)) END
                         || COALESCE(' - ' || NULLIF(COALESCE(s.section, ''), ''), '')
                    ELSE '' END
             ), '')::text,
             jsonb_build_object('roll_number', s.roll_number),
             CASE WHEN lower(COALESCE(NULLIF(btrim(s.full_name), ''), sp.full_name)) = v_lc
                    OR lower(COALESCE(s.roll_number, '')) = v_lc THEN 0
                  WHEN lower(COALESCE(NULLIF(btrim(s.full_name), ''), sp.full_name)) LIKE v_pre  ESCAPE '\' THEN 1
                  WHEN lower(COALESCE(NULLIF(btrim(s.full_name), ''), sp.full_name)) LIKE v_word ESCAPE '\' THEN 2
                  ELSE 3 END
      FROM public.students s
      LEFT JOIN public.profiles sp ON sp.id = s.profile_id
      WHERE COALESCE(s.school_id, sp.school_id) = ANY(v_schools)
        AND (s.full_name ILIKE v_pat ESCAPE '\'
             OR sp.full_name ILIKE v_pat ESCAPE '\'
             OR lower(COALESCE(s.roll_number, '')) = v_lc)
        AND (
          v_admin
          OR (v_teach AND EXISTS (
                SELECT 1 FROM public.class_teachers ct
                JOIN public.class_students cs ON cs.class_id = ct.class_id
                WHERE ct.teacher_id = v_uid AND cs.student_id = s.id))
          OR (v_role = 'parent' AND s.profile_id IN (
                SELECT ps.student_id FROM public.parent_students ps WHERE ps.parent_id = v_uid))
        )
      ORDER BY 6, 3
      LIMIT v_limit;
  END IF;

  -- -------------------------------------------------------------------- staff
  IF (v_all OR 'staff' = ANY(p_categories)) AND v_admin THEN
    RETURN QUERY
      SELECT 'staff'::text,
             p.id::text,
             COALESCE(NULLIF(btrim(p.full_name), ''), 'Staff member')::text,
             NULLIF(btrim(concat_ws(' · ', NULLIF(btrim(COALESCE(p.designation, '')), ''),
                                           NULLIF(btrim(COALESCE(p.department, '')), ''))), '')::text,
             jsonb_build_object('role', p.role),
             CASE WHEN lower(p.full_name) = v_lc THEN 0
                  WHEN lower(p.full_name) LIKE v_pre  ESCAPE '\' THEN 1
                  WHEN lower(p.full_name) LIKE v_word ESCAPE '\' THEN 2 ELSE 3 END
      FROM public.profiles p
      WHERE p.school_id = ANY(v_schools)
        AND p.role IN ('teacher', 'hod', 'principal', 'admin', 'school_admin')
        AND (p.full_name ILIKE v_pat ESCAPE '\'
             OR p.designation ILIKE v_pat ESCAPE '\'
             OR p.department ILIKE v_pat ESCAPE '\')
      ORDER BY 6, 3
      LIMIT v_limit;
  END IF;

  -- ------------------------------------------------------------------ lessons
  IF (v_all OR 'lessons' = ANY(p_categories)) AND (v_staff OR v_role = 'student') THEN
    RETURN QUERY
      SELECT 'lessons'::text,
             l.id::text,
             l.title::text,
             NULLIF(btrim(concat_ws(' · ', NULLIF(btrim(COALESCE(l.subject, '')), ''),
                                           NULLIF(btrim(COALESCE(l.curriculum, '')), ''))), '')::text,
             '{}'::jsonb,
             CASE WHEN lower(l.title) = v_lc THEN 0
                  WHEN lower(l.title) LIKE v_pre  ESCAPE '\' THEN 1
                  WHEN lower(l.title) LIKE v_word ESCAPE '\' THEN 2 ELSE 3 END
      FROM public.lessons l
      WHERE (l.title ILIKE v_pat ESCAPE '\' OR l.subject ILIKE v_pat ESCAPE '\')
        AND (
          (v_role = 'student' AND EXISTS (
              SELECT 1 FROM public.lesson_assignments la
              JOIN public.students st ON st.id = la.student_id
              WHERE la.lesson_id = l.id AND st.profile_id = v_uid))
          OR (v_staff AND (
              EXISTS (SELECT 1 FROM public.lesson_assignments la
                      JOIN public.profiles ap ON ap.id = la.assigned_by
                      WHERE la.lesson_id = l.id AND ap.school_id = ANY(v_schools))
              OR EXISTS (SELECT 1 FROM public.homework_assignments h
                         JOIN public.profiles hp ON hp.id = h.assigned_by
                         WHERE h.lesson_id = l.id AND hp.school_id = ANY(v_schools))))
        )
      ORDER BY 6, 3
      LIMIT v_limit;
  END IF;

  -- -------------------------------------------------------------------- exams
  IF (v_all OR 'exams' = ANY(p_categories)) AND (v_staff OR v_role = 'student') THEN
    RETURN QUERY
      SELECT 'exams'::text,
             a.id::text,
             a.title::text,
             NULLIF(btrim(concat_ws(' · ',
                 NULLIF(btrim(COALESCE(bp.subject, '')), ''),
                 CASE WHEN c.id IS NOT NULL THEN (CASE WHEN btrim(c.name) ~* '^(class|grade|std|standard)' THEN btrim(c.name) WHEN btrim(c.name) ~ '^[0-9]' THEN 'Class ' || btrim(c.name) ELSE btrim(c.name) END || '-' || c.section) END,
                 CASE WHEN a.due_at IS NOT NULL THEN 'Due ' || to_char(a.due_at, 'DD Mon YYYY') END)), '')::text,
             jsonb_build_object('status', a.status, 'due_at', a.due_at),
             CASE WHEN lower(a.title) = v_lc THEN 0
                  WHEN lower(a.title) LIKE v_pre  ESCAPE '\' THEN 1
                  WHEN lower(a.title) LIKE v_word ESCAPE '\' THEN 2 ELSE 3 END
      FROM public.generated_assessment_paper_assignments a
      LEFT JOIN public.classes c ON c.id = a.class_id
      LEFT JOIN public.generated_assessment_papers gp ON gp.id = a.paper_id
      LEFT JOIN public.assessment_blueprints bp ON bp.id = gp.blueprint_id
      WHERE (a.title ILIKE v_pat ESCAPE '\' OR bp.subject ILIKE v_pat ESCAPE '\')
        AND (
          (v_role = 'student' AND a.status = 'active' AND (
              a.class_id IN (SELECT cs.class_id FROM public.class_students cs
                             JOIN public.students st ON st.id = cs.student_id
                             WHERE st.profile_id = v_uid)
              OR a.student_ids ? (SELECT st.id::text FROM public.students st
                                  WHERE st.profile_id = v_uid LIMIT 1)))
          OR (v_staff
              AND EXISTS (SELECT 1 FROM public.profiles ap
                          WHERE ap.id = a.assigned_by AND ap.school_id = ANY(v_schools))
              AND (v_admin
                   OR a.assigned_by = v_uid
                   OR a.class_id IN (SELECT ct.class_id FROM public.class_teachers ct
                                     WHERE ct.teacher_id = v_uid)))
        )
      ORDER BY 6, 3
      LIMIT v_limit;
  END IF;

  -- ----------------------------------------------------------------- homework
  IF (v_all OR 'homework' = ANY(p_categories)) AND (v_staff OR v_role = 'student') THEN
    RETURN QUERY
      SELECT 'homework'::text,
             h.id::text,
             h.title::text,
             NULLIF(btrim(concat_ws(' · ',
                 NULLIF(btrim(COALESCE(h.subject, '')), ''),
                 (CASE WHEN btrim(h.class_level) ~* '^(class|grade|std|standard)' THEN btrim(h.class_level) WHEN btrim(h.class_level) ~ '^[0-9]' THEN 'Class ' || btrim(h.class_level) ELSE btrim(h.class_level) END || '-' || h.section))), '')::text,
             jsonb_build_object('assigned_at', COALESCE(h.assigned_at, h.created_at)),
             CASE WHEN lower(h.title) = v_lc THEN 0
                  WHEN lower(h.title) LIKE v_pre  ESCAPE '\' THEN 1
                  WHEN lower(h.title) LIKE v_word ESCAPE '\' THEN 2 ELSE 3 END
      FROM public.homework_assignments h
      WHERE (h.title ILIKE v_pat ESCAPE '\'
             OR h.subject ILIKE v_pat ESCAPE '\'
             OR h.topic ILIKE v_pat ESCAPE '\')
        -- Students cannot read teachers' profile rows under RLS, and RLS already
        -- limits them to homework for their own class, so the school check
        -- below applies to staff only.
        AND (v_role = 'student'
             OR EXISTS (SELECT 1 FROM public.profiles hp
                        WHERE hp.id = h.assigned_by AND hp.school_id = ANY(v_schools)))
        AND (v_admin OR v_role = 'student' OR h.assigned_by = v_uid)
      ORDER BY 6, 3
      LIMIT v_limit;
  END IF;

  -- ------------------------------------------------------------------ classes
  IF (v_all OR 'classes' = ANY(p_categories)) AND v_staff THEN
    RETURN QUERY
      SELECT 'classes'::text,
             mc.id::text,
             (CASE WHEN btrim(mc.name) ~* '^(class|grade|std|standard)' THEN btrim(mc.name) WHEN btrim(mc.name) ~ '^[0-9]' THEN 'Class ' || btrim(mc.name) ELSE btrim(mc.name) END || ' - ' || mc.section)::text,
             NULL::text,
             '{}'::jsonb,
             CASE WHEN lower(mc.name || ' ' || mc.section) = v_lc
                    OR lower(mc.name || '-' || mc.section) = v_lc
                    OR lower(mc.name || mc.section) = v_lc THEN 0
                  WHEN lower(mc.name) = v_lc THEN 1 ELSE 3 END
      FROM public.my_school_classes() mc
      WHERE (lower(mc.name || ' ' || mc.section) LIKE v_pat ESCAPE '\'
             OR lower(mc.name || '-' || mc.section) LIKE v_pat ESCAPE '\'
             OR lower(mc.name || mc.section) LIKE v_pat ESCAPE '\'
             OR lower('class ' || mc.name) LIKE v_pat ESCAPE '\')
        AND (v_admin OR EXISTS (SELECT 1 FROM public.class_teachers ct
                                WHERE ct.class_id = mc.id AND ct.teacher_id = v_uid))
      ORDER BY 6, mc.name, mc.section
      LIMIT v_limit;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.universal_search(text, text[], int) IS
  'Header universal search. SECURITY INVOKER: RLS still applies; additionally scoped to the caller''s school(s) derived from auth.uid(). No client-supplied identity.';

REVOKE ALL ON FUNCTION public.universal_search(text, text[], int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.universal_search(text, text[], int) FROM anon;
GRANT EXECUTE ON FUNCTION public.universal_search(text, text[], int) TO authenticated;
