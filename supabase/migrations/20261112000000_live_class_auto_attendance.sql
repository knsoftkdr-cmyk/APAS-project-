-- Live Classes: automatic attendance (join time, leave time, total duration, Present / Partial / Absent).
--
-- Extends the EXISTING live-class tables; nothing is dropped or rewritten:
--   virtual_classroom_sessions    untouched (one row per scheduled session; recurring sessions run daily)
--   virtual_classroom_attendance  one row per (session_id, student_id, session_date) -- gains additive columns only
-- New:
--   virtual_classroom_attendance_logs  one row per continuous stay ("interval") -- the raw join/leave record
--   live_attendance_rules              one row per school: the configurable Present / Partial thresholds
--
-- HOW ATTENDANCE IS MEASURED (read this: it decides what "leave time" means)
--   Live classes run on an external Meet link, so APAS cannot observe the Meet call itself. A stay starts when the
--   student taps Join in APAS and is kept alive by a heartbeat from the student's APAS app/tab. It ends on:
--     manual          the student taps "Leave class" (or "I've left" when asked on returning to APAS)
--     timeout         heartbeats stopped while the APAS page was in the foreground
--     background_timeout  the APAS page was sent to the background (e.g. Meet opened in another app) and the student
--                     never came back within background_grace_minutes; the stay is credited up to that grace
--     session_ended   the class window ended
--   Leave times are therefore inferred, not observed, unless the student taps Leave. Teachers can correct any row.
--
-- STATUS MODEL
--   attended % = seconds inside the scheduled class window / scheduled duration (while the class is still running the
--   denominator is the elapsed part of the class, and the row is flagged is_final = false).
--   present  >= present_min_percent        partial >= partial_min_percent        absent  below that.
--   excused is teacher-only. A teacher correction always wins and is never overwritten by tracking.
--
-- COMPATIBILITY
--   attendance_status keeps its legacy values (joined / absent / excused) so the engagement score and every existing
--   reader keep working: present AND partial both map to 'joined'. The new attendance_result column carries
--   present / partial / absent / excused. Rows written before this migration have attendance_result NULL and are
--   read through the legacy mapping (joined -> present).
--
-- session_date keeps the convention the app already uses: the UTC calendar date of the occurrence.
--
-- No Edge Functions are added: everything is Postgres functions called as RPC.
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE throughout).

-- ── 0. Fail fast if the live tables are not what the code assumes ────────────────────────────────────
-- The live-class tables are not defined in any tracked migration of this repo.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('virtual_classroom_sessions', 'id'), ('virtual_classroom_sessions', 'school_id'),
    ('virtual_classroom_sessions', 'class_id'), ('virtual_classroom_sessions', 'teacher_id'),
    ('virtual_classroom_sessions', 'subject'), ('virtual_classroom_sessions', 'title'),
    ('virtual_classroom_sessions', 'scheduled_start'), ('virtual_classroom_sessions', 'scheduled_end'),
    ('virtual_classroom_sessions', 'recurrence_end_date'), ('virtual_classroom_sessions', 'status'),
    ('virtual_classroom_attendance', 'session_id'), ('virtual_classroom_attendance', 'student_id'),
    ('virtual_classroom_attendance', 'session_date'), ('virtual_classroom_attendance', 'attendance_status'),
    ('virtual_classroom_attendance', 'joined_at'), ('virtual_classroom_attendance', 'marked_by_teacher'),
    ('students', 'id'), ('students', 'profile_id'), ('students', 'full_name'), ('students', 'roll_number'),
    ('class_students', 'class_id'), ('class_students', 'student_id'),
    ('class_teachers', 'class_id'), ('class_teachers', 'teacher_id'),
    ('classes', 'id'), ('classes', 'name'), ('classes', 'section'),
    ('profiles', 'id'), ('profiles', 'school_id'), ('profiles', 'role')
  ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col) THEN
      RAISE EXCEPTION 'public.%.% is missing; review this migration before applying', r.tbl, r.col;
    END IF;
  END LOOP;

  IF to_regclass('public.schools') IS NULL THEN
    RAISE EXCEPTION 'public.schools does not exist (live_attendance_rules references it)';
  END IF;

  -- The existing app upserts with onConflict "session_id,student_id,session_date"; that unique key is what
  -- prevents duplicate attendance rows, and this migration relies on it too.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.virtual_classroom_attendance'::regclass
       AND i.indisunique AND i.indnatts = 3
       AND ARRAY(SELECT a.attname::text FROM pg_attribute a
                  WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) ORDER BY a.attname::text)
           = ARRAY['session_date', 'session_id', 'student_id']
  ) THEN
    RAISE EXCEPTION 'virtual_classroom_attendance has no unique key on (session_id, student_id, session_date); fix duplicates and add it first';
  END IF;
END $$;

