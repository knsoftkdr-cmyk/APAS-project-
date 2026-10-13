-- ============================================================================
-- my_school_classes(): the classes the signed-in staff member's school may see.
--
-- Why: `classes` is shared across schools (unique on name + section), and several
-- dashboards listed every row, so a principal saw other schools' "1 - A" and then got
-- "This class belongs to a different school" when opening it.
--
-- A class belongs to a school when:
--   * classes.school_id is set  -> it belongs to exactly that school (nothing else counts), or
--   * (older rows with no school_id) a student on its roster, a teacher assigned to it,
--     or the person who created it belongs to that school (profiles.school_id).
-- School admins who look after several schools (school_admin_schools) get all of them.
--
-- SECURITY DEFINER so it can read the roster tables, but it only ever returns rows for
-- the CALLER's own school(s); it takes no school argument that could be spoofed.
-- Safe to run more than once.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_school_classes()
RETURNS TABLE (id uuid, name text, section text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schools uuid[];
  v_has_school_col boolean;
  v_sql text;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT x.sid), '{}') INTO v_schools FROM (
    SELECT p.school_id AS sid FROM public.profiles p WHERE p.id = auth.uid() AND p.school_id IS NOT NULL
    UNION
    SELECT sas.school_id FROM public.school_admin_schools sas WHERE sas.school_admin_id = auth.uid()
  ) x;

  IF cardinality(v_schools) = 0 THEN
    RETURN;  -- no school on the profile: show nothing rather than everything
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'classes' AND column_name = 'school_id'
  ) INTO v_has_school_col;

  v_sql := $q$
    SELECT c.id, c.name, c.section
    FROM public.classes c
    WHERE (
      EXISTS (SELECT 1 FROM public.class_students cs
              JOIN public.students st ON st.id = cs.student_id
              JOIN public.profiles sp ON sp.id = st.profile_id
              WHERE cs.class_id = c.id AND sp.school_id = ANY($1))
      OR EXISTS (SELECT 1 FROM public.class_teachers ct
                 JOIN public.profiles tp ON tp.id = ct.teacher_id
                 WHERE ct.class_id = c.id AND tp.school_id = ANY($1))
      OR EXISTS (SELECT 1 FROM public.profiles cp
                 WHERE cp.id = c.created_by AND cp.school_id = ANY($1))
    )
    ORDER BY c.name, c.section
  $q$;

  IF v_has_school_col THEN
    v_sql := $q$
      SELECT c.id, c.name, c.section
      FROM public.classes c
      WHERE CASE
        WHEN c.school_id IS NOT NULL THEN c.school_id = ANY($1)
        ELSE (
          EXISTS (SELECT 1 FROM public.class_students cs
                  JOIN public.students st ON st.id = cs.student_id
                  JOIN public.profiles sp ON sp.id = st.profile_id
                  WHERE cs.class_id = c.id AND sp.school_id = ANY($1))
          OR EXISTS (SELECT 1 FROM public.class_teachers ct
                     JOIN public.profiles tp ON tp.id = ct.teacher_id
                     WHERE ct.class_id = c.id AND tp.school_id = ANY($1))
          OR EXISTS (SELECT 1 FROM public.profiles cp
                     WHERE cp.id = c.created_by AND cp.school_id = ANY($1))
        )
      END
      ORDER BY c.name, c.section
    $q$;
  END IF;

  RETURN QUERY EXECUTE v_sql USING v_schools;
END;
$$;

REVOKE ALL ON FUNCTION public.my_school_classes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_school_classes() TO authenticated;
