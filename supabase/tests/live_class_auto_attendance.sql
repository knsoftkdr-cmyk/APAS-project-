-- Live class automatic attendance: scenario tests. Run in the Supabase SQL editor against STAGING (or a copy) AFTER
-- applying 20261112000000_live_class_auto_attendance.sql. Everything runs in one transaction and is rolled back,
-- so no data is left behind.
--
-- Needs existing data: a school with an admin-type user, and a class that has a teacher in class_teachers and at
-- least 4 students in class_students. A missing prerequisite prints a NOTICE and the test stops; any failed
-- assertion raises an EXCEPTION.
--
-- Note: now() is frozen inside a transaction, so time-based cases insert interval rows with explicit timestamps
-- (a finished class) and the join / heartbeat / leave cases only check structure (no duplicates, one open stay).
--
-- Scenarios: 1 durations -> Present / Partial / Absent   2 several stays add up   3 no duplicate rows on repeat joins
--            4 leave closes the stay, rejoin opens a new one   5 teacher correction survives tracking and can be
--            reverted   6 legacy manual rows still read correctly   7 rules change the outcome   8 reports
--            9 unauthorised access

BEGIN;

CREATE FUNCTION pg_temp.act_as(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION pg_temp.act_as_db() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

CREATE FUNCTION pg_temp.expect(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF;
  RAISE NOTICE 'ok   - %', label;
END $$;

DO $$
DECLARE
  v_class uuid; v_teacher uuid; v_school uuid; v_admin uuid; v_outsider uuid;
  st uuid[]; sp uuid[];                       -- students.id and students.profile_id of 4 class members
  t0 timestamptz := date_trunc('minute', now());
  s1 uuid; s2 uuid; d1 date; d2 date;
  w1 timestamptz := date_trunc('minute', now()) - interval '90 minutes';   -- class 1: a finished 60-minute class
  r record; n int; failed boolean;
BEGIN
  PERFORM pg_temp.act_as_db();
  SELECT ct.class_id, ct.teacher_id, p.school_id INTO v_class, v_teacher, v_school
    FROM class_teachers ct JOIN profiles p ON p.id = ct.teacher_id
   WHERE p.school_id IS NOT NULL
     AND (SELECT count(*) FROM class_students cs WHERE cs.class_id = ct.class_id) >= 4
   LIMIT 1;
  IF v_class IS NULL THEN RAISE NOTICE 'need a class with a teacher and 4+ students; nothing to test'; RETURN; END IF;
  SELECT id INTO v_admin FROM profiles WHERE role IN ('admin', 'school_admin', 'principal') AND school_id = v_school LIMIT 1;
  SELECT p.id INTO v_outsider FROM profiles p
   WHERE p.role = 'teacher' AND p.id <> v_teacher
     AND NOT EXISTS (SELECT 1 FROM class_teachers x WHERE x.teacher_id = p.id AND x.class_id = v_class) LIMIT 1;
  SELECT array_agg(student_id), array_agg(profile_id) INTO st, sp FROM (
    SELECT cs.student_id, s.profile_id FROM class_students cs JOIN students s ON s.id = cs.student_id
     WHERE cs.class_id = v_class ORDER BY cs.student_id LIMIT 4) x;

  -- Fixture sessions (inserted as the database owner) ---------------------------------------------------
  INSERT INTO virtual_classroom_sessions (school_id, class_id, teacher_id, subject, title, meet_link, scheduled_start, scheduled_end)
  VALUES (v_school, v_class, v_teacher, 'TEST-SUBJECT', 'finished class', 'https://meet.example/x', w1, w1 + interval '60 minutes')
  RETURNING id INTO s1;
  d1 := (w1 AT TIME ZONE 'UTC')::date;
  INSERT INTO virtual_classroom_sessions (school_id, class_id, teacher_id, subject, title, meet_link, scheduled_start, scheduled_end)
  VALUES (v_school, v_class, v_teacher, 'TEST-SUBJECT', 'running class', 'https://meet.example/y', t0 - interval '10 minutes', t0 + interval '50 minutes')
  RETURNING id INTO s2;
  d2 := ((t0 - interval '10 minutes') AT TIME ZONE 'UTC')::date;

  -- 1. Durations -> status (default rules: Present >= 75%, Partial >= 40%) -----------------------------
  -- st[1] 55 of 60 min = 91.7% present | st[2] 30 of 60 = 50% partial | st[3] 5 of 60 = 8.3% absent
  -- st[4] two stays of 20 min = 66.7% partial (2: several stays add up)
  INSERT INTO virtual_classroom_attendance_logs (school_id, session_id, student_id, session_date, joined_at, left_at, last_seen_at, leave_reason) VALUES
    (v_school, s1, st[1], d1, w1,                         w1 + interval '55 minutes', w1 + interval '55 minutes', 'manual'),
    (v_school, s1, st[2], d1, w1 + interval '30 minutes', w1 + interval '60 minutes', w1 + interval '60 minutes', 'manual'),
    (v_school, s1, st[3], d1, w1 + interval '5 minutes',  w1 + interval '10 minutes', w1 + interval '10 minutes', 'manual'),
    (v_school, s1, st[4], d1, w1,                         w1 + interval '20 minutes', w1 + interval '20 minutes', 'timeout'),
    (v_school, s1, st[4], d1, w1 + interval '30 minutes', w1 + interval '50 minutes', w1 + interval '50 minutes', 'manual');
  FOR n IN 1..4 LOOP PERFORM live_att_recompute(s1, st[n], d1); END LOOP;

  PERFORM pg_temp.act_as(v_teacher);
  SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[1];
  PERFORM pg_temp.expect('1a: 55/60 min is Present', r.result = 'present' AND r.total_seconds = 3300 AND r.is_final);
  SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[2];
  PERFORM pg_temp.expect('1b: 30/60 min is Partial and joined late', r.result = 'partial' AND r.total_seconds = 1800 AND r.is_late);
  SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[3];
  PERFORM pg_temp.expect('1c: 5/60 min is Absent but the join/leave times are kept', r.result = 'absent' AND r.first_joined_at IS NOT NULL AND r.last_left_at IS NOT NULL);
  SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[4];
  PERFORM pg_temp.expect('2: two stays add up (40 min, 66.7%, 2 joins)', r.total_seconds = 2400 AND r.join_count = 2 AND r.result = 'partial' AND jsonb_array_length(r.intervals) = 2);

  -- 3/4. Repeat joins never duplicate; leave closes; rejoin opens a new stay ---------------------------
  PERFORM pg_temp.act_as(sp[1]);
  PERFORM live_attendance_join(s2);
  PERFORM live_attendance_join(s2);
  PERFORM live_attendance_heartbeat(s2, true);
  PERFORM pg_temp.act_as_db();
  PERFORM pg_temp.expect('3a: double join -> one open stay',
    (SELECT count(*) FROM virtual_classroom_attendance_logs WHERE session_id = s2 AND student_id = st[1] AND left_at IS NULL) = 1);
  PERFORM pg_temp.expect('3b: double join -> one attendance row',
    (SELECT count(*) FROM virtual_classroom_attendance WHERE session_id = s2 AND student_id = st[1]) = 1);
  PERFORM pg_temp.act_as(sp[1]);
  PERFORM live_attendance_leave(s2);
  PERFORM pg_temp.act_as_db();
  PERFORM pg_temp.expect('4a: leave closes the open stay',
    (SELECT count(*) FROM virtual_classroom_attendance_logs WHERE session_id = s2 AND student_id = st[1] AND left_at IS NULL) = 0);
  PERFORM pg_temp.act_as(sp[1]);
  PERFORM live_attendance_join(s2);
  PERFORM pg_temp.act_as_db();
  PERFORM pg_temp.expect('4b: rejoin opens a second stay, still one attendance row',
    (SELECT count(*) FROM virtual_classroom_attendance_logs WHERE session_id = s2 AND student_id = st[1]) = 2
    AND (SELECT count(*) FROM virtual_classroom_attendance WHERE session_id = s2 AND student_id = st[1]) = 1);

  -- 5. Teacher correction wins over tracking, keeps the measurement, and can be reverted ---------------
  PERFORM pg_temp.act_as(v_teacher);
  PERFORM live_attendance_override(s1, st[3], d1, 'excused', 'medical');
  PERFORM pg_temp.act_as_db();
  PERFORM live_att_recompute(s1, st[3], d1);            -- tracking runs again (as the owner); it must not undo the correction
  PERFORM pg_temp.act_as(v_teacher);
  SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[3];
  PERFORM pg_temp.expect('5a: correction stands after tracking recomputes', r.result = 'excused' AND r.result_source = 'teacher' AND r.auto_result = 'absent' AND r.correction_reason = 'medical');
  PERFORM live_attendance_revert_override(s1, st[3], d1);
  SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[3];
  PERFORM pg_temp.expect('5b: revert hands the row back to tracking', r.result = 'absent' AND r.result_source = 'auto' AND r.correction_reason IS NULL);

  -- 6. Legacy manual rows (written the old way) still read correctly ----------------------------------
  PERFORM pg_temp.act_as_db();
  DELETE FROM virtual_classroom_attendance WHERE session_id = s1 AND student_id = st[2];
  DELETE FROM virtual_classroom_attendance_logs WHERE session_id = s1 AND student_id = st[2];
  INSERT INTO virtual_classroom_attendance (session_id, student_id, session_date, attendance_status, marked_by_teacher)
  VALUES (s1, st[2], d1, 'excused', true);
  PERFORM pg_temp.act_as(v_teacher);
  SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[2];
  PERFORM pg_temp.expect('6: legacy manual row (no new columns) reads as Excused', r.result = 'excused');

  -- 7. Rules decide the outcome -------------------------------------------------------------------------
  IF v_admin IS NOT NULL THEN
    PERFORM pg_temp.act_as(v_admin);
    PERFORM save_live_attendance_rules(true, 90, 60, 10, 180, 60);
    PERFORM pg_temp.act_as_db();
    PERFORM live_att_recompute(s1, st[1], d1);
    PERFORM pg_temp.act_as(v_teacher);
    SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[1];
    PERFORM pg_temp.expect('7a: 91.7% still Present at a 90% rule', r.result = 'present');
    SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[4];
    PERFORM pg_temp.expect('7b: 66.7% is Partial at a 60% rule', r.result = 'partial');
    PERFORM pg_temp.act_as(v_admin);
    PERFORM save_live_attendance_rules(true, 60, 30, 10, 180, 60);
    PERFORM pg_temp.act_as_db();
    PERFORM live_att_recompute(s1, st[4], d1);
    PERFORM pg_temp.act_as(v_teacher);
    SELECT * INTO r FROM get_live_attendance_day(s1, d1) WHERE student_id = st[4];
    PERFORM pg_temp.expect('7c: loosening Present to 60% turns 66.7% into Present', r.result = 'present');
    PERFORM pg_temp.act_as(v_admin);
    failed := false;
    BEGIN PERFORM save_live_attendance_rules(true, 50, 70, 10, 180, 60); EXCEPTION WHEN invalid_parameter_value THEN failed := true; END;
    PERFORM pg_temp.expect('7d: Partial threshold above Present is rejected', failed);
    PERFORM save_live_attendance_rules(true, 75, 40, 10, 180, 60);   -- restore defaults (rolled back anyway)
    PERFORM pg_temp.act_as(v_teacher);
    failed := false;
    BEGIN PERFORM save_live_attendance_rules(true, 10, 5, 10, 180, 60); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
    PERFORM pg_temp.expect('7e: a teacher cannot change the school rules', failed);
  ELSE
    RAISE NOTICE 'skip 7: no admin-type user in the school';
  END IF;

  -- 8. Reports -----------------------------------------------------------------------------------------
  PERFORM pg_temp.act_as(v_teacher);
  SELECT * INTO r FROM get_live_attendance_class_report(v_class, d1, d2, 'TEST-SUBJECT') WHERE student_id = st[1];
  PERFORM pg_temp.expect('8a: class report counts both occurrences for a student', r.sessions_held = 2);
  PERFORM pg_temp.expect('8b: session report lists the finished class with a full roster',
    (SELECT roster_size FROM get_live_attendance_session_report(v_class, d1, d2, 'TEST-SUBJECT') WHERE session_id = s1)
    = (SELECT count(*) FROM class_students WHERE class_id = v_class));

  -- 9. Unauthorised access ---------------------------------------------------------------------------
  IF v_outsider IS NOT NULL THEN
    PERFORM pg_temp.act_as(v_outsider);
    failed := false;
    BEGIN PERFORM * FROM get_live_attendance_day(s1, d1); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
    PERFORM pg_temp.expect('9a: a teacher outside the class cannot read the register', failed);
    failed := false;
    BEGIN PERFORM live_attendance_override(s1, st[1], d1, 'absent', NULL); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
    PERFORM pg_temp.expect('9b: a teacher outside the class cannot correct attendance', failed);
  ELSE
    RAISE NOTICE 'skip 9a/9b: no second teacher available';
  END IF;
  PERFORM pg_temp.act_as(sp[2]);
  failed := false;
  BEGIN PERFORM live_attendance_override(s1, st[2], d1, 'present', NULL); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  PERFORM pg_temp.expect('9c: a student cannot correct attendance', failed);
  failed := false;
  BEGIN PERFORM live_attendance_join(s2); PERFORM live_attendance_join(gen_random_uuid()); EXCEPTION WHEN OTHERS THEN failed := true; END;
  PERFORM pg_temp.expect('9d: joining an unknown session is rejected', failed);

  -- 10. Desktop: a student who stops heartbeating is NOT credited past their last heartbeat (needs migration 20261113) --
  PERFORM pg_temp.act_as_db();
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_classroom_attendance_logs' AND column_name = 'is_mobile') THEN
    DELETE FROM virtual_classroom_attendance_logs WHERE session_id = s2 AND student_id = st[2];
    -- joined 8 min ago, last heard 6 min ago, desktop (is_mobile = false), page marked away: closed page
    INSERT INTO virtual_classroom_attendance_logs (school_id, session_id, student_id, session_date, joined_at, last_seen_at, away_since, is_mobile)
    VALUES (v_school, s2, st[2], d2, t0 - interval '8 minutes', t0 - interval '7 minutes', t0 - interval '7 minutes', false);
    PERFORM live_att_close_stale(s2);
    SELECT * INTO r FROM virtual_classroom_attendance_logs WHERE session_id = s2 AND student_id = st[2];
    PERFORM pg_temp.expect('10a: desktop silence closes the stay at the last heartbeat, no grace credit',
      r.left_at = t0 - interval '7 minutes' AND r.leave_reason = 'timeout');
    -- same silence on a phone: kept open (browser suspended while the Meet app is open)
    DELETE FROM virtual_classroom_attendance_logs WHERE session_id = s2 AND student_id = st[2];
    INSERT INTO virtual_classroom_attendance_logs (school_id, session_id, student_id, session_date, joined_at, last_seen_at, away_since, is_mobile)
    VALUES (v_school, s2, st[2], d2, t0 - interval '8 minutes', t0 - interval '7 minutes', t0 - interval '7 minutes', true);
    PERFORM live_att_close_stale(s2);
    PERFORM pg_temp.expect('10b: phone silence inside the background grace stays open',
      EXISTS (SELECT 1 FROM virtual_classroom_attendance_logs WHERE session_id = s2 AND student_id = st[2] AND left_at IS NULL));
    -- 11. the teacher can end an open stay; it ends at the last time the student was seen
    PERFORM pg_temp.act_as(v_teacher);
    PERFORM live_attendance_end_stay(s2, st[2], d2);
    PERFORM pg_temp.act_as_db();
    SELECT * INTO r FROM virtual_classroom_attendance_logs WHERE session_id = s2 AND student_id = st[2];
    PERFORM pg_temp.expect('11: Mark as left ends the stay at last_seen_at', r.left_at = t0 - interval '7 minutes' AND r.leave_reason = 'manual');
  ELSE
    RAISE NOTICE 'skip 10-11: apply 20261113000000_live_attendance_presence_fixes.sql first';
  END IF;

  RAISE NOTICE 'all live-class attendance scenarios passed';
END $$;

ROLLBACK;
