-- Delivery + read tracking: scenario tests. Run in the Supabase SQL editor against STAGING (or a copy) AFTER
-- applying 20261105000000_message_delivery_tracking.sql. Everything runs in one transaction and is rolled back,
-- so no data is left behind. It uses existing profiles (teacher_messages has foreign keys), so the school needs at
-- least one admin-type user, 2+ students, and ideally a teacher and a parent. A scenario that lacks the users it
-- needs prints a NOTICE and is skipped; any failed assertion raises an EXCEPTION.
--
-- Scenarios: 1 single student  2 broadcast to up to 100 students  3 only some receive  4 some open, some do not
--            5 repeated opens  6 offline then opens later  7 teacher + parent parity  8 unauthorized access

BEGIN;

CREATE FUNCTION pg_temp.act_as(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION pg_temp.act_as_admin_db() RETURNS void LANGUAGE plpgsql AS $$
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
  admin_id uuid; school uuid;
  students uuid[]; n_students int;
  teacher_id uuid; parent_id uuid;
  batch uuid := gen_random_uuid();
  direct_id uuid := gen_random_uuid();
  sid uuid; mid uuid; k int;
  c record; t1 timestamptz; t2 timestamptz;
  others uuid[]; victim uuid;
BEGIN
  PERFORM pg_temp.act_as_admin_db();
  SELECT id, school_id INTO admin_id, school FROM profiles
   WHERE role IN ('admin','school_admin','principal') AND school_id IS NOT NULL LIMIT 1;
  IF admin_id IS NULL THEN RAISE NOTICE 'no admin-type user found; nothing to test'; RETURN; END IF;
  SELECT array_agg(id) INTO students FROM (SELECT id FROM profiles WHERE role = 'student' AND school_id = school LIMIT 100) x;
  n_students := COALESCE(cardinality(students), 0);
  IF n_students < 2 THEN RAISE NOTICE 'need at least 2 students in the school'; RETURN; END IF;
  SELECT id INTO teacher_id FROM profiles WHERE role = 'teacher' AND school_id = school LIMIT 1;
  SELECT id INTO parent_id  FROM profiles WHERE role = 'parent'  AND school_id = school LIMIT 1;

  -- 1. Admin sends to ONE student ---------------------------------------------------------------------
  PERFORM pg_temp.act_as(admin_id);
  INSERT INTO teacher_messages (id, school_id, sender_id, recipient_id, recipient_role, message, message_type)
  VALUES (direct_id, school, admin_id, students[1], 'student', 'direct test', 'general');
  PERFORM pg_temp.expect('1: new direct message starts Pending (insert alone is not delivery)',
    (SELECT delivery_status = 'pending' AND sent_at IS NOT NULL AND delivered_at IS NULL AND read_at IS NULL
       FROM teacher_messages WHERE id = direct_id));
  -- a client cannot insert itself as delivered
  PERFORM pg_temp.expect('1: client-supplied delivered_at/read_at are discarded on insert', (
    WITH ins AS (
      INSERT INTO teacher_messages (school_id, sender_id, recipient_id, recipient_role, message, message_type, delivered_at, read_at)
      VALUES (school, admin_id, students[1], 'student', 'forged', 'general', now(), now()) RETURNING delivery_status, delivered_at, read_at)
    SELECT delivery_status = 'pending' AND delivered_at IS NULL AND read_at IS NULL FROM ins));
  PERFORM pg_temp.act_as(students[1]);
  PERFORM pg_temp.expect('1: recipient ack confirms exactly one row', ack_message_delivery(ARRAY[direct_id]) = 1);
  PERFORM pg_temp.act_as(admin_id);
  PERFORM pg_temp.expect('1: sender sees Delivered',
    (SELECT delivery_status = 'delivered' FROM teacher_messages WHERE id = direct_id));
  PERFORM pg_temp.act_as(students[1]);
  UPDATE teacher_messages SET is_read = true WHERE id = direct_id;
  PERFORM pg_temp.act_as(admin_id);
  PERFORM pg_temp.expect('1: after the recipient opens it the sender sees Read with read_at set',
    (SELECT delivery_status = 'read' AND is_read AND read_at IS NOT NULL FROM teacher_messages WHERE id = direct_id));

  -- 2. Broadcast to up to 100 students: one independent row each ----------------------------------------
  PERFORM pg_temp.act_as(admin_id);
  INSERT INTO teacher_messages (school_id, sender_id, recipient_id, recipient_role, message, message_type, batch_id, broadcast_label)
  SELECT school, admin_id, s, 'student', 'broadcast test', 'general', batch, 'All students' FROM unnest(students) s;
  SELECT total_recipients, pending_count, delivered_count, read_count INTO c FROM get_message_delivery_summaries(ARRAY[batch::text]);
  PERFORM pg_temp.expect(format('2: broadcast creates %s independent recipient records, all Pending', n_students),
    c.total_recipients = n_students AND c.pending_count = n_students AND c.delivered_count = 0 AND c.read_count = 0);

  -- 3. Only some recipients receive it (first half confirm; the rest are "offline") ---------------------
  FOR k IN 1 .. n_students / 2 LOOP
    PERFORM pg_temp.act_as(students[k]);
    SELECT id INTO mid FROM teacher_messages WHERE batch_id = batch AND recipient_id = students[k];
    PERFORM ack_message_delivery(ARRAY[mid]);
  END LOOP;
  PERFORM pg_temp.act_as(admin_id);
  SELECT pending_count, delivered_count INTO c FROM get_message_delivery_summaries(ARRAY[batch::text]);
  PERFORM pg_temp.expect('3: only the recipients that confirmed are Delivered; the rest stay Pending',
    c.delivered_count = n_students / 2 AND c.pending_count = n_students - n_students / 2);

  -- 4. Some open it, some do not -------------------------------------------------------------------------
  FOR k IN 1 .. n_students / 4 LOOP
    PERFORM pg_temp.act_as(students[k]);
    UPDATE teacher_messages SET is_read = true WHERE batch_id = batch AND recipient_id = students[k];
  END LOOP;
  PERFORM pg_temp.act_as(admin_id);
  SELECT pending_count, delivered_count, read_count, total_recipients INTO c FROM get_message_delivery_summaries(ARRAY[batch::text]);
  PERFORM pg_temp.expect('4: read / delivered / pending counts are independent and add up to the total',
    c.read_count = n_students / 4 AND c.read_count + c.delivered_count + c.pending_count = c.total_recipients);

  -- 5. Opening the same message repeatedly ----------------------------------------------------------------
  PERFORM pg_temp.act_as(students[1]);
  SELECT read_at, delivered_at INTO t1, t2 FROM teacher_messages WHERE batch_id = batch AND recipient_id = students[1];
  UPDATE teacher_messages SET is_read = true WHERE batch_id = batch AND recipient_id = students[1];
  UPDATE teacher_messages SET is_read = true WHERE batch_id = batch AND recipient_id = students[1];
  SELECT id INTO mid FROM teacher_messages WHERE batch_id = batch AND recipient_id = students[1];
  PERFORM pg_temp.expect('5: duplicate ack is a no-op (0 rows)', ack_message_delivery(ARRAY[mid, mid]) = 0);
  PERFORM pg_temp.expect('5: repeated opens keep the original read_at and delivered_at',
    (SELECT read_at = t1 AND delivered_at = t2 FROM teacher_messages WHERE id = mid));
  PERFORM pg_temp.act_as(admin_id);
  PERFORM pg_temp.expect('5: counts unchanged by repeated opens',
    (SELECT read_count = n_students / 4 FROM get_message_delivery_summaries(ARRAY[batch::text])));

  -- 6. Offline at send time, opens later (a recipient still Pending) ----------------------------------------
  sid := students[n_students];   -- last student never confirmed above (n >= 2 means index > n/2 unless n = 2)
  IF n_students >= 3 THEN
    PERFORM pg_temp.act_as(admin_id);
    PERFORM pg_temp.expect('6: offline recipient is still Pending',
      (SELECT delivery_status = 'pending' FROM teacher_messages WHERE batch_id = batch AND recipient_id = sid));
    PERFORM pg_temp.act_as(sid);
    UPDATE teacher_messages SET is_read = true WHERE batch_id = batch AND recipient_id = sid;   -- opens it later, never acked
    PERFORM pg_temp.act_as(admin_id);
    PERFORM pg_temp.expect('6: opening a never-confirmed message marks it Read and stamps delivered_at too',
      (SELECT delivery_status = 'read' AND delivered_at IS NOT NULL AND read_at IS NOT NULL
         FROM teacher_messages WHERE batch_id = batch AND recipient_id = sid));
  END IF;

  -- 7. Teacher and parent follow the same rules -----------------------------------------------------------
  IF teacher_id IS NOT NULL AND parent_id IS NOT NULL THEN
    mid := gen_random_uuid();
    PERFORM pg_temp.act_as(teacher_id);
    INSERT INTO teacher_messages (id, school_id, sender_id, recipient_id, recipient_role, message, message_type)
    VALUES (mid, school, teacher_id, parent_id, 'parent', 'teacher to parent', 'general');
    PERFORM pg_temp.expect('7: teacher -> parent starts Pending',
      (SELECT delivery_status = 'pending' FROM teacher_messages WHERE id = mid));
    PERFORM pg_temp.act_as(parent_id);
    PERFORM ack_message_delivery(ARRAY[mid]);
    PERFORM pg_temp.act_as(teacher_id);
    PERFORM pg_temp.expect('7: teacher sees Delivered', (SELECT delivery_status = 'delivered' FROM teacher_messages WHERE id = mid));
    PERFORM pg_temp.act_as(parent_id);
    UPDATE teacher_messages SET is_read = true WHERE id = mid;
    PERFORM pg_temp.act_as(teacher_id);
    PERFORM pg_temp.expect('7: teacher sees Read', (SELECT delivery_status = 'read' FROM get_message_delivery_report(mid::text)));
  ELSE
    RAISE NOTICE 'skip 7: need a teacher and a parent in the school';
  END IF;

  -- 8. Unauthorized access --------------------------------------------------------------------------------
  -- gather other people's still-unconfirmed rows as the DB owner (a restricted user could not even see them)
  PERFORM pg_temp.act_as_admin_db();
  SELECT array_agg(id) INTO others FROM teacher_messages
   WHERE batch_id = batch AND recipient_id <> students[2] AND delivered_at IS NULL;
  victim := students[n_students / 2 + 1];   -- opened by nobody in the scenarios above (unless n = 2, where 6 is skipped)
  -- a student who is a recipient of the broadcast (but not its sender) cannot read the delivery report
  PERFORM pg_temp.act_as(students[2]);
  PERFORM pg_temp.expect('8: recipient cannot read the sender''s report', (SELECT count(*) = 0 FROM get_message_delivery_report(batch::text)));
  PERFORM pg_temp.expect('8: recipient cannot read the sender''s summary', (SELECT count(*) = 0 FROM get_message_delivery_summaries(ARRAY[batch::text])));
  -- cannot confirm delivery for someone else's row
  PERFORM pg_temp.expect('8: cannot ack another recipient''s message',
    COALESCE(cardinality(others), 0) = 0 OR ack_message_delivery(others) = 0);
  -- cannot forge delivery fields on own row
  UPDATE teacher_messages SET delivered_at = '2000-01-01', read_at = '2000-01-01', sent_at = '2000-01-01'
   WHERE batch_id = batch AND recipient_id = students[2];
  PERFORM pg_temp.expect('8: direct writes to delivered_at / read_at / sent_at are ignored',
    (SELECT COALESCE(delivered_at, now()) > '2001-01-01' AND COALESCE(read_at, now()) > '2001-01-01' AND sent_at > '2001-01-01'
       FROM teacher_messages WHERE batch_id = batch AND recipient_id = students[2]));
  -- a sender cannot forge "Read" on the recipients' behalf
  PERFORM pg_temp.act_as(admin_id);
  UPDATE teacher_messages SET is_read = true WHERE batch_id = batch AND recipient_id = victim;
  PERFORM pg_temp.act_as_admin_db();
  PERFORM pg_temp.expect('8: sender cannot mark a recipient''s message Read',
    (SELECT delivery_status <> 'read' AND NOT is_read AND read_at IS NULL FROM teacher_messages WHERE batch_id = batch AND recipient_id = victim));
  -- anonymous / signed-out callers get nothing
  PERFORM pg_temp.expect('8: anon role has no EXECUTE on the report functions',
    NOT has_function_privilege('anon', 'public.get_message_delivery_report(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.ack_message_delivery(uuid[])', 'EXECUTE'));

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
