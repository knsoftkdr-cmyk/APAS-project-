-- Digital Consent Center (parents): one decision per parent + child + category, plus an automatic change history.
--
-- ADDITIVE ONLY: creates two new tables, one function and one trigger. Nothing existing is altered or dropped.
-- REVIEW BEFORE APPLYING: do not run this on the live database until the team lead has reviewed it.
--
-- Access rules
--   * A parent can read, add and change ONLY their own decisions, and only for a child linked in parent_students.
--   * Parents cannot delete decisions and cannot write the history table (a trigger writes it).
--   * A school admin can READ decisions of students in their own school (so the school can act on them).

CREATE TABLE IF NOT EXISTS public.parent_consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   uuid NOT NULL,
  student_id  uuid NOT NULL,
  category    text NOT NULL CHECK (category IN ('activities', 'photos', 'field_trips', 'data_use')),
  status      text NOT NULL CHECK (status IN ('granted', 'denied')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, student_id, category)
);

CREATE TABLE IF NOT EXISTS public.parent_consent_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   uuid NOT NULL,
  student_id  uuid NOT NULL,
  category    text NOT NULL,
  old_status  text NOT NULL,
  new_status  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parent_consents_student_idx ON public.parent_consents (student_id);
CREATE INDEX IF NOT EXISTS parent_consent_history_student_idx ON public.parent_consent_history (student_id, changed_at DESC);

ALTER TABLE public.parent_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_consent_history ENABLE ROW LEVEL SECURITY;

-- Parents: own rows, linked children only.
DROP POLICY IF EXISTS parent_consents_parent_select ON public.parent_consents;
CREATE POLICY parent_consents_parent_select ON public.parent_consents
  FOR SELECT TO authenticated
  USING (parent_id = auth.uid());

DROP POLICY IF EXISTS parent_consents_parent_insert ON public.parent_consents;
CREATE POLICY parent_consents_parent_insert ON public.parent_consents
  FOR INSERT TO authenticated
  WITH CHECK (
    parent_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.parent_students ps
      WHERE ps.parent_id = auth.uid() AND ps.student_id = parent_consents.student_id
    )
  );

DROP POLICY IF EXISTS parent_consents_parent_update ON public.parent_consents;
CREATE POLICY parent_consents_parent_update ON public.parent_consents
  FOR UPDATE TO authenticated
  USING (parent_id = auth.uid())
  WITH CHECK (
    parent_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.parent_students ps
      WHERE ps.parent_id = auth.uid() AND ps.student_id = parent_consents.student_id
    )
  );

-- School admins: read-only, own school only.
DROP POLICY IF EXISTS parent_consents_school_admin_select ON public.parent_consents;
CREATE POLICY parent_consents_school_admin_select ON public.parent_consents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles me
      JOIN public.profiles st ON st.id = parent_consents.student_id
      WHERE me.id = auth.uid() AND me.role = 'school_admin' AND me.school_id IS NOT NULL AND me.school_id = st.school_id
    )
  );

-- History: parents read their own; nobody writes from the client.
DROP POLICY IF EXISTS parent_consent_history_parent_select ON public.parent_consent_history;
CREATE POLICY parent_consent_history_parent_select ON public.parent_consent_history
  FOR SELECT TO authenticated
  USING (parent_id = auth.uid());

REVOKE ALL ON public.parent_consents FROM anon;
REVOKE ALL ON public.parent_consent_history FROM anon, authenticated;
GRANT SELECT ON public.parent_consent_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.parent_consents TO authenticated;

-- Trigger: record every real change. SECURITY DEFINER with a pinned search_path; clients cannot call it directly.
CREATE OR REPLACE FUNCTION public.log_parent_consent_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.parent_consent_history (parent_id, student_id, category, old_status, new_status)
    VALUES (NEW.parent_id, NEW.student_id, NEW.category, 'pending', NEW.status);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.parent_consent_history (parent_id, student_id, category, old_status, new_status)
    VALUES (NEW.parent_id, NEW.student_id, NEW.category, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_parent_consent_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS parent_consents_log_change ON public.parent_consents;
CREATE TRIGGER parent_consents_log_change
  AFTER INSERT OR UPDATE ON public.parent_consents
  FOR EACH ROW EXECUTE FUNCTION public.log_parent_consent_change();
