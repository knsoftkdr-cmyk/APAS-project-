-- ============================================================================
-- Calendar: exam/homework feed, automatic reminders, reschedule/cancel notices
--
-- Adds ONLY what was missing. Nothing is dropped and no existing table, column, policy or function is changed.
-- Safe to run more than once.
--
--   1. get_calendar_feed()      - read-only, role-scoped list of exam dates (exam_schedules) and homework deadlines
--                                 (homework_assignments.due_date) for the signed-in user. The calendar page merges it with
--                                 academic_calendar_events. SECURITY DEFINER because students/parents may not be able to
--                                 SELECT those tables directly; it derives the caller from auth.uid() and returns only what
--                                 that person's role/class/children/school make relevant.
--   2. calendar_run_reminders() - the scheduler body. Finds holidays, school events, exams and homework deadlines that are
--                                 coming up and writes ONE in-app notification per recipient into the existing
--                                 governance_notifications table (the bell/inbox and its realtime channel already show it).
--   3. calendar_reminder_log    - remembers what was sent so a reminder is never sent twice. The key includes the
--                                 date it was for, so moving an event re-arms its reminders for the NEW date.
--   4. Triggers                 - on academic_calendar_events, exam_schedules and homework_assignments: a date change sends a
--                                 "rescheduled" notice and a delete sends a "cancelled" notice to the same relevant people.
--                                 Reminders for a deleted or moved item stop by themselves (they are computed from live rows).
--   5. pg_cron job              - runs calendar_run_reminders() hourly, inside the database (no HTTP call, no secret, no
--                                 edge function). pg_cron is already enabled by migration 20260411130715_*.
--
-- Optional configuration (default is Asia/Kolkata):
--   ALTER DATABASE postgres SET app.settings.school_timezone = 'Asia/Kolkata';
-- Test by hand:  SELECT public.calendar_run_reminders();
-- ============================================================================

-- ---------------------------------------------------------------------------------------------------------------------
-- Settings / small pure helpers
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_tz()
RETURNS text LANGUAGE sql STABLE
AS $$ SELECT COALESCE(NULLIF(current_setting('app.settings.school_timezone', true), ''), 'Asia/Kolkata') $$;

