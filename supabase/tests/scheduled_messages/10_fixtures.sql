-- Test helpers + a small two-school world. Runs as the superuser; tests switch identity with tests.login().
CREATE SCHEMA tests;
GRANT USAGE ON SCHEMA tests TO PUBLIC;

CREATE FUNCTION tests.id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- Switch to "signed-in user u" (role authenticated, JWT sub = u), as PostgREST does.
CREATE FUNCTION tests.login(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', u::text, false);
  EXECUTE 'SET ROLE authenticated';
END $$;

-- Switch to the service role / cron (no end-user in the session).
CREATE FUNCTION tests.service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
  EXECUTE 'SET ROLE service_role';
END $$;

CREATE FUNCTION tests.root() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', false);
END $$;

CREATE FUNCTION tests.ok(cond boolean, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', name; END IF;
  RAISE NOTICE 'ok - %', name;
END $$;

-- Runs sql under the CURRENT identity and asserts it fails (optionally with a given SQLSTATE and message fragment).
CREATE FUNCTION tests.fails(name text, sql text, sqlstate_expected text DEFAULT NULL, msg_like text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF sqlstate_expected IS NOT NULL AND v_state <> sqlstate_expected THEN
      RAISE EXCEPTION 'FAIL: % (expected SQLSTATE %, got % - %)', name, sqlstate_expected, v_state, v_msg;
    END IF;
    IF msg_like IS NOT NULL AND v_msg NOT ILIKE msg_like THEN
      RAISE EXCEPTION 'FAIL: % (message "%" does not match "%")', name, v_msg, msg_like;
    END IF;
    RAISE NOTICE 'ok - % [%]', name, v_msg;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (expected an error but the statement succeeded)', name;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO PUBLIC;

-- ── World ──────────────────────────────────────────────────────────────────────────────────────────
-- School A (tests.id(1000)) and School B (tests.id(2000)).
INSERT INTO auth.users (id) SELECT tests.id(n) FROM unnest(ARRAY[1,2,3,10,11,20,21,22,30,31,32,40,50,51,52]) n;
INSERT INTO public.profiles (id, full_name, role, school_id) VALUES
  (tests.id(1),  'Asha Admin',      'admin',   tests.id(1000)),
  (tests.id(2),  'Prem Principal',  'principal', tests.id(1000)),
  (tests.id(3),  'Hari HOD',        'hod',     tests.id(1000)),
  (tests.id(10), 'Tina Teacher',    'teacher', tests.id(1000)),
  (tests.id(11), 'Tom Teacher',     'teacher', tests.id(1000)),
  (tests.id(20), 'Sam Student',     'student', tests.id(1000)),   -- class X (Tina)
  (tests.id(21), 'Sue Student',     'student', tests.id(1000)),   -- class X (Tina)
  (tests.id(22), 'Stan Student',    'student', tests.id(1000)),   -- class Y (Tom)
  (tests.id(30), 'Pia Parent',      'parent',  tests.id(1000)),   -- parent of Sam + Sue
  (tests.id(31), 'Paul Parent',     'parent',  tests.id(1000)),   -- parent of Stan
  (tests.id(32), 'Pat Parent',      'parent',  tests.id(1000)),   -- no linked child
  (tests.id(40), 'Dev Driver',      'driver',  tests.id(1000)),
  (tests.id(50), 'Bea AdminB',      'admin',   tests.id(2000)),
  (tests.id(51), 'Stu StudentB',    'student', tests.id(2000)),
  (tests.id(52), 'Tara TeacherB',   'teacher', tests.id(2000));
INSERT INTO public.drivers (profile_id, school_id, name) VALUES (tests.id(40), tests.id(1000), 'Dev Driver');
INSERT INTO public.classes (id, name, section) VALUES (tests.id(300), 'Class 5', 'A'), (tests.id(301), 'Class 6', 'B');
INSERT INTO public.students (id, profile_id, full_name, class, section) VALUES
  (tests.id(120), tests.id(20), 'Sam Student',  'Class 5', 'A'),
  (tests.id(121), tests.id(21), 'Sue Student',  'Class 5', 'A'),
  (tests.id(122), tests.id(22), 'Stan Student', 'Class 6', 'B');
INSERT INTO public.class_students (class_id, student_id) VALUES
  (tests.id(300), tests.id(120)), (tests.id(300), tests.id(121)), (tests.id(301), tests.id(122));
INSERT INTO public.class_teachers (class_id, teacher_id) VALUES (tests.id(300), tests.id(10)), (tests.id(301), tests.id(11));
INSERT INTO public.parent_students (parent_id, student_id) VALUES
  (tests.id(30), tests.id(20)), (tests.id(30), tests.id(21)), (tests.id(31), tests.id(22));