-- ── 1. Additive columns on the existing attendance table ─────────────────────────────────────────────
ALTER TABLE public.virtual_classroom_attendance
  ADD COLUMN IF NOT EXISTS first_joined_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_left_at      timestamptz,
  ADD COLUMN IF NOT EXISTS total_seconds     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS join_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attended_percent  numeric(5,1),
  ADD COLUMN IF NOT EXISTS attendance_result text,
  ADD COLUMN IF NOT EXISTS auto_result       text,
  ADD COLUMN IF NOT EXISTS is_late           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_final          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS result_source     text,
  ADD COLUMN IF NOT EXISTS corrected_by      uuid,
  ADD COLUMN IF NOT EXISTS corrected_at      timestamptz,
  ADD COLUMN IF NOT EXISTS correction_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vca_attendance_result_chk') THEN
    ALTER TABLE public.virtual_classroom_attendance ADD CONSTRAINT vca_attendance_result_chk
      CHECK (attendance_result IS NULL OR attendance_result IN ('present', 'partial', 'absent', 'excused'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vca_auto_result_chk') THEN
    ALTER TABLE public.virtual_classroom_attendance ADD CONSTRAINT vca_auto_result_chk
      CHECK (auto_result IS NULL OR auto_result IN ('present', 'partial', 'absent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vca_result_source_chk') THEN
    ALTER TABLE public.virtual_classroom_attendance ADD CONSTRAINT vca_result_source_chk
      CHECK (result_source IS NULL OR result_source IN ('auto', 'teacher'));
  END IF;
END $$;

-- ── 2. School rules ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.live_attendance_rules (
  school_id                  uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  auto_enabled               boolean     NOT NULL DEFAULT true,
  present_min_percent        integer     NOT NULL DEFAULT 75  CHECK (present_min_percent BETWEEN 1 AND 100),
  partial_min_percent        integer     NOT NULL DEFAULT 40  CHECK (partial_min_percent BETWEEN 1 AND 100),
  late_grace_minutes         integer     NOT NULL DEFAULT 10  CHECK (late_grace_minutes BETWEEN 0 AND 120),
  heartbeat_timeout_seconds  integer     NOT NULL DEFAULT 180 CHECK (heartbeat_timeout_seconds BETWEEN 60 AND 900),
  background_grace_minutes   integer     NOT NULL DEFAULT 60  CHECK (background_grace_minutes BETWEEN 0 AND 240),
  updated_by                 uuid,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_attendance_rules_order CHECK (partial_min_percent <= present_min_percent)
);

-- ── 3. Raw join / leave intervals ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.virtual_classroom_attendance_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid,
  session_id    uuid NOT NULL REFERENCES public.virtual_classroom_sessions(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_date  date NOT NULL,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  away_since    timestamptz,
  leave_reason  text CHECK (leave_reason IS NULL OR leave_reason IN ('manual', 'timeout', 'background_timeout', 'session_ended')),
  CONSTRAINT vcal_left_after_join CHECK (left_at IS NULL OR left_at >= joined_at)
);

-- At most ONE open stay per student per session occurrence: a second tab, a second device, a double tap or a retry
-- all land on the same row, so duplicates (and double-counted time) are impossible.
CREATE UNIQUE INDEX IF NOT EXISTS vcal_one_open_stay
  ON public.virtual_classroom_attendance_logs (session_id, student_id, session_date) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS vcal_session_day
  ON public.virtual_classroom_attendance_logs (session_id, session_date, student_id);
CREATE INDEX IF NOT EXISTS vcal_open_seen
  ON public.virtual_classroom_attendance_logs (last_seen_at) WHERE left_at IS NULL;

-- ── 4. Helpers ───────────────────────────────────────────────────────────────────────────────────────
-- Admin-level: may change the school's rules.
CREATE OR REPLACE FUNCTION public.live_att_is_admin(p_school uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_school IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = auth.uid() AND p.school_id = p_school AND p.role IN ('admin', 'school_admin', 'principal')) THEN
    RETURN true;
  END IF;
  IF to_regclass('public.school_admin_schools') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.school_admin_schools sas WHERE sas.school_admin_id = auth.uid() AND sas.school_id = p_school) THEN
      RETURN true;
    END IF;
  END IF;
  RETURN false;
END $$;

-- Staff: admin-level plus HODs of the same school (may view / correct attendance for the school's sessions).
CREATE OR REPLACE FUNCTION public.live_att_is_staff(p_school uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_school IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  IF public.live_att_is_admin(p_school) THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.school_id = p_school AND p.role = 'hod');
END $$;

-- May view and correct attendance for this session: its own teacher, any teacher assigned to its class, school staff.
CREATE OR REPLACE FUNCTION public.live_att_can_manage_session(p_session uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_session IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.virtual_classroom_sessions s
     WHERE s.id = p_session
       AND (s.teacher_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.class_teachers ct WHERE ct.class_id = s.class_id AND ct.teacher_id = auth.uid())
            OR public.live_att_is_staff(s.school_id)));
END $$;

-- May view the attendance report of this class.
CREATE OR REPLACE FUNCTION public.live_att_can_manage_class(p_class uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_class IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.class_teachers ct WHERE ct.class_id = p_class AND ct.teacher_id = auth.uid()) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.virtual_classroom_sessions s
     WHERE s.class_id = p_class AND (s.teacher_id = auth.uid() OR public.live_att_is_staff(s.school_id)));
END $$;

-- The school's rules, or the defaults when it has not configured any.
CREATE OR REPLACE FUNCTION public.live_att_rules(p_school uuid) RETURNS public.live_attendance_rules
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.live_attendance_rules;
BEGIN
  SELECT * INTO r FROM public.live_attendance_rules WHERE school_id = p_school;
  IF NOT FOUND THEN
    r.school_id := p_school;
    r.auto_enabled := true;
    r.present_min_percent := 75;
    r.partial_min_percent := 40;
    r.late_grace_minutes := 10;
    r.heartbeat_timeout_seconds := 180;
    r.background_grace_minutes := 60;
  END IF;
  RETURN r;
END $$;

-- The class window of one occurrence: same UTC time of day as the stored session, on p_date, same length.
CREATE OR REPLACE FUNCTION public.live_att_occurrence(p_start timestamptz, p_end timestamptz, p_date date,
                                                      OUT w_start timestamptz, OUT w_end timestamptz)
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((p_date + (p_start AT TIME ZONE 'UTC')::time)::timestamp AT TIME ZONE 'UTC'),
         ((p_date + (p_start AT TIME ZONE 'UTC')::time)::timestamp AT TIME ZONE 'UTC')
           + GREATEST(p_end - p_start, interval '1 minute')
$$;

-- Which occurrence (session_date) a join at p_now belongs to: the in-range date whose window is closest to p_now.
CREATE OR REPLACE FUNCTION public.live_att_resolve_date(p_session uuid, p_now timestamptz) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  d date;
  best date;
  best_gap interval;
  gap interval;
  w record;
  first_d date;
  last_d date;
  today date := (p_now AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT scheduled_start, scheduled_end, recurrence_end_date INTO s
    FROM public.virtual_classroom_sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN NULL; END IF;
  first_d := (s.scheduled_start AT TIME ZONE 'UTC')::date;
  last_d := GREATEST(COALESCE(s.recurrence_end_date, first_d), first_d);

  FOR d IN SELECT g::date FROM generate_series((today - 1)::timestamp, (today + 1)::timestamp, interval '1 day') g
  LOOP
    CONTINUE WHEN d < first_d OR d > last_d;
    SELECT * INTO w FROM public.live_att_occurrence(s.scheduled_start, s.scheduled_end, d);
    gap := CASE WHEN p_now < w.w_start THEN w.w_start - p_now
                WHEN p_now > w.w_end THEN p_now - w.w_end
                ELSE interval '0' END;
    IF best IS NULL OR gap < best_gap THEN best := d; best_gap := gap; END IF;
  END LOOP;

  RETURN COALESCE(best, LEAST(GREATEST(today, first_d), last_d));
END $$;

-- Legacy reader: attendance_result when present, otherwise derived from the old attendance_status.
CREATE OR REPLACE FUNCTION public.live_att_effective_result(p_result text, p_status text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_result,
           CASE p_status WHEN 'joined' THEN 'present' WHEN 'excused' THEN 'excused' ELSE 'absent' END)
$$;

-- ── 5. Recompute one (session, student, date) from its intervals ─────────────────────────────────────
-- Internal. Idempotent. Never touches the status or result of a row a teacher has set; it still refreshes the
-- measured fields and auto_result so a correction can be reverted to what tracking measured.
CREATE OR REPLACE FUNCTION public.live_att_recompute(p_session uuid, p_student uuid, p_date date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  r public.live_attendance_rules;
  w record;
  v_now timestamptz := now();
  v_grace interval;
  v_total numeric;
  v_first timestamptz;
  v_last_left timestamptz;
  v_open boolean;
  v_count integer;
  v_den numeric;
  v_pct numeric;
  v_res text;
  v_late boolean;
  v_final boolean;
BEGIN
  SELECT * INTO s FROM public.virtual_classroom_sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN; END IF;
  r := public.live_att_rules(s.school_id);
  SELECT * INTO w FROM public.live_att_occurrence(s.scheduled_start, s.scheduled_end, p_date);
  v_grace := make_interval(mins => r.background_grace_minutes);

  SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (LEAST(x.e, w.w_end, v_now) - GREATEST(x.j, w.w_start))))), 0),
         MIN(x.j),
         MAX(x.left_at),
         COALESCE(BOOL_OR(x.left_at IS NULL), false),
         COUNT(*)
    INTO v_total, v_first, v_last_left, v_open, v_count
    FROM (SELECT l.joined_at AS j, l.left_at,
                 COALESCE(l.left_at,
                          CASE WHEN l.away_since IS NULL THEN l.last_seen_at ELSE l.away_since + v_grace END) AS e
            FROM public.virtual_classroom_attendance_logs l
           WHERE l.session_id = p_session AND l.student_id = p_student AND l.session_date = p_date) x;

  IF v_count = 0 THEN RETURN; END IF;   -- nothing tracked: leave any legacy / manual row alone
  IF v_open THEN v_last_left := NULL; END IF;

  v_final := v_now >= w.w_end;
  v_den := CASE WHEN v_final THEN EXTRACT(EPOCH FROM (w.w_end - w.w_start))
                ELSE GREATEST(60, EXTRACT(EPOCH FROM (LEAST(v_now, w.w_end) - w.w_start))) END;
  v_pct := ROUND(LEAST(100, v_total / GREATEST(v_den, 1) * 100)::numeric, 1);
  v_res := CASE WHEN v_now < w.w_start THEN 'present'            -- joined early; provisional until the class starts
                WHEN v_pct >= r.present_min_percent THEN 'present'
                WHEN v_pct >= r.partial_min_percent THEN 'partial'
                ELSE 'absent' END;
  v_late := v_first > w.w_start + make_interval(mins => r.late_grace_minutes);

  INSERT INTO public.virtual_classroom_attendance AS a
    (session_id, student_id, session_date, attendance_status, joined_at, marked_by_teacher,
     first_joined_at, last_left_at, total_seconds, join_count, attended_percent,
     attendance_result, auto_result, is_late, is_final, result_source)
  VALUES
    (p_session, p_student, p_date, CASE WHEN v_res = 'absent' THEN 'absent' ELSE 'joined' END, v_first, false,
     v_first, v_last_left, v_total::integer, v_count, v_pct,
     v_res, v_res, v_late, v_final, 'auto')
  ON CONFLICT (session_id, student_id, session_date) DO UPDATE SET
    joined_at         = COALESCE(a.joined_at, EXCLUDED.joined_at),
    first_joined_at   = EXCLUDED.first_joined_at,
    last_left_at      = EXCLUDED.last_left_at,
    total_seconds     = EXCLUDED.total_seconds,
    join_count        = EXCLUDED.join_count,
    attended_percent  = EXCLUDED.attended_percent,
    auto_result       = EXCLUDED.auto_result,
    is_late           = EXCLUDED.is_late,
    is_final          = EXCLUDED.is_final,
    attendance_result = CASE WHEN COALESCE(a.marked_by_teacher, false) THEN a.attendance_result ELSE EXCLUDED.attendance_result END,
    attendance_status = CASE WHEN COALESCE(a.marked_by_teacher, false) THEN a.attendance_status ELSE EXCLUDED.attendance_status END,
    result_source     = CASE WHEN COALESCE(a.marked_by_teacher, false) THEN a.result_source ELSE 'auto' END
  WHERE (a.first_joined_at, a.last_left_at, a.total_seconds, a.join_count, a.attended_percent, a.auto_result,
         a.is_late, a.is_final, a.attendance_result, a.attendance_status)
        IS DISTINCT FROM
        (EXCLUDED.first_joined_at, EXCLUDED.last_left_at, EXCLUDED.total_seconds, EXCLUDED.join_count,
         EXCLUDED.attended_percent, EXCLUDED.auto_result, EXCLUDED.is_late, EXCLUDED.is_final,
         CASE WHEN COALESCE(a.marked_by_teacher, false) THEN a.attendance_result ELSE EXCLUDED.attendance_result END,
         CASE WHEN COALESCE(a.marked_by_teacher, false) THEN a.attendance_status ELSE EXCLUDED.attendance_status END);
