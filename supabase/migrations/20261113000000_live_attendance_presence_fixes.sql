-- Live class attendance: presence fixes (follows 20261112000000_live_class_auto_attendance.sql).
--
-- Reported problem: a student who joined and left within a minute still showed "still in class" with minutes
-- counting up. Cause: ANY page that stopped heartbeating was credited as present for the whole background grace
-- (60 min). That is right for a phone whose browser is suspended while the Meet app is open, but wrong for a desktop
-- tab that was closed or a connection that dropped.
--
-- Changes
--   1. Each stay records whether it came from a phone/tablet (is_mobile).
--      Desktop: a background tab keeps heartbeating, so silence means the page was closed -> the stay ends at the
--               last heartbeat once heartbeat_timeout_seconds (default 180 s) pass. No grace credit.
--      Phone:   unchanged, the background grace still applies (the browser is suspended while Meet is open),
--               but the default is lowered from 60 to 15 minutes. Schools that saved their own value keep it.
--   2. The register can tell "in class" (heard from in the last 2.5 min) from "away" (open, but silent).
--   3. Teachers get "Mark as left" for a stay that is still open (ends it at the last time the student was seen).
-- Re-runnable. The tables are unchanged apart from one added column.

ALTER TABLE public.virtual_classroom_attendance_logs ADD COLUMN IF NOT EXISTS is_mobile boolean NOT NULL DEFAULT false;
ALTER TABLE public.live_attendance_rules ALTER COLUMN background_grace_minutes SET DEFAULT 15;

-- defaults
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
    r.background_grace_minutes := 15;
  END IF;
  RETURN r;
END $$;

-- stay accounting
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
                          CASE WHEN l.away_since IS NULL OR NOT l.is_mobile THEN l.last_seen_at ELSE l.away_since + v_grace END) AS e
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
  IF l.away_since IS NULL OR NOT l.is_mobile THEN
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

-- join now accepts a device hint (old one-argument calls keep working through the default)
DROP FUNCTION IF EXISTS public.live_attendance_join(uuid);
CREATE OR REPLACE FUNCTION public.live_attendance_join(p_session uuid, p_mobile boolean DEFAULT false) RETURNS jsonb
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

  INSERT INTO public.virtual_classroom_attendance_logs (school_id, session_id, student_id, session_date, joined_at, last_seen_at, is_mobile)
  VALUES (s.school_id, p_session, v_student, v_date, v_now, v_now, COALESCE(p_mobile, false))
  ON CONFLICT (session_id, student_id, session_date) WHERE left_at IS NULL
  DO UPDATE SET last_seen_at = v_now, away_since = NULL
  RETURNING id INTO v_log;

  PERFORM public.live_att_recompute(p_session, v_student, v_date);

  RETURN jsonb_build_object('recorded', true, 'tracking', true, 'log_id', v_log, 'session_date', v_date,
                            'window_start', w.w_start, 'window_end', w.w_end,
                            'heartbeat_seconds', 30, 'rules_present_percent', r.present_min_percent);
END $$;

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
    INSERT INTO public.virtual_classroom_attendance_logs (school_id, session_id, student_id, session_date, joined_at, last_seen_at, away_since, is_mobile)
    VALUES (l.school_id, l.session_id, l.student_id, l.session_date, v_now, v_now, CASE WHEN p_visible THEN NULL ELSE v_now END, l.is_mobile)
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

-- register: adds last_seen_at / seen_recently (return type changes, so drop first)
DROP FUNCTION IF EXISTS public.get_live_attendance_day(uuid, date);
CREATE OR REPLACE FUNCTION public.get_live_attendance_day(p_session uuid, p_date date)
RETURNS TABLE (
  student_id uuid, full_name text, roll_number text, result text, attendance_status text,
  total_seconds integer, attended_percent numeric, first_joined_at timestamptz, last_left_at timestamptz,
  join_count integer, is_late boolean, is_final boolean, in_class boolean, result_source text, auto_result text,
  corrected_at timestamptz, correction_reason text, intervals jsonb,
  last_seen_at timestamptz, seen_recently boolean
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
                  '[]'::jsonb),
         (SELECT max(o2.last_seen_at) FROM public.virtual_classroom_attendance_logs o2
           WHERE o2.session_id = p_session AND o2.student_id = cs.student_id AND o2.session_date = p_date AND o2.left_at IS NULL),
         EXISTS (SELECT 1 FROM public.virtual_classroom_attendance_logs o3
                  WHERE o3.session_id = p_session AND o3.student_id = cs.student_id AND o3.session_date = p_date
                    AND o3.left_at IS NULL AND o3.last_seen_at >= now() - interval '150 seconds')
    FROM public.virtual_classroom_sessions s
    JOIN public.class_students cs ON cs.class_id = s.class_id
    JOIN public.students st ON st.id = cs.student_id
    LEFT JOIN public.virtual_classroom_attendance a
           ON a.session_id = p_session AND a.student_id = cs.student_id AND a.session_date = p_date
   WHERE s.id = p_session;
END $$;

-- Teacher: end a stay that is still open (the student left but nothing told APAS). Ends at the last time the student
-- was seen, never at "now", so the minutes are not inflated by the time the teacher took to notice.
CREATE OR REPLACE FUNCTION public.live_attendance_end_stay(p_session uuid, p_student uuid, p_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  IF NOT public.live_att_can_manage_session(p_session) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  UPDATE public.virtual_classroom_attendance_logs
     SET left_at = GREATEST(joined_at, LEAST(last_seen_at, now())), leave_reason = 'manual'
   WHERE session_id = p_session AND student_id = p_student AND session_date = p_date AND left_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.live_att_recompute(p_session, p_student, p_date);
  RETURN jsonb_build_object('ended', n);
END $$;

-- grants (functions that were dropped / created above)
REVOKE ALL ON FUNCTION public.live_att_recompute(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_att_close_one_if_stale(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_att_rules(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_attendance_join(uuid, boolean), public.live_attendance_heartbeat(uuid, boolean),
  public.get_live_attendance_day(uuid, date), public.live_attendance_end_stay(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_attendance_join(uuid, boolean), public.live_attendance_heartbeat(uuid, boolean),
  public.get_live_attendance_day(uuid, date), public.live_attendance_end_stay(uuid, uuid, date) TO authenticated;