-- "Class 5", "class 5 ", "5" -> "5"
CREATE OR REPLACE FUNCTION public.calendar_norm_class(p text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT regexp_replace(lower(btrim(regexp_replace(COALESCE(p, ''), '^\s*class\s*', '', 'i'))), '[\s-]', '', 'g') $$;

-- Does an exam class label ("Class 5", "5", "5A") name this grade/section?
CREATE OR REPLACE FUNCTION public.calendar_class_matches(p_label text, p_grade text, p_section text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT public.calendar_norm_class(p_label) <> ''
     AND public.calendar_norm_class(p_grade) <> ''
     AND (public.calendar_norm_class(p_label) = public.calendar_norm_class(p_grade)
          OR public.calendar_norm_class(p_label) = public.calendar_norm_class(p_grade) || lower(btrim(COALESCE(p_section, ''))))
$$;

-- Is a student (grade/section) in the audience of an item?
--   holiday / event : everyone in the school
--   exam            : school-wide when no classes are listed (a calendar "exam" marker), else the listed classes
--   homework        : the class level, and the section when the assignment names one
CREATE OR REPLACE FUNCTION public.calendar_student_in_scope(
  p_grade text, p_section text, p_kind text, p_classes text[], p_class_level text, p_hw_section text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_kind IN ('holiday', 'event') THEN RETURN true; END IF;
  IF p_kind = 'exam' THEN
    IF p_classes IS NULL THEN RETURN true; END IF;
    RETURN EXISTS (SELECT 1 FROM unnest(p_classes) x WHERE public.calendar_class_matches(x, p_grade, p_section));
  END IF;
  IF p_kind = 'homework' THEN
    RETURN public.calendar_norm_class(p_grade) <> ''
       AND public.calendar_norm_class(p_class_level) = public.calendar_norm_class(p_grade)
       AND (p_hw_section IS NULL OR btrim(p_hw_section) = ''
            OR upper(btrim(p_hw_section)) = upper(btrim(COALESCE(p_section, ''))));
  END IF;
  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Who should hear about an item? Single source of truth for reminders AND change notices.
-- Always limited to the item's own school. Parents are returned per child for exams/homework.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_recipients(
  p_kind text, p_school uuid, p_classes text[], p_class_level text, p_section text, p_owner uuid)
RETURNS TABLE (recipient_id uuid, recipient_role text, child_id uuid, child_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_school IS NULL THEN RETURN; END IF;

  -- students
  RETURN QUERY
  SELECT s.id, 'student'::text, NULL::uuid, NULL::text
  FROM public.profiles s
  WHERE s.role = 'student' AND s.school_id = p_school
    AND public.calendar_student_in_scope(s.class_grade, s.section, p_kind, p_classes, p_class_level, p_section);

  -- parents
  IF p_kind IN ('holiday', 'event') THEN
    RETURN QUERY
    SELECT par.id, 'parent'::text, NULL::uuid, NULL::text
    FROM public.profiles par WHERE par.role = 'parent' AND par.school_id = p_school;
  ELSE
    RETURN QUERY
    SELECT ps.parent_id, 'parent'::text, s.id, s.full_name
    FROM public.profiles s
    JOIN public.parent_students ps ON ps.student_id = s.id
    JOIN public.profiles par ON par.id = ps.parent_id AND par.school_id IS NOT DISTINCT FROM p_school
    WHERE s.role = 'student' AND s.school_id = p_school
      AND public.calendar_student_in_scope(s.class_grade, s.section, p_kind, p_classes, p_class_level, p_section);
  END IF;

  -- teaching staff
  IF p_kind IN ('holiday', 'event') THEN
    RETURN QUERY
    SELECT t.id, t.role::text, NULL::uuid, NULL::text
    FROM public.profiles t WHERE t.role IN ('teacher', 'hod') AND t.school_id = p_school;
  ELSIF p_kind = 'exam' THEN
    RETURN QUERY
    SELECT t.id, t.role::text, NULL::uuid, NULL::text
    FROM public.profiles t
    WHERE t.school_id = p_school
      AND (t.role = 'hod'
           OR (t.role = 'teacher' AND (
                 p_classes IS NULL
                 OR EXISTS (
                      SELECT 1 FROM public.class_teachers ct
                      JOIN public.classes c ON c.id = ct.class_id
                      WHERE ct.teacher_id = t.id
                        AND EXISTS (SELECT 1 FROM unnest(p_classes) x WHERE public.calendar_class_matches(x, c.name, c.section))))));
  ELSIF p_kind = 'homework' THEN
    RETURN QUERY
    SELECT t.id, t.role::text, NULL::uuid, NULL::text
    FROM public.profiles t WHERE t.id = p_owner AND t.school_id = p_school;
  END IF;

  -- school leadership: holidays, events and exams (homework is class-level detail, so not sent to them)
  IF p_kind IN ('holiday', 'event', 'exam') THEN
    RETURN QUERY
    SELECT a.id, a.role::text, NULL::uuid, NULL::text
    FROM public.profiles a WHERE a.role IN ('admin', 'principal', 'school_admin') AND a.school_id = p_school
    UNION
    SELECT sas.school_admin_id, 'school_admin'::text, NULL::uuid, NULL::text
    FROM public.school_admin_schools sas WHERE sas.school_id = p_school;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_recipients(text, uuid, text[], text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Reminder log (de-duplication memory). RLS on, no policies: only the SECURITY DEFINER functions touch it.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_reminder_log (
  id          bigserial PRIMARY KEY,
  source_type text NOT NULL,          -- calendar_event | exam_schedule | homework
  source_id   uuid NOT NULL,
  tier        text NOT NULL,          -- 3d | 1d | 0d
  occurrence  text NOT NULL,          -- the date/time the reminder was FOR; a new date means a new reminder
  recipient_id uuid NOT NULL,
  subject_id  uuid,                   -- the child, when the recipient is a parent
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_reminder_log
  ON public.calendar_reminder_log (source_type, source_id, tier, occurrence, recipient_id,
                                   COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_calendar_reminder_log_sent ON public.calendar_reminder_log (sent_at);

ALTER TABLE public.calendar_reminder_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_reminder_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The scheduler body
--   holiday / school event : 1 day before, 08:00 local
--   exam                   : 3 days before and 1 day before, 08:00 local
--   homework deadline      : the afternoon before (16:00 local) and, if due after 10:00, the morning of (07:00 local)
-- Only the most recent reminder time that has already passed is considered, so a late-created item sends ONE reminder
-- (worded from the real remaining time) and never a stale "3 days" one. Items that have already started are skipped.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_run_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tz    text := public.calendar_tz();
  v_now   timestamptz := now();
  v_today date := (now() AT TIME ZONE public.calendar_tz())::date;
  v_total integer := 0;
  v_n     integer;
  r       record;
  v_when  text;
  v_title text;
  v_msg   text;
  v_date  text;
BEGIN
  -- never let two runs overlap (a slow run + the next cron tick)
  IF NOT pg_try_advisory_xact_lock(hashtextextended('calendar_run_reminders', 0)) THEN RETURN 0; END IF;

  FOR r IN
    WITH items AS (
      -- holidays, school events, and "exam" markers added directly on the calendar
      SELECT 'calendar_event'::text AS source_type, e.id AS source_id, e.school_id,
             CASE e.event_type WHEN 'holiday' THEN 'holiday' WHEN 'exam' THEN 'exam' ELSE 'event' END AS kind,
             e.title::text AS title, NULL::text AS subject, NULL::text AS detail,
             NULL::text[] AS classes, NULL::text AS class_level, NULL::text AS section, NULL::uuid AS owner_id,
             (e.start_date::date::timestamp AT TIME ZONE v_tz) AS starts_at,
             e.start_date::date AS local_date,
             NULL::text AS time_txt,
             CASE WHEN e.end_date::date > e.start_date::date
                  THEN to_char(e.start_date::date, 'FMDD Mon') || ' – ' || to_char(e.end_date::date, 'FMDD Mon') END AS range_txt,
             e.start_date::text AS occurrence_key
      FROM public.academic_calendar_events e
      WHERE e.event_type IN ('holiday', 'exam', 'event') AND e.school_id IS NOT NULL
        AND e.start_date::date >= v_today

      UNION ALL
      -- scheduled exams
      SELECT 'exam_schedule', es.id, es.school_id, 'exam',
             es.subject::text, es.subject::text, NULL::text,
             es.classes, NULL::text, NULL::text, NULL::uuid,
             ((es.exam_date::date + COALESCE(es.start_time::time, time '00:00')) AT TIME ZONE v_tz),
             es.exam_date::date,
             CASE WHEN es.start_time IS NOT NULL
                  THEN to_char(es.start_time::time, 'FMHH12:MI AM')
                       || COALESCE(' – ' || to_char(es.end_time::time, 'FMHH12:MI AM'), '') END,
             NULL::text,
             es.exam_date::text || ' ' || COALESCE(es.start_time::text, '')
      FROM public.exam_schedules es
      WHERE es.school_id IS NOT NULL AND es.exam_date::date >= v_today

      UNION ALL
      -- homework deadlines (school comes from the assigning teacher; the table has no school_id)
      SELECT 'homework', h.id, t.school_id, 'homework',
             COALESCE(NULLIF(h.subject, ''), 'Homework')::text, h.subject::text,
             COALESCE(NULLIF(h.topic, ''), NULLIF(h.period_title, ''))::text,
             NULL::text[], h.class_level::text, h.section::text, h.teacher_id,
             h.due_date,
             (h.due_date AT TIME ZONE v_tz)::date,
             to_char(h.due_date AT TIME ZONE v_tz, 'FMHH12:MI AM'),
             NULL::text,
             h.due_date::text
      FROM public.homework_assignments h
      JOIN public.profiles t ON t.id = h.teacher_id
      WHERE h.due_date IS NOT NULL AND t.school_id IS NOT NULL AND h.due_date > v_now
    ),
    tiers AS (
      SELECT i.*, '1d'::text AS tier,
             (((i.local_date - 1)::timestamp + time '08:00') AT TIME ZONE v_tz) AS fire_at
      FROM items i WHERE i.kind IN ('holiday', 'event', 'exam')
      UNION ALL
      SELECT i.*, '3d', (((i.local_date - 3)::timestamp + time '08:00') AT TIME ZONE v_tz)
      FROM items i WHERE i.kind = 'exam'
      UNION ALL
      SELECT i.*, '1d', (((i.local_date - 1)::timestamp + time '16:00') AT TIME ZONE v_tz)
      FROM items i WHERE i.kind = 'homework'
      UNION ALL
      SELECT i.*, '0d', ((i.local_date::timestamp + time '07:00') AT TIME ZONE v_tz)
      FROM items i WHERE i.kind = 'homework' AND ((i.starts_at AT TIME ZONE v_tz)::time) >= time '10:00'
    )
    SELECT DISTINCT ON (source_type, source_id, occurrence_key) *
    FROM tiers
    WHERE fire_at <= v_now AND starts_at > v_now
    ORDER BY source_type, source_id, occurrence_key, fire_at DESC
  LOOP
    v_when := CASE WHEN r.local_date = v_today THEN 'today'
                   WHEN r.local_date = v_today + 1 THEN 'tomorrow'
                   ELSE 'in ' || (r.local_date - v_today) || ' days' END;
    v_date := to_char(r.local_date, 'FMDy, FMDD Mon');

    IF r.kind = 'exam' THEN
      v_title := 'Exam ' || v_when || ': ' || r.title;
      v_msg   := r.title || ' exam is ' || v_when || ' (' || v_date || COALESCE(', ' || r.time_txt, '') || ').';
    ELSIF r.kind = 'homework' THEN
      v_title := 'Homework due ' || v_when || ': ' || r.title;
      v_msg   := r.title || COALESCE(' – ' || r.detail, '') || ' is due ' || v_when
                 || ' (' || v_date || ', ' || r.time_txt || ').';
    ELSIF r.kind = 'holiday' THEN
      v_title := 'Holiday ' || v_when || ': ' || r.title;
      v_msg   := r.title || ' – ' || COALESCE(r.range_txt, v_date) || '.';
    ELSE
      v_title := 'Upcoming ' || v_when || ': ' || r.title;
      v_msg   := r.title || ' – ' || COALESCE(r.range_txt, v_date) || '.';
    END IF;

    WITH rec AS (
      SELECT * FROM public.calendar_recipients(r.kind, r.school_id, r.classes, r.class_level, r.section, r.owner_id)
    ),
    claimed AS (
      -- the unique index decides who has not been reminded yet; losers (already sent) are silently skipped
      INSERT INTO public.calendar_reminder_log (source_type, source_id, tier, occurrence, recipient_id, subject_id)
      SELECT DISTINCT r.source_type, r.source_id, r.tier, r.occurrence_key, rec.recipient_id, rec.child_id FROM rec
      ON CONFLICT DO NOTHING
      RETURNING recipient_id, subject_id
    )
    INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type, channel)
    SELECT c.recipient_id,
           'calendar_reminder_' || r.kind,
           v_title,
           CASE WHEN rc.child_name IS NOT NULL THEN 'For ' || rc.child_name || ': ' || v_msg ELSE v_msg END,
           r.source_id, r.source_type, 'in_app'
    FROM claimed c
    LEFT JOIN (SELECT DISTINCT recipient_id, child_id, child_name FROM rec) rc
           ON rc.recipient_id = c.recipient_id AND rc.child_id IS NOT DISTINCT FROM c.subject_id;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;

  -- the log only needs to outlive the reminder window
  DELETE FROM public.calendar_reminder_log WHERE sent_at < now() - interval '120 days';
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_run_reminders() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Reschedule / cancel notices (same audience as the reminders)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calendar_notify_change(
  p_source_type text, p_source_id uuid, p_kind text, p_school uuid, p_classes text[], p_class_level text,
  p_section text, p_owner uuid, p_label text, p_change text, p_old_txt text, p_new_txt text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_noun  text := CASE p_kind WHEN 'exam' THEN 'Exam' WHEN 'homework' THEN 'Homework' WHEN 'holiday' THEN 'Holiday' ELSE 'Event' END;
  v_title text;
  v_msg   text;
BEGIN
  IF p_school IS NULL THEN RETURN; END IF;
  IF p_change = 'cancelled' THEN
    v_title := v_noun || ' cancelled: ' || p_label;
    v_msg   := p_label || ' (scheduled for ' || p_old_txt || ') has been cancelled.';
  ELSE
    v_title := v_noun || CASE WHEN p_kind = 'homework' THEN ' deadline changed: ' ELSE ' rescheduled: ' END || p_label;
    v_msg   := p_label || ' is now ' || p_new_txt || ' (was ' || p_old_txt || ').';
  END IF;

  INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type, channel)
  SELECT DISTINCT rec.recipient_id,
         'calendar_change_' || p_kind,
         v_title,
         CASE WHEN rec.child_name IS NOT NULL THEN 'For ' || rec.child_name || ': ' || v_msg ELSE v_msg END,
         p_source_id, p_source_type, 'in_app'
  FROM public.calendar_recipients(p_kind, p_school, p_classes, p_class_level, p_section, p_owner) rec;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_notify_change(text, uuid, text, uuid, text[], text, text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.calendar_fmt_date(p date) RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(p, 'FMDy, FMDD Mon YYYY') $$;

-- academic_calendar_events ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_calendar_event_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE public.calendar_tz())::date;
  v_kind  text;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_kind := CASE OLD.event_type WHEN 'holiday' THEN 'holiday' WHEN 'exam' THEN 'exam' WHEN 'event' THEN 'event' END;
      IF v_kind IS NOT NULL AND OLD.start_date::date >= v_today THEN
        PERFORM public.calendar_notify_change('calendar_event', OLD.id, v_kind, OLD.school_id, NULL, NULL, NULL, NULL,
                  OLD.title, 'cancelled', public.calendar_fmt_date(OLD.start_date::date), NULL);
      END IF;
      RETURN OLD;
    END IF;

    -- UPDATE: only a real date change on a holiday / exam / event
    v_kind := CASE NEW.event_type WHEN 'holiday' THEN 'holiday' WHEN 'exam' THEN 'exam' WHEN 'event' THEN 'event' END;
    IF v_kind IS NOT NULL AND NEW.event_type = OLD.event_type
       AND (NEW.start_date::date IS DISTINCT FROM OLD.start_date::date OR NEW.end_date::date IS DISTINCT FROM OLD.end_date::date)
       AND GREATEST(NEW.start_date::date, OLD.start_date::date) >= v_today THEN
      PERFORM public.calendar_notify_change('calendar_event', NEW.id, v_kind, NEW.school_id, NULL, NULL, NULL, NULL,
                NEW.title, 'rescheduled', public.calendar_fmt_date(OLD.start_date::date), public.calendar_fmt_date(NEW.start_date::date));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'calendar change notice skipped: %', SQLERRM;   -- never block the edit itself
  END;
  RETURN NEW;
END;
$$;

-- exam_schedules --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_exam_schedule_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE public.calendar_tz())::date;
  v_old   text;
  v_new   text;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.exam_date::date >= v_today THEN
        PERFORM public.calendar_notify_change('exam_schedule', OLD.id, 'exam', OLD.school_id, OLD.classes, NULL, NULL, NULL,
                  OLD.subject, 'cancelled',
                  public.calendar_fmt_date(OLD.exam_date::date) || COALESCE(', ' || to_char(OLD.start_time::time, 'FMHH12:MI AM'), ''), NULL);
      END IF;
      RETURN OLD;
    END IF;

    IF (NEW.exam_date::date IS DISTINCT FROM OLD.exam_date::date
        OR NEW.start_time::time IS DISTINCT FROM OLD.start_time::time
        OR NEW.end_time::time IS DISTINCT FROM OLD.end_time::time)
       AND GREATEST(NEW.exam_date::date, OLD.exam_date::date) >= v_today THEN
      v_old := public.calendar_fmt_date(OLD.exam_date::date) || COALESCE(', ' || to_char(OLD.start_time::time, 'FMHH12:MI AM'), '');
      v_new := public.calendar_fmt_date(NEW.exam_date::date) || COALESCE(', ' || to_char(NEW.start_time::time, 'FMHH12:MI AM'), '');
      PERFORM public.calendar_notify_change('exam_schedule', NEW.id, 'exam', NEW.school_id, NEW.classes, NULL, NULL, NULL,
                NEW.subject, 'rescheduled', v_old, v_new);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'exam schedule change notice skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- homework_assignments --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_homework_deadline_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tz     text := public.calendar_tz();
  v_school uuid;
  v_label  text;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.due_date IS NOT NULL AND OLD.due_date > now() THEN
        SELECT school_id INTO v_school FROM public.profiles WHERE id = OLD.teacher_id;
        v_label := COALESCE(NULLIF(OLD.subject, ''), 'Homework') || COALESCE(' – ' || NULLIF(OLD.topic, ''), '');
        PERFORM public.calendar_notify_change('homework', OLD.id, 'homework', v_school, NULL, OLD.class_level, OLD.section,
                  OLD.teacher_id, v_label, 'cancelled',
                  to_char(OLD.due_date AT TIME ZONE v_tz, 'FMDy, FMDD Mon, FMHH12:MI AM'), NULL);
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.due_date IS NOT NULL AND NEW.due_date IS DISTINCT FROM OLD.due_date AND NEW.due_date > now() THEN
      SELECT school_id INTO v_school FROM public.profiles WHERE id = NEW.teacher_id;
      v_label := COALESCE(NULLIF(NEW.subject, ''), 'Homework') || COALESCE(' – ' || NULLIF(NEW.topic, ''), '');
      PERFORM public.calendar_notify_change('homework', NEW.id, 'homework', v_school, NULL, NEW.class_level, NEW.section,
                NEW.teacher_id, v_label, 'rescheduled',
                COALESCE(to_char(OLD.due_date AT TIME ZONE v_tz, 'FMDy, FMDD Mon, FMHH12:MI AM'), 'no deadline'),
                to_char(NEW.due_date AT TIME ZONE v_tz, 'FMDy, FMDD Mon, FMHH12:MI AM'));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'homework deadline notice skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_calendar_event_change(), public.trg_exam_schedule_change(), public.trg_homework_deadline_change()
  FROM PUBLIC, anon, authenticated;

-- Attach the triggers only where the table exists (academic_calendar_events and exam_schedules were created outside the
-- tracked migrations, so a fresh database may not have them yet).
DO $$
BEGIN
  IF to_regclass('public.academic_calendar_events') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_calendar_event_change_notify ON public.academic_calendar_events;
    CREATE TRIGGER trg_calendar_event_change_notify
      AFTER UPDATE OR DELETE ON public.academic_calendar_events
      FOR EACH ROW EXECUTE FUNCTION public.trg_calendar_event_change();
  END IF;
  IF to_regclass('public.exam_schedules') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_exam_schedule_change_notify ON public.exam_schedules;
    CREATE TRIGGER trg_exam_schedule_change_notify
      AFTER UPDATE OR DELETE ON public.exam_schedules
      FOR EACH ROW EXECUTE FUNCTION public.trg_exam_schedule_change();
  END IF;
  IF to_regclass('public.homework_assignments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_homework_deadline_change_notify ON public.homework_assignments;
    CREATE TRIGGER trg_homework_deadline_change_notify
      AFTER UPDATE OF due_date OR DELETE ON public.homework_assignments
      FOR EACH ROW EXECUTE FUNCTION public.trg_homework_deadline_change();
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Calendar feed: what the signed-in user should SEE (exams + homework deadlines), by role.
--   student       : exams for their class; homework for their class/section
--   parent        : the same, for each linked child (for_student names the child)
--   teacher       : exams for classes they teach; homework they assigned
--   hod           : every exam in the school; homework they assigned
--   admin / principal / school_admin : every exam in their school(s); no homework (class-level detail)
--   anyone else   : nothing
-- Holidays and school events are NOT here: the page already reads them from academic_calendar_events.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_calendar_feed(p_from date, p_to date)
RETURNS TABLE (
  source text, source_id uuid, kind text, title text, subject text, detail text,
  start_date date, end_date date, start_time text, end_time text, for_student text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_school uuid;
  v_tz     text := public.calendar_tz();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT p.role::text, p.school_id INTO v_role, v_school FROM public.profiles p WHERE p.id = v_uid;
  IF v_role IS NULL OR v_school IS NULL AND v_role <> 'school_admin' THEN RETURN; END IF;
  p_from := COALESCE(p_from, current_date - 60);
  p_to   := COALESCE(p_to,   current_date + 400);

  ---------------------------------------------------------------- exams
  IF v_role IN ('student', 'parent', 'teacher', 'hod', 'admin', 'principal', 'school_admin') THEN
    RETURN QUERY
    SELECT 'exam_schedule'::text, es.id, 'exam'::text, es.subject::text, es.subject::text, NULL::text,
           es.exam_date::date, es.exam_date::date,
           to_char(es.start_time::time, 'HH24:MI'), to_char(es.end_time::time, 'HH24:MI'),
           NULL::text
    FROM public.exam_schedules es
    WHERE es.exam_date::date BETWEEN p_from AND p_to
      AND (
        -- leadership and HODs see their school's exams
        (v_role IN ('admin', 'principal', 'hod') AND es.school_id = v_school)
        OR (v_role = 'school_admin' AND (es.school_id = v_school OR es.school_id IN
              (SELECT sas.school_id FROM public.school_admin_schools sas WHERE sas.school_admin_id = v_uid)))
        -- a student sees exams for their own class
        OR (v_role = 'student' AND es.school_id = v_school AND EXISTS (
              SELECT 1 FROM public.profiles s, unnest(es.classes) x
              WHERE s.id = v_uid AND public.calendar_class_matches(x, s.class_grade, s.section)))
        -- a teacher sees exams for classes they teach
        OR (v_role = 'teacher' AND es.school_id = v_school AND EXISTS (
              SELECT 1 FROM public.class_teachers ct JOIN public.classes c ON c.id = ct.class_id, unnest(es.classes) x
              WHERE ct.teacher_id = v_uid AND public.calendar_class_matches(x, c.name, c.section)))
      )
    UNION ALL
    -- a parent sees exams for each linked child's class (one row per child)
    SELECT 'exam_schedule', es.id, 'exam', es.subject::text, es.subject::text, NULL::text,
           es.exam_date::date, es.exam_date::date,
           to_char(es.start_time::time, 'HH24:MI'), to_char(es.end_time::time, 'HH24:MI'),
           s.full_name::text
    FROM public.exam_schedules es
    JOIN public.profiles s ON s.school_id = es.school_id AND s.role = 'student'
    JOIN public.parent_students ps ON ps.student_id = s.id AND ps.parent_id = v_uid
    WHERE v_role = 'parent' AND es.exam_date::date BETWEEN p_from AND p_to
      AND EXISTS (SELECT 1 FROM unnest(es.classes) x WHERE public.calendar_class_matches(x, s.class_grade, s.section));
  END IF;

  ---------------------------------------------------------------- homework deadlines
  IF v_role = 'student' THEN
    RETURN QUERY
    SELECT 'homework'::text, h.id, 'homework'::text,
           COALESCE(NULLIF(h.subject, ''), 'Homework')::text, h.subject::text,
           COALESCE(NULLIF(h.topic, ''), NULLIF(h.period_title, ''))::text,
           (h.due_date AT TIME ZONE v_tz)::date, (h.due_date AT TIME ZONE v_tz)::date,
           to_char(h.due_date AT TIME ZONE v_tz, 'HH24:MI'), NULL::text, NULL::text
    FROM public.homework_assignments h
    JOIN public.profiles t ON t.id = h.teacher_id AND t.school_id = v_school
    JOIN public.profiles s ON s.id = v_uid
    WHERE h.due_date IS NOT NULL AND (h.due_date AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
      AND public.calendar_student_in_scope(s.class_grade, s.section, 'homework', NULL, h.class_level, h.section);
  ELSIF v_role = 'parent' THEN
    RETURN QUERY
    SELECT 'homework'::text, h.id, 'homework'::text,
           COALESCE(NULLIF(h.subject, ''), 'Homework')::text, h.subject::text,
           COALESCE(NULLIF(h.topic, ''), NULLIF(h.period_title, ''))::text,
           (h.due_date AT TIME ZONE v_tz)::date, (h.due_date AT TIME ZONE v_tz)::date,
           to_char(h.due_date AT TIME ZONE v_tz, 'HH24:MI'), NULL::text, s.full_name::text
    FROM public.homework_assignments h
    JOIN public.profiles t ON t.id = h.teacher_id
    JOIN public.profiles s ON s.school_id = t.school_id AND s.role = 'student'
    JOIN public.parent_students ps ON ps.student_id = s.id AND ps.parent_id = v_uid
    WHERE h.due_date IS NOT NULL AND (h.due_date AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
      AND public.calendar_student_in_scope(s.class_grade, s.section, 'homework', NULL, h.class_level, h.section);
  ELSIF v_role IN ('teacher', 'hod') THEN
    RETURN QUERY
    SELECT 'homework'::text, h.id, 'homework'::text,
           COALESCE(NULLIF(h.subject, ''), 'Homework')::text, h.subject::text,
           COALESCE(NULLIF(h.topic, ''), NULLIF(h.period_title, ''))::text,
           (h.due_date AT TIME ZONE v_tz)::date, (h.due_date AT TIME ZONE v_tz)::date,
           to_char(h.due_date AT TIME ZONE v_tz, 'HH24:MI'), NULL::text,
           (CASE WHEN h.class_level ILIKE 'class%' THEN h.class_level ELSE 'Class ' || h.class_level END || COALESCE(' ' || h.section, ''))::text
    FROM public.homework_assignments h
    WHERE h.teacher_id = v_uid AND h.due_date IS NOT NULL
      AND (h.due_date AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_calendar_feed(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_feed(date, date) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Realtime: lets the open calendar refresh as soon as a date changes (best effort - RLS still decides who receives rows).
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['academic_calendar_events', 'exam_schedules', 'homework_assignments'] LOOP
      IF to_regclass('public.' || t) IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The scheduler: hourly at :05 (off the hour so it does not pile onto other jobs). Re-running this migration replaces
-- the job instead of adding a second one.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'calendar-reminders-hourly';
    PERFORM cron.schedule('calendar-reminders-hourly', '5 * * * *', 'SELECT public.calendar_run_reminders();');
  ELSE
    RAISE NOTICE 'pg_cron is not enabled - enable it, then run: SELECT cron.schedule(''calendar-reminders-hourly'', ''5 * * * *'', ''SELECT public.calendar_run_reminders();'');';
  END IF;
END $$;

-- To stop reminders:  SELECT cron.unschedule('calendar-reminders-hourly');