END $$;

-- Close ONE open stay if it has gone stale. Returns the reason it closed ('ended' | 'timeout' | 'background_timeout')
-- or NULL if it is still live (or already closed).
CREATE OR REPLACE FUNCTION public.live_att_close_one_if_stale(p_log uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l record;
  s record;
  r public.live_attendance_rules;
  w record;
  v_end timestamptz;
  v_reason text;
  v_over boolean;
BEGIN
  SELECT * INTO l FROM public.virtual_classroom_attendance_logs WHERE id = p_log AND left_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.virtual_classroom_sessions WHERE id = l.session_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  r := public.live_att_rules(s.school_id);
  SELECT * INTO w FROM public.live_att_occurrence(s.scheduled_start, s.scheduled_end, l.session_date);

  -- 1) Has the stay itself lapsed? Then it ends where it lapsed, even if we only notice much later.
  IF l.away_since IS NULL THEN
    IF l.last_seen_at < now() - make_interval(secs => r.heartbeat_timeout_seconds) THEN
      v_end := l.last_seen_at; v_reason := 'timeout';
    END IF;
  ELSIF l.away_since + make_interval(mins => r.background_grace_minutes) < now() THEN
    v_end := l.away_since + make_interval(mins => r.background_grace_minutes); v_reason := 'background_timeout';
  END IF;

  -- 2) Long past the class end: whatever is still open ends with the class (credit is clipped to the window anyway).
  v_over := now() > w.w_end + interval '30 minutes';
  IF v_reason IS NULL AND v_over THEN
    v_end := w.w_end; v_reason := 'session_ended';
  END IF;

  IF v_reason IS NULL THEN RETURN NULL; END IF;
  UPDATE public.virtual_classroom_attendance_logs
     SET left_at = GREATEST(l.joined_at, LEAST(v_end, now())), leave_reason = v_reason
   WHERE id = l.id;
  PERFORM public.live_att_recompute(l.session_id, l.student_id, l.session_date);
  -- 'ended' tells a heartbeat not to start a fresh stay after the class is over.
  RETURN CASE WHEN v_over THEN 'ended' ELSE v_reason END;
