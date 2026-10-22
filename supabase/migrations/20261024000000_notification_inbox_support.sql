-- ============================================================================
-- Notification inbox support
--
-- Three small changes to the existing public.governance_notifications flow. NOTHING is dropped, no existing
-- column or RLS policy is changed, and no row is deleted. Safe to run more than once.
--
--   1. dismissed_at column  - lets a user dismiss a notification WITHOUT deleting it (soft dismiss). A real
--      DELETE is deliberately not allowed: other screens count rows in this table (e.g. the transport
--      executive dashboard counts vehicle_overspeed events), so deleting would change those numbers.
--      The existing "Users can update own notifications" policy already allows setting it.
--
--   2. Duplicate suppression - a BEFORE INSERT trigger that silently skips an INSERT when the SAME user already
--      has the same event (same event_type + reference_id + title + message) inside a short window.
--      It returns NULL for the duplicate row instead of raising, so a bulk insert of many users' rows never
--      fails because one of them is a duplicate. Window: 24h for attendance_marked (a teacher re-saving
--      attendance re-sent the same message to every parent), 10 minutes for everything else.
--
--   3. School-isolation fix  - the diagnostic-request triggers notified EVERY admin and school_admin on the whole
--      platform (SELECT id FROM profiles WHERE role IN ('admin','school_admin')), so a School A teacher's name,
--      class and subject were delivered into School B admins' inboxes. Recipients are now limited to the
--      teacher's own school (plus multi-school school_admins via school_admin_schools). Teachers with no school
--      (legacy single-tenant data) notify admins who also have no school, which matches the previous behaviour
--      for that data without reaching into any school.
--
-- RLS on governance_notifications is NOT changed: SELECT/UPDATE stay "user_id = auth.uid()" (own rows only).
-- ============================================================================

-- 1. soft dismiss -------------------------------------------------------------------------------------------------
ALTER TABLE public.governance_notifications
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

-- The inbox and the bell read "my notifications, newest first, not dismissed".
CREATE INDEX IF NOT EXISTS idx_gov_notifications_user_inbox
  ON public.governance_notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

-- Lookup used by the duplicate check below.
CREATE INDEX IF NOT EXISTS idx_gov_notifications_dedupe
  ON public.governance_notifications (user_id, event_type, created_at DESC);

-- 2. duplicate suppression ----------------------------------------------------------------------------------------
-- SECURITY DEFINER on purpose: the inserting user (e.g. a teacher notifying a parent) cannot SELECT the parent's rows
-- under RLS, so an invoker-rights check could never see an existing duplicate. The function only answers
-- "skip or insert"; it returns no data to the caller.
CREATE OR REPLACE FUNCTION public.governance_notifications_dedupe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window interval := CASE WHEN NEW.event_type = 'attendance_marked' THEN interval '24 hours' ELSE interval '10 minutes' END;
BEGIN
  -- Serialise concurrent identical inserts so two simultaneous writers cannot both pass the check.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.user_id::text || '|' || NEW.event_type || '|' || COALESCE(NEW.reference_id::text, '') || '|' || NEW.title || '|' || NEW.message, 0));

  IF EXISTS (
    SELECT 1 FROM public.governance_notifications g
    WHERE g.user_id = NEW.user_id
      AND g.event_type = NEW.event_type
      AND g.reference_id IS NOT DISTINCT FROM NEW.reference_id
      AND g.title = NEW.title
      AND g.message = NEW.message
      AND g.created_at > now() - v_window
  ) THEN
    RETURN NULL;   -- duplicate: skip this row only
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.governance_notifications_dedupe() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_governance_notifications_dedupe ON public.governance_notifications;
CREATE TRIGGER trg_governance_notifications_dedupe
  BEFORE INSERT ON public.governance_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.governance_notifications_dedupe();

-- 3. school-scoped recipients for the diagnostic-request triggers --------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_admin_recipients(p_school uuid)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id FROM public.profiles p
  WHERE p.role IN ('admin', 'school_admin')
    AND p.school_id IS NOT DISTINCT FROM p_school
  UNION
  SELECT sas.school_admin_id FROM public.school_admin_schools sas
  WHERE p_school IS NOT NULL AND sas.school_id = p_school;
$$;

REVOKE ALL ON FUNCTION public.school_admin_recipients(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_diagnostic_request_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  teacher_name text;
  v_school uuid;
  admin_record record;
BEGIN
  SELECT full_name, school_id INTO teacher_name, v_school FROM profiles WHERE id = NEW.teacher_id;

  FOR admin_record IN SELECT r.id FROM public.school_admin_recipients(v_school) r
  LOOP
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (
      admin_record.id,
      'diagnostic_request_submitted',
      'New Diagnostic Request',
      COALESCE(teacher_name, 'A teacher') || ' submitted a diagnostic request for ' || NEW.class_name || ' - ' || NEW.subject,
      NEW.id,
      'diagnostic_request'
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_diagnostic_request_decided()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_school uuid;
BEGIN
  SELECT school_id INTO v_school FROM profiles WHERE id = NEW.teacher_id;

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (
      NEW.teacher_id,
      'diagnostic_request_' || NEW.status,
      CASE WHEN NEW.status = 'approved' THEN 'Request Approved' ELSE 'Request Rejected' END,
      'Your diagnostic request for ' || NEW.class_name || ' - ' || NEW.subject ||
        CASE WHEN NEW.status = 'approved' THEN ' was approved with ' || COALESCE(NEW.approved_count::text, '0') || ' questions'
        ELSE ' was rejected. ' || COALESCE(NEW.admin_notes, '') END,
      NEW.id,
      'diagnostic_request'
    );
  END IF;

  IF OLD.status != 'assigned' AND NEW.status = 'assigned' THEN
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    SELECT
      r.id,
      'diagnostic_questions_assigned',
      'Questions Assigned',
      'Diagnostic questions for ' || NEW.class_name || ' - ' || NEW.subject || ' have been assigned to students',
      NEW.id,
      'diagnostic_request'
    FROM public.school_admin_recipients(v_school) r;
  END IF;

  IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (
      NEW.teacher_id,
      'diagnostic_completed',
      'Diagnostic Completed',
      'Diagnostic for ' || NEW.class_name || ' - ' || NEW.subject || ' has been completed. Results are ready for analysis.',
      NEW.id,
      'diagnostic_request'
    );
    INSERT INTO governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    SELECT
      r.id,
      'diagnostic_completed',
      'Diagnostic Completed',
      'Diagnostic for ' || NEW.class_name || ' - ' || NEW.subject || ' has been completed.',
      NEW.id,
      'diagnostic_request'
    FROM public.school_admin_recipients(v_school) r;
  END IF;

  RETURN NEW;
END;
$function$;
