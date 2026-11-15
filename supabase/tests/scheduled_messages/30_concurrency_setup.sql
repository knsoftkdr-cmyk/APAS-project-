-- One big message (300 recipients) delivered while several workers run at once. A per-row delay in a trigger makes
-- the delivery take a few seconds, so the workers genuinely overlap.
INSERT INTO auth.users (id) SELECT tests.id(10000 + n) FROM generate_series(1, 300) n;
INSERT INTO public.profiles (id, full_name, role, school_id)
  SELECT tests.id(10000 + n), 'Bulk Student ' || n, 'student', tests.id(1000) FROM generate_series(1, 300) n;

CREATE FUNCTION tests.slow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.message = 'SLOW' THEN PERFORM pg_sleep(0.01); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tests_slow BEFORE INSERT ON public.teacher_messages FOR EACH ROW EXECUTE FUNCTION tests.slow();

SELECT tests.login(tests.id(1));
SELECT schedule_message('SLOW', now() + interval '1 hour',
  (SELECT jsonb_agg(jsonb_build_object('id', tests.id(10000 + n), 'role', 'student')) FROM generate_series(1, 300) n),
  'general', NULL, NULL, 'Whole School') \gset big_
SELECT schedule_message('CONC-2', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher'), tests.r(11,'teacher'))) \gset c2_
SELECT schedule_message('CONC-3', now() + interval '1 hour', jsonb_build_array(tests.r(30,'parent'), tests.r(20,'student'))) \gset c3_
SELECT tests.root();
UPDATE scheduled_messages SET scheduled_for = now() - interval '1 minute' WHERE message IN ('SLOW', 'CONC-2', 'CONC-3');
SELECT id FROM scheduled_messages WHERE message = 'SLOW';