END $$;

-- Sweep: close every stale open stay (optionally for one session). Called lazily by the teacher views and, when
-- pg_cron exists, every 5 minutes.
CREATE OR REPLACE FUNCTION public.live_att_close_stale(p_session uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l record;
  n integer := 0;
BEGIN
  FOR l IN SELECT id FROM public.virtual_classroom_attendance_logs
            WHERE left_at IS NULL AND (p_session IS NULL OR session_id = p_session)
  LOOP
    IF public.live_att_close_one_if_stale(l.id) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

-- ── 6. Student-facing RPCs (identity always comes from auth.uid(), never from a parameter) ───────────
CREATE OR REPLACE FUNCTION public.live_att_my_student() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM public.students s WHERE s.profile_id = auth.uid() LIMIT 1
$$;

-- Join: opens (or re-uses) the student's current stay. Idempotent: double taps, retries, a second tab or a second
-- device never create a second open stay or a second attendance row.
CREATE OR REPLACE FUNCTION public.live_attendance_join(p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid := public.live_att_my_student();
  s record;
  r public.live_attendance_rules;
  w record;
  v_date date;
  v_now timestamptz := now();
  v_log uuid;
  l record;
  v_closed text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF v_student IS NULL THEN RAISE EXCEPTION 'Only students can join a live class' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.virtual_classroom_sessions WHERE id = p_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.class_students cs WHERE cs.class_id = s.class_id AND cs.student_id = v_student) THEN
    RAISE EXCEPTION 'You are not enrolled in this class' USING ERRCODE = '42501';
  END IF;
  IF lower(COALESCE(s.status, '')) IN ('cancelled', 'canceled') THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'cancelled');
  END IF;

  r := public.live_att_rules(s.school_id);
  v_date := public.live_att_resolve_date(p_session, v_now);
  SELECT * INTO w FROM public.live_att_occurrence(s.scheduled_start, s.scheduled_end, v_date);

  -- Outside the class (earlier than 30 min before, or later than 30 min after): nothing is recorded, so opening the
  -- link the next day cannot mark a student present.
  IF v_now < w.w_start - interval '30 minutes' OR v_now > w.w_end + interval '30 minutes' THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'outside_class_time', 'session_date', v_date,
                              'window_start', w.w_start, 'window_end', w.w_end);
  END IF;

  -- School has switched automatic tracking off: behave exactly as the app did before (one 'joined' row, first join kept).
  IF NOT r.auto_enabled THEN
    INSERT INTO public.virtual_classroom_attendance AS a
      (session_id, student_id, session_date, attendance_status, joined_at, marked_by_teacher)
    VALUES (p_session, v_student, v_date, 'joined', v_now, false)
    ON CONFLICT (session_id, student_id, session_date) DO UPDATE
      SET joined_at = COALESCE(a.joined_at, EXCLUDED.joined_at),
          attendance_status = CASE WHEN COALESCE(a.marked_by_teacher, false) THEN a.attendance_status ELSE 'joined' END;
    RETURN jsonb_build_object('recorded', true, 'tracking', false, 'session_date', v_date,
                              'window_start', w.w_start, 'window_end', w.w_end);
  END IF;

  -- A stale open stay must not swallow the gap: close it first (it is credited only up to its true end).
  SELECT * INTO l FROM public.virtual_classroom_attendance_logs
   WHERE session_id = p_session AND student_id = v_student AND session_date = v_date AND left_at IS NULL;
  IF FOUND THEN v_closed := public.live_att_close_one_if_stale(l.id); END IF;

  INSERT INTO public.virtual_classroom_attendance_logs (school_id, session_id, student_id, session_date, joined_at, last_seen_at)
  VALUES (s.school_id, p_session, v_student, v_date, v_now, v_now)
  ON CONFLICT (session_id, student_id, session_date) WHERE left_at IS NULL
  DO UPDATE SET last_seen_at = v_now, away_since = NULL
  RETURNING id INTO v_log;

  PERFORM public.live_att_recompute(p_session, v_student, v_date);

  RETURN jsonb_build_object('recorded', true, 'tracking', true, 'log_id', v_log, 'session_date', v_date,
                            'window_start', w.w_start, 'window_end', w.w_end,
                            'heartbeat_seconds', 30, 'rules_present_percent', r.present_min_percent);
END $$;

-- Heartbeat: keeps the open stay alive. p_visible = false marks the app as backgrounded (e.g. the student switched
-- to the Meet app); the stay then runs on the rules' background grace instead of the foreground timeout.
CREATE OR REPLACE FUNCTION public.live_attendance_heartbeat(p_session uuid, p_visible boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid := public.live_att_my_student();
  l record;
  s record;
  v_closed text;
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL OR v_student IS NULL THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT * INTO l FROM public.virtual_classroom_attendance_logs
   WHERE session_id = p_session AND student_id = v_student AND left_at IS NULL
   ORDER BY joined_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;

  v_closed := public.live_att_close_one_if_stale(l.id);
  IF v_closed = 'ended' THEN
    RETURN jsonb_build_object('active', false, 'ended', true);
  ELSIF v_closed IS NOT NULL THEN
    -- The old stay had lapsed (and was credited only up to where it lapsed). The student is demonstrably back now.
    INSERT INTO public.virtual_classroom_attendance_logs (school_id, session_id, student_id, session_date, joined_at, last_seen_at, away_since)
    VALUES (l.school_id, l.session_id, l.student_id, l.session_date, v_now, v_now, CASE WHEN p_visible THEN NULL ELSE v_now END)
    ON CONFLICT (session_id, student_id, session_date) WHERE left_at IS NULL DO NOTHING;
    PERFORM public.live_att_recompute(l.session_id, l.student_id, l.session_date);
    RETURN jsonb_build_object('active', true, 'resumed', true);
  END IF;

  UPDATE public.virtual_classroom_attendance_logs
     SET last_seen_at = v_now,
         away_since = CASE WHEN p_visible THEN NULL ELSE COALESCE(away_since, v_now) END
   WHERE id = l.id;
  RETURN jsonb_build_object('active', true);
END $$;

-- Leave: the student says they are done. Closes the open stay now and finalises the totals.
CREATE OR REPLACE FUNCTION public.live_attendance_leave(p_session uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student uuid := public.live_att_my_student();
  l record;
  v_closed text;
  a record;
BEGIN
  IF auth.uid() IS NULL OR v_student IS NULL THEN RETURN jsonb_build_object('left', false); END IF;
  SELECT * INTO l FROM public.virtual_classroom_attendance_logs
   WHERE session_id = p_session AND student_id = v_student AND left_at IS NULL
   ORDER BY joined_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('left', false, 'reason', 'no_open_stay'); END IF;

  -- If it had already lapsed it is closed at its true end, not credited up to this tap.
  v_closed := public.live_att_close_one_if_stale(l.id);
  IF v_closed IS NULL THEN
    UPDATE public.virtual_classroom_attendance_logs
       SET left_at = GREATEST(joined_at, now()), leave_reason = 'manual'
     WHERE id = l.id;
    PERFORM public.live_att_recompute(l.session_id, l.student_id, l.session_date);
  END IF;

  SELECT total_seconds, attended_percent, attendance_result INTO a
    FROM public.virtual_classroom_attendance
   WHERE session_id = l.session_id AND student_id = l.student_id AND session_date = l.session_date;
  RETURN jsonb_build_object('left', true, 'total_seconds', COALESCE(a.total_seconds, 0),
                            'attended_percent', a.attended_percent, 'result', a.attendance_result);
END $$;

-- ── 7. Teacher-facing RPCs ───────────────────────────────────────────────────────────────────────────
-- One call for the day register: closes lapsed stays, refreshes totals, returns the whole roster.
CREATE OR REPLACE FUNCTION public.get_live_attendance_day(p_session uuid, p_date date)
RETURNS TABLE (
  student_id uuid, full_name text, roll_number text, result text, attendance_status text,
  total_seconds integer, attended_percent numeric, first_joined_at timestamptz, last_left_at timestamptz,
  join_count integer, is_late boolean, is_final boolean, in_class boolean, result_source text, auto_result text,
  corrected_at timestamptz, correction_reason text, intervals jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  x record;
BEGIN
  IF NOT public.live_att_can_manage_session(p_session) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  PERFORM public.live_att_close_stale(p_session);
  FOR x IN SELECT DISTINCT l.student_id AS sid FROM public.virtual_classroom_attendance_logs l
            WHERE l.session_id = p_session AND l.session_date = p_date
  LOOP
    PERFORM public.live_att_recompute(p_session, x.sid, p_date);
  END LOOP;

  RETURN QUERY
  SELECT cs.student_id, st.full_name::text, st.roll_number::text,
         public.live_att_effective_result(a.attendance_result, a.attendance_status),
         a.attendance_status::text,
         COALESCE(a.total_seconds, 0), a.attended_percent, a.first_joined_at,
         a.last_left_at, COALESCE(a.join_count, 0), COALESCE(a.is_late, false), COALESCE(a.is_final, false),
         EXISTS (SELECT 1 FROM public.virtual_classroom_attendance_logs o
                  WHERE o.session_id = p_session AND o.student_id = cs.student_id AND o.session_date = p_date AND o.left_at IS NULL),
         a.result_source::text, a.auto_result::text, a.corrected_at, a.correction_reason::text,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('joined_at', g.joined_at, 'left_at', g.left_at,
                                                       'open', g.left_at IS NULL, 'reason', g.leave_reason)
                                    ORDER BY g.joined_at)
                     FROM public.virtual_classroom_attendance_logs g
                    WHERE g.session_id = p_session AND g.student_id = cs.student_id AND g.session_date = p_date),
                  '[]'::jsonb)
    FROM public.virtual_classroom_sessions s
    JOIN public.class_students cs ON cs.class_id = s.class_id
    JOIN public.students st ON st.id = cs.student_id
    LEFT JOIN public.virtual_classroom_attendance a
           ON a.session_id = p_session AND a.student_id = cs.student_id AND a.session_date = p_date
   WHERE s.id = p_session;
END $$;

-- Correct one student's attendance for one occurrence (Present / Partial / Absent / Excused).
-- Sets marked_by_teacher so tracking never overwrites it; keeps what tracking measured in auto_result.
CREATE OR REPLACE FUNCTION public.live_attendance_override(p_session uuid, p_student uuid, p_date date,
                                                           p_result text, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  v_first date;
  v_last date;
  v_status text;
BEGIN
  IF NOT public.live_att_can_manage_session(p_session) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_result IS NULL OR p_result NOT IN ('present', 'partial', 'absent', 'excused') THEN
    RAISE EXCEPTION 'Invalid attendance result: %', p_result USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.virtual_classroom_sessions WHERE id = p_session;
  IF NOT EXISTS (SELECT 1 FROM public.class_students cs WHERE cs.class_id = s.class_id AND cs.student_id = p_student) THEN
    RAISE EXCEPTION 'Student is not in this class' USING ERRCODE = '22023';
  END IF;
  v_first := (s.scheduled_start AT TIME ZONE 'UTC')::date;
  v_last := GREATEST(COALESCE(s.recurrence_end_date, v_first), v_first);
  IF p_date IS NULL OR p_date < v_first OR p_date > v_last THEN
    RAISE EXCEPTION 'Date is outside this session''s schedule' USING ERRCODE = '22023';
  END IF;

  v_status := CASE p_result WHEN 'excused' THEN 'excused' WHEN 'absent' THEN 'absent' ELSE 'joined' END;

  INSERT INTO public.virtual_classroom_attendance AS a
    (session_id, student_id, session_date, attendance_status, marked_by_teacher,
     attendance_result, result_source, corrected_by, corrected_at, correction_reason)
  VALUES (p_session, p_student, p_date, v_status, true,
          p_result, 'teacher', auth.uid(), now(), NULLIF(btrim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (session_id, student_id, session_date) DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    marked_by_teacher = true,
    attendance_result = EXCLUDED.attendance_result,
    result_source     = 'teacher',
    corrected_by      = auth.uid(),
    corrected_at      = now(),
    correction_reason = EXCLUDED.correction_reason;

  RETURN jsonb_build_object('ok', true, 'result', p_result);
END $$;

-- Undo a correction: hand the row back to tracking. Only possible where tracking has a measurement to return to.
CREATE OR REPLACE FUNCTION public.live_attendance_revert_override(p_session uuid, p_student uuid, p_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record;
BEGIN
  IF NOT public.live_att_can_manage_session(p_session) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.virtual_classroom_attendance
   WHERE session_id = p_session AND student_id = p_student AND session_date = p_date;
  IF NOT FOUND OR a.auto_result IS NULL THEN
    RAISE EXCEPTION 'Nothing was tracked automatically for this student on this date' USING ERRCODE = '22023';
  END IF;
  UPDATE public.virtual_classroom_attendance
     SET marked_by_teacher = false, result_source = 'auto',
         corrected_by = NULL, corrected_at = NULL, correction_reason = NULL,
         attendance_result = auto_result,
         attendance_status = CASE WHEN auto_result = 'absent' THEN 'absent' ELSE 'joined' END
   WHERE session_id = p_session AND student_id = p_student AND session_date = p_date;
  PERFORM public.live_att_recompute(p_session, p_student, p_date);
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── 8. Class-wise reports ────────────────────────────────────────────────────────────────────────────
-- Occurrences of a class's sessions that have started, inside [p_from, p_to] (recurring sessions run every day
-- between their start date and recurrence_end_date, the app's existing convention). Cancelled sessions are skipped.
CREATE OR REPLACE FUNCTION public.live_att_occurrences(p_class uuid, p_from date, p_to date, p_subject text)
RETURNS TABLE (session_id uuid, subject text, title text, session_date date, w_start timestamptz, w_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.subject::text, s.title::text, d::date, o.w_start, o.w_end
    FROM public.virtual_classroom_sessions s
    CROSS JOIN LATERAL generate_series(
        GREATEST((s.scheduled_start AT TIME ZONE 'UTC')::date, p_from)::timestamp,
        LEAST(GREATEST(COALESCE(s.recurrence_end_date, (s.scheduled_start AT TIME ZONE 'UTC')::date),
                       (s.scheduled_start AT TIME ZONE 'UTC')::date),
              p_to, ((now() AT TIME ZONE 'UTC')::date))::timestamp,
        interval '1 day') d
    CROSS JOIN LATERAL public.live_att_occurrence(s.scheduled_start, s.scheduled_end, d::date) o
   WHERE s.class_id = p_class
     AND (p_subject IS NULL OR s.subject = p_subject)
     AND lower(COALESCE(s.status, '')) NOT IN ('cancelled', 'canceled')
     AND o.w_start <= now()
$$;

-- By student: one row per current class member.
CREATE OR REPLACE FUNCTION public.get_live_attendance_class_report(p_class uuid, p_from date, p_to date, p_subject text DEFAULT NULL)
RETURNS TABLE (
  student_id uuid, full_name text, roll_number text, sessions_held integer, present integer, partial integer,
  absent integer, excused integer, late integer, total_seconds bigint, attended_percent numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.live_att_can_manage_class(p_class) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'Date range is limited to one year' USING ERRCODE = '22023';
  END IF;
  PERFORM public.live_att_close_stale(cs0.id) FROM public.virtual_classroom_sessions cs0 WHERE cs0.class_id = p_class;

  RETURN QUERY
  WITH occ AS (SELECT * FROM public.live_att_occurrences(p_class, p_from, p_to, p_subject)),
  cells AS (
    SELECT cs.student_id AS sid, o.session_id AS ssid,
           public.live_att_effective_result(a.attendance_result, a.attendance_status) AS res,
           COALESCE(a.total_seconds, 0) AS secs, COALESCE(a.is_late, false) AS late
      FROM public.class_students cs
      CROSS JOIN occ o
      LEFT JOIN public.virtual_classroom_attendance a
             ON a.session_id = o.session_id AND a.student_id = cs.student_id AND a.session_date = o.session_date
     WHERE cs.class_id = p_class)
  SELECT st.id, st.full_name::text, st.roll_number::text,
         COUNT(c.ssid)::integer,
         COUNT(*) FILTER (WHERE c.res = 'present')::integer,
         COUNT(*) FILTER (WHERE c.res = 'partial')::integer,
         COUNT(*) FILTER (WHERE c.res = 'absent')::integer,
         COUNT(*) FILTER (WHERE c.res = 'excused')::integer,
         COUNT(*) FILTER (WHERE c.late)::integer,
         COALESCE(SUM(c.secs), 0)::bigint,
         ROUND(100.0 * COUNT(*) FILTER (WHERE c.res IN ('present', 'partial'))
               / NULLIF(COUNT(c.ssid) - COUNT(*) FILTER (WHERE c.res = 'excused'), 0), 1)
    FROM public.class_students cs2
    JOIN public.students st ON st.id = cs2.student_id
    LEFT JOIN cells c ON c.sid = st.id
   WHERE cs2.class_id = p_class
   GROUP BY st.id, st.full_name, st.roll_number
   ORDER BY st.roll_number NULLS LAST, st.full_name;
END $$;

-- By session: one row per class occurrence.
CREATE OR REPLACE FUNCTION public.get_live_attendance_session_report(p_class uuid, p_from date, p_to date, p_subject text DEFAULT NULL)
RETURNS TABLE (
  session_id uuid, session_date date, subject text, title text, window_start timestamptz, window_end timestamptz,
  roster_size integer, present integer, partial integer, absent integer, excused integer, late integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.live_att_can_manage_class(p_class) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'Date range is limited to one year' USING ERRCODE = '22023';
  END IF;
  PERFORM public.live_att_close_stale(cs0.id) FROM public.virtual_classroom_sessions cs0 WHERE cs0.class_id = p_class;

  RETURN QUERY
  SELECT o.session_id, o.session_date, o.subject, o.title, o.w_start, o.w_end,
         COUNT(cs.student_id)::integer,
         COUNT(*) FILTER (WHERE public.live_att_effective_result(a.attendance_result, a.attendance_status) = 'present')::integer,
         COUNT(*) FILTER (WHERE public.live_att_effective_result(a.attendance_result, a.attendance_status) = 'partial')::integer,
         COUNT(*) FILTER (WHERE public.live_att_effective_result(a.attendance_result, a.attendance_status) = 'absent')::integer,
         COUNT(*) FILTER (WHERE public.live_att_effective_result(a.attendance_result, a.attendance_status) = 'excused')::integer,
         COUNT(*) FILTER (WHERE COALESCE(a.is_late, false))::integer
    FROM public.live_att_occurrences(p_class, p_from, p_to, p_subject) o
    JOIN public.class_students cs ON cs.class_id = p_class
    LEFT JOIN public.virtual_classroom_attendance a
           ON a.session_id = o.session_id AND a.student_id = cs.student_id AND a.session_date = o.session_date
   GROUP BY o.session_id, o.session_date, o.subject, o.title, o.w_start, o.w_end
   ORDER BY o.session_date DESC, o.w_start DESC;
END $$;

-- ── 9. Rules RPCs ────────────────────────────────────────────────────────────────────────────────────
-- Anyone signed in can read their own school's rules (the register shows them); only admin-level users can change them.
CREATE OR REPLACE FUNCTION public.get_live_attendance_rules() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_school uuid;
  r public.live_attendance_rules;
BEGIN
  SELECT school_id INTO v_school FROM public.profiles WHERE id = auth.uid();
  IF v_school IS NULL THEN RETURN NULL; END IF;
  r := public.live_att_rules(v_school);
  RETURN jsonb_build_object(
    'school_id', r.school_id, 'auto_enabled', r.auto_enabled,
    'present_min_percent', r.present_min_percent, 'partial_min_percent', r.partial_min_percent,
    'late_grace_minutes', r.late_grace_minutes, 'heartbeat_timeout_seconds', r.heartbeat_timeout_seconds,
    'background_grace_minutes', r.background_grace_minutes,
    'can_edit', public.live_att_is_admin(v_school));
END $$;

CREATE OR REPLACE FUNCTION public.save_live_attendance_rules(
  p_auto_enabled boolean, p_present_min_percent integer, p_partial_min_percent integer,
  p_late_grace_minutes integer, p_heartbeat_timeout_seconds integer, p_background_grace_minutes integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_school uuid;
BEGIN
  SELECT school_id INTO v_school FROM public.profiles WHERE id = auth.uid();
  IF v_school IS NULL OR NOT public.live_att_is_admin(v_school) THEN
    RAISE EXCEPTION 'Only a school administrator can change attendance rules' USING ERRCODE = '42501';
  END IF;
  IF p_partial_min_percent > p_present_min_percent THEN
    RAISE EXCEPTION 'The Partial threshold cannot be higher than the Present threshold' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.live_attendance_rules AS r
    (school_id, auto_enabled, present_min_percent, partial_min_percent, late_grace_minutes,
     heartbeat_timeout_seconds, background_grace_minutes, updated_by, updated_at)
  VALUES (v_school, p_auto_enabled, p_present_min_percent, p_partial_min_percent, p_late_grace_minutes,
          p_heartbeat_timeout_seconds, p_background_grace_minutes, auth.uid(), now())
  ON CONFLICT (school_id) DO UPDATE SET
    auto_enabled = EXCLUDED.auto_enabled, present_min_percent = EXCLUDED.present_min_percent,
    partial_min_percent = EXCLUDED.partial_min_percent, late_grace_minutes = EXCLUDED.late_grace_minutes,
    heartbeat_timeout_seconds = EXCLUDED.heartbeat_timeout_seconds,
    background_grace_minutes = EXCLUDED.background_grace_minutes,
    updated_by = auth.uid(), updated_at = now();
  RETURN public.get_live_attendance_rules();
END $$;

-- ── 10. RLS + grants ─────────────────────────────────────────────────────────────────────────────────
-- Both new tables are read-only to clients; every write goes through the SECURITY DEFINER functions above.
ALTER TABLE public.live_attendance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_classroom_attendance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS live_attendance_rules_read ON public.live_attendance_rules;
CREATE POLICY live_attendance_rules_read ON public.live_attendance_rules FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.school_id = live_attendance_rules.school_id));

DROP POLICY IF EXISTS vcal_read ON public.virtual_classroom_attendance_logs;
CREATE POLICY vcal_read ON public.virtual_classroom_attendance_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students st WHERE st.id = virtual_classroom_attendance_logs.student_id AND st.profile_id = auth.uid())
         OR public.live_att_can_manage_session(session_id));

REVOKE ALL ON public.live_attendance_rules, public.virtual_classroom_attendance_logs FROM PUBLIC, anon;
GRANT SELECT ON public.live_attendance_rules, public.virtual_classroom_attendance_logs TO authenticated;

-- Internal helpers: nobody calls these from a client.
REVOKE ALL ON FUNCTION public.live_att_recompute(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_att_close_one_if_stale(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_att_close_stale(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_att_rules(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_att_resolve_date(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_att_occurrences(uuid, date, date, text) FROM PUBLIC, anon, authenticated;

-- Used inside RLS policies, so they must be callable by the signed-in role; they only ever answer about auth.uid().
REVOKE ALL ON FUNCTION public.live_att_is_admin(uuid), public.live_att_is_staff(uuid),
  public.live_att_can_manage_session(uuid), public.live_att_can_manage_class(uuid), public.live_att_my_student()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_att_is_admin(uuid), public.live_att_is_staff(uuid),
  public.live_att_can_manage_session(uuid), public.live_att_can_manage_class(uuid), public.live_att_my_student()
  TO authenticated;

-- Public RPC surface.
REVOKE ALL ON FUNCTION
  public.live_attendance_join(uuid), public.live_attendance_heartbeat(uuid, boolean), public.live_attendance_leave(uuid),
  public.get_live_attendance_day(uuid, date), public.live_attendance_override(uuid, uuid, date, text, text),
  public.live_attendance_revert_override(uuid, uuid, date),
  public.get_live_attendance_class_report(uuid, date, date, text), public.get_live_attendance_session_report(uuid, date, date, text),
  public.get_live_attendance_rules(), public.save_live_attendance_rules(boolean, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.live_attendance_join(uuid), public.live_attendance_heartbeat(uuid, boolean), public.live_attendance_leave(uuid),
  public.get_live_attendance_day(uuid, date), public.live_attendance_override(uuid, uuid, date, text, text),
  public.live_attendance_revert_override(uuid, uuid, date),
  public.get_live_attendance_class_report(uuid, date, date, text), public.get_live_attendance_session_report(uuid, date, date, text),
  public.get_live_attendance_rules(), public.save_live_attendance_rules(boolean, integer, integer, integer, integer, integer)
  TO authenticated;

-- ── 11. Optional: close lapsed stays every 5 minutes (only where pg_cron is installed) ───────────────
-- Without it nothing is lost: the teacher register and the reports close lapsed stays when they are opened.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'live-attendance-close-stale';
    PERFORM cron.schedule('live-attendance-close-stale', '*/5 * * * *', 'SELECT public.live_att_close_stale(NULL)');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'live-attendance-close-stale was not scheduled: %', SQLERRM;
END $$;
