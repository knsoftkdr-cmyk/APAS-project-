-- Functional, permission and exactly-once tests for Scheduled Messages. Any failed assertion aborts the run.
\set ON_ERROR_STOP 1
SET client_min_messages = notice;

CREATE FUNCTION tests.r(n int, role text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id', tests.id(n), 'role', role)
$$;
CREATE TABLE tests.ctx (k text PRIMARY KEY, val uuid);
GRANT ALL ON tests.ctx TO PUBLIC;

-- ═══ 1. WHO MAY SCHEDULE, AND TO WHOM ═══════════════════════════════════════════════════════════════
DO $$
DECLARE v uuid;
BEGIN
  -- Roles with no composer cannot schedule at all
  PERFORM tests.login(tests.id(30));  -- parent
  PERFORM tests.fails('parent cannot schedule',
    format($q$SELECT schedule_message('hi', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher')))$q$),
    '42501');
  PERFORM tests.login(tests.id(20));  -- student
  PERFORM tests.fails('student cannot schedule',
    format($q$SELECT schedule_message('hi', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher')))$q$),
    '42501');
  PERFORM tests.login(tests.id(40));  -- driver
  PERFORM tests.fails('driver cannot schedule',
    format($q$SELECT schedule_message('hi', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher')))$q$),
    '42501');
  PERFORM tests.root(); RESET ROLE;
  SET ROLE anon;
  PERFORM tests.fails('anonymous cannot call schedule_message',
    $q$SELECT schedule_message('hi', now() + interval '1 hour', '[]'::jsonb)$q$, '42501');
  RESET ROLE;

  -- Admin-type roles: teacher / parent / student / driver of their own school
  PERFORM tests.login(tests.id(1));
  v := schedule_message('Staff meeting at 4pm', now() + interval '2 hours',
        jsonb_build_array(tests.r(10,'teacher'), tests.r(11,'teacher'), tests.r(30,'parent'), tests.r(20,'student'), tests.r(40,'driver')),
        'general', NULL, NULL, 'Mixed audience');
  PERFORM tests.ok(v IS NOT NULL, 'admin can schedule to teacher+parent+student+driver of own school');
  PERFORM tests.ok((SELECT recipient_count FROM scheduled_messages WHERE id = v) = 5, 'recipient_count stored');
  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = v) = 'scheduled', 'new message starts as scheduled');
  PERFORM tests.ok((SELECT sender_role FROM scheduled_messages WHERE id = v) = 'admin', 'sender role captured server-side');

  PERFORM tests.login(tests.id(2));  -- principal
  PERFORM tests.ok(schedule_message('p', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher'))) IS NOT NULL, 'principal can schedule');
  PERFORM tests.login(tests.id(3));  -- hod
  PERFORM tests.ok(schedule_message('h', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher'))) IS NOT NULL, 'hod can schedule');

  PERFORM tests.login(tests.id(1));
  PERFORM tests.fails('admin cannot schedule to another school''s student',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(51,'student')))$q$, '42501');
  PERFORM tests.fails('admin cannot mislabel a recipient role',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(20,'teacher')))$q$, '42501');
  PERFORM tests.fails('admin cannot schedule to a fabricated user id',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(999,'student')))$q$, '42501');
  PERFORM tests.fails('admin cannot schedule to self',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(1,'teacher')))$q$, NULL, '%yourself%');
  PERFORM tests.fails('admin cannot target role "admin"',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(2,'admin')))$q$, NULL, '%teachers, parents, students or drivers%');

  -- Teacher: own class students, their parents, administrators
  PERFORM tests.login(tests.id(10));
  v := schedule_message('Homework reminder', now() + interval '1 hour',
        jsonb_build_array(tests.r(20,'student'), tests.r(21,'student'), tests.r(30,'parent'), tests.r(1,'admin')),
        'general', NULL, NULL, 'Class 5 - A');
  PERFORM tests.ok(v IS NOT NULL, 'teacher can schedule to own-class students, their parents and an administrator');
  PERFORM tests.fails('teacher cannot schedule to a student of another teacher''s class',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(22,'student')))$q$, '42501');
  PERFORM tests.fails('teacher cannot schedule to a parent with no child in their classes',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(31,'parent')))$q$, '42501');
  PERFORM tests.fails('teacher cannot schedule to an unlinked parent',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(32,'parent')))$q$, '42501');
  PERFORM tests.fails('teacher cannot schedule to another teacher',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(11,'teacher')))$q$, NULL, '%parents, students or administrators%');
  PERFORM tests.fails('teacher cannot schedule to another school''s admin',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(50,'admin')))$q$, '42501');
  PERFORM tests.fails('teacher cannot use a student as an "admin" recipient',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(20,'admin')))$q$, '42501');
  PERFORM tests.fails('one bad recipient rejects the whole message',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(20,'student'), tests.r(22,'student')))$q$, '42501');

  -- Input validation
  PERFORM tests.login(tests.id(1));
  PERFORM tests.fails('past time rejected',
    $q$SELECT schedule_message('x', now() - interval '1 minute', jsonb_build_array(tests.r(10,'teacher')))$q$, NULL, '%future%');
  PERFORM tests.fails('"now" rejected',
    $q$SELECT schedule_message('x', now(), jsonb_build_array(tests.r(10,'teacher')))$q$, NULL, '%future%');
  PERFORM tests.fails('more than a year ahead rejected',
    $q$SELECT schedule_message('x', now() + interval '400 days', jsonb_build_array(tests.r(10,'teacher')))$q$, NULL, '%one year%');
  PERFORM tests.fails('null time rejected',
    $q$SELECT schedule_message('x', NULL, jsonb_build_array(tests.r(10,'teacher')))$q$, NULL, '%future%');
  PERFORM tests.fails('empty message without attachment rejected',
    $q$SELECT schedule_message('   ', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher')))$q$, NULL, '%Write a message%');
  PERFORM tests.fails('over-long message rejected',
    $q$SELECT schedule_message(repeat('a', 4001), now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher')))$q$, NULL, '%too long%');
  PERFORM tests.fails('empty recipients rejected',
    $q$SELECT schedule_message('x', now() + interval '1 hour', '[]'::jsonb)$q$, NULL, '%at least one recipient%');
  PERFORM tests.fails('null recipients rejected',
    $q$SELECT schedule_message('x', now() + interval '1 hour', NULL)$q$, NULL, '%at least one recipient%');
  PERFORM tests.fails('non-array recipients rejected',
    $q$SELECT schedule_message('x', now() + interval '1 hour', '{"id":"x"}'::jsonb)$q$, NULL, '%at least one recipient%');
  PERFORM tests.fails('malformed recipient id rejected',
    $q$SELECT schedule_message('x', now() + interval '1 hour', '[{"id":"not-a-uuid","role":"teacher"}]'::jsonb)$q$, NULL, '%malformed%');
  PERFORM tests.fails('meeting_request type is not schedulable',
    $q$SELECT schedule_message('x', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher')), 'meeting_request')$q$, NULL, '%Unsupported message type%');

  -- Attachment-only message is allowed and gets the same placeholder text a live send uses
  v := schedule_message('', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher')), 'general', 'https://x/y.pdf', 'y.pdf');
  PERFORM tests.ok((SELECT message FROM scheduled_messages WHERE id = v) = '📎 Attachment', 'attachment-only message accepted');

  -- Duplicates in the recipient list collapse to one record per person
  v := schedule_message('dup', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher'), tests.r(10,'teacher')));
  PERFORM tests.ok((SELECT count(*) FROM scheduled_message_recipients WHERE scheduled_message_id = v) = 1, 'duplicate recipients collapse');
  PERFORM tests.ok((SELECT recipient_count FROM scheduled_messages WHERE id = v) = 1, 'recipient_count reflects de-duplication');
  PERFORM tests.root();
END $$;

-- ═══ 2. RLS: READ-ONLY TABLES, SENDER / SCHOOL-ADMIN VISIBILITY ═════════════════════════════════════
DO $$
DECLARE tid uuid; aid uuid; n int;
BEGIN
  PERFORM tests.login(tests.id(10));
  tid := schedule_message('RLS teacher msg', now() + interval '1 day', jsonb_build_array(tests.r(20,'student')));
  PERFORM tests.login(tests.id(1));
  aid := schedule_message('RLS admin msg', now() + interval '1 day', jsonb_build_array(tests.r(10,'teacher')));
  INSERT INTO tests.ctx VALUES ('rls_teacher', tid), ('rls_admin', aid);

  PERFORM tests.login(tests.id(10));
  PERFORM tests.ok(EXISTS (SELECT 1 FROM scheduled_messages WHERE id = tid), 'sender sees own scheduled message');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_messages WHERE id = aid), 'teacher does not see an admin''s scheduled message');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_message_recipients WHERE scheduled_message_id = aid), 'teacher does not see another message''s recipients');

  PERFORM tests.login(tests.id(11));  -- other teacher, same school
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_messages WHERE id = tid), 'another teacher cannot see it');

  PERFORM tests.login(tests.id(1));   -- admin sees every message of their school
  PERFORM tests.ok(EXISTS (SELECT 1 FROM scheduled_messages WHERE id = tid), 'school admin sees a teacher''s scheduled message (moderation)');
  PERFORM tests.ok(EXISTS (SELECT 1 FROM scheduled_message_recipients WHERE scheduled_message_id = tid), 'school admin sees its recipients');

  PERFORM tests.login(tests.id(3));   -- hod is NOT a moderator
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_messages WHERE id = tid), 'hod cannot see other people''s scheduled messages');

  PERFORM tests.login(tests.id(50));  -- admin of another school
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_messages), 'admin of another school sees nothing');

  PERFORM tests.login(tests.id(30));  -- a parent / recipient
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_messages), 'a recipient cannot see the scheduled message before it is sent');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_message_recipients), 'a recipient cannot see recipient lists');

  -- Clients cannot write the tables directly; only the RPCs can.
  PERFORM tests.login(tests.id(10));
  PERFORM tests.fails('direct INSERT is denied',
    format($q$INSERT INTO scheduled_messages (school_id, sender_id, sender_role, message, scheduled_for) VALUES (%L, %L, 'teacher', 'x', now() + interval '1 day')$q$, tests.id(1000), tests.id(10)), '42501');
  PERFORM tests.fails('direct UPDATE (e.g. forcing status) is denied',
    format($q$UPDATE scheduled_messages SET status = 'sent' WHERE id = %L$q$, tid), '42501');
  PERFORM tests.fails('direct DELETE is denied',
    format($q$DELETE FROM scheduled_messages WHERE id = %L$q$, tid), '42501');
  PERFORM tests.fails('direct recipient INSERT is denied',
    format($q$INSERT INTO scheduled_message_recipients (scheduled_message_id, recipient_id, recipient_role) VALUES (%L, %L, 'student')$q$, tid, tests.id(21)), '42501');
  PERFORM tests.root();
END $$;

-- ═══ 3. EDIT BEFORE SENT ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v uuid; r public.scheduled_messages; t1 timestamptz := now() + interval '3 hours';
BEGIN
  PERFORM tests.login(tests.id(10));
  v := schedule_message('Original text', now() + interval '1 hour',
        jsonb_build_array(tests.r(20,'student'), tests.r(21,'student')), 'general', NULL, NULL, 'Class 5 - A');

  r := update_scheduled_message(v, p_message => 'Edited text');
  PERFORM tests.ok(r.message = 'Edited text' AND r.status = 'scheduled', 'sender can edit the text');

  r := update_scheduled_message(v, p_scheduled_for => t1);
  PERFORM tests.ok(r.scheduled_for = t1, 'sender can reschedule');
  PERFORM tests.ok(r.message = 'Edited text', 'rescheduling alone keeps the text');

  r := update_scheduled_message(v, p_recipients => jsonb_build_array(tests.r(20,'student')));
  PERFORM tests.ok(r.recipient_count = 1 AND (SELECT count(*) FROM scheduled_message_recipients WHERE scheduled_message_id = v) = 1, 'sender can remove a recipient');

  PERFORM tests.fails('edit cannot add a recipient outside the sender''s scope',
    format($q$SELECT update_scheduled_message(%L, p_recipients => jsonb_build_array(tests.r(22,'student')))$q$, v), '42501');
  PERFORM tests.ok((SELECT count(*) FROM scheduled_message_recipients WHERE scheduled_message_id = v) = 1, 'a rejected edit changes nothing (recipients intact)');

  r := update_scheduled_message(v, p_attachment_url => 'https://x/a.png', p_attachment_name => 'a.png');
  PERFORM tests.ok(r.attachment_url = 'https://x/a.png', 'attachment can be added');
  r := update_scheduled_message(v, p_clear_attachment => true);
  PERFORM tests.ok(r.attachment_url IS NULL AND r.attachment_name IS NULL, 'attachment can be removed');

  PERFORM tests.fails('edit to a past time rejected',
    format($q$SELECT update_scheduled_message(%L, p_scheduled_for => now() - interval '1 minute')$q$, v), NULL, '%future%');
  PERFORM tests.fails('edit to an empty message rejected',
    format($q$SELECT update_scheduled_message(%L, p_message => '  ')$q$, v), NULL, '%Write a message%');
  PERFORM tests.fails('edit with no recipients rejected',
    format($q$SELECT update_scheduled_message(%L, p_recipients => '[]'::jsonb)$q$, v), NULL, '%at least one recipient%');

  PERFORM tests.login(tests.id(11));
  PERFORM tests.fails('another teacher cannot edit it',
    format($q$SELECT update_scheduled_message(%L, p_message => 'hijack')$q$, v), '42501');
  PERFORM tests.login(tests.id(1));
  PERFORM tests.fails('even a school admin cannot edit someone else''s message (cancel only)',
    format($q$SELECT update_scheduled_message(%L, p_message => 'hijack')$q$, v), '42501');
  PERFORM tests.ok((SELECT message FROM scheduled_messages WHERE id = v) = 'Edited text', 'text unchanged by rejected edits');

  -- Editing a cancelled message is refused
  PERFORM tests.login(tests.id(10));
  PERFORM cancel_scheduled_message(v);
  PERFORM tests.fails('cannot edit a cancelled message',
    format($q$SELECT update_scheduled_message(%L, p_message => 'late edit')$q$, v), NULL, '%already cancelled%');
  PERFORM tests.root();
END $$;

-- ═══ 4. CANCEL BEFORE SENT ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v uuid; v2 uuid; v3 uuid;
BEGIN
  PERFORM tests.login(tests.id(10));
  v := schedule_message('To be cancelled', now() + interval '1 hour', jsonb_build_array(tests.r(20,'student')));
  PERFORM tests.login(tests.id(11));
  PERFORM tests.fails('another teacher cannot cancel it',
    format($q$SELECT cancel_scheduled_message(%L)$q$, v), '42501');
  PERFORM tests.login(tests.id(50));
  PERFORM tests.fails('admin of another school cannot cancel it',
    format($q$SELECT cancel_scheduled_message(%L)$q$, v), '42501');
  PERFORM tests.login(tests.id(3));
  PERFORM tests.fails('hod cannot cancel someone else''s message',
    format($q$SELECT cancel_scheduled_message(%L)$q$, v), '42501');

  PERFORM tests.login(tests.id(10));
  PERFORM tests.ok(cancel_scheduled_message(v) = true, 'sender can cancel');
  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = v) = 'cancelled', 'status is cancelled');
  PERFORM tests.ok((SELECT cancelled_at IS NOT NULL AND cancelled_by = tests.id(10) FROM scheduled_messages WHERE id = v), 'cancelled_at / cancelled_by recorded');
  PERFORM tests.ok(cancel_scheduled_message(v) = false, 'cancelling twice is an idempotent no-op');

  -- School admin can cancel a teacher's message in their school
  v2 := schedule_message('Moderated', now() + interval '1 hour', jsonb_build_array(tests.r(20,'student')));
  PERFORM tests.login(tests.id(1));
  PERFORM tests.ok(cancel_scheduled_message(v2) = true, 'school admin can cancel a teacher''s scheduled message');

  -- A cancelled message is never delivered, even long after it was due
  PERFORM tests.login(tests.id(10));
  v3 := schedule_message('Cancelled but due', now() + interval '1 hour', jsonb_build_array(tests.r(20,'student')));
  PERFORM cancel_scheduled_message(v3);
  PERFORM tests.root();
  UPDATE scheduled_messages SET scheduled_for = now() - interval '1 hour' WHERE id IN (v, v2, v3);
  PERFORM tests.service();
  PERFORM process_due_scheduled_messages(100);
  PERFORM process_due_scheduled_messages(100);
  PERFORM tests.root();
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM teacher_messages WHERE scheduled_message_id IN (v, v2, v3)), 'cancelled messages are never delivered');
  PERFORM tests.ok((SELECT count(*) FROM scheduled_messages WHERE id IN (v, v2, v3) AND status = 'cancelled') = 3, 'cancelled messages stay cancelled');
END $$;

-- ═══ 5. DELIVERY THROUGH THE EXISTING MESSAGING PIPELINE ═══════════════════════════════════════════
DO $$
DECLARE single_id uuid; bcast uuid; future_id uuid; res record; n int;
BEGIN
  PERFORM tests.login(tests.id(10));
  single_id := schedule_message('Single scheduled', now() + interval '1 hour', jsonb_build_array(tests.r(20,'student')), 'appreciation');
  bcast     := schedule_message('Broadcast scheduled', now() + interval '1 hour',
                 jsonb_build_array(tests.r(20,'student'), tests.r(21,'student'), tests.r(30,'parent')), 'general', NULL, NULL, 'Class 5 - A');
  future_id := schedule_message('Not due yet', now() + interval '5 days', jsonb_build_array(tests.r(20,'student')));
  INSERT INTO tests.ctx VALUES ('single', single_id), ('bcast', bcast), ('future', future_id);

  -- authenticated clients may not run the worker
  PERFORM tests.fails('authenticated user cannot run the worker', $q$SELECT * FROM process_due_scheduled_messages(10)$q$, '42501');

  PERFORM tests.root();
  UPDATE scheduled_messages SET scheduled_for = now() - interval '30 seconds' WHERE id IN (single_id, bcast);

  PERFORM tests.service();
  SELECT count(*) INTO n FROM process_due_scheduled_messages(100);
  PERFORM tests.ok(n = 2, 'worker processed exactly the two due messages');
  PERFORM tests.root();

  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = single_id) = 'sent', 'single: status sent');
  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = bcast) = 'sent', 'broadcast: status sent');
  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = future_id) = 'scheduled', 'a message in the future is left alone');
  PERFORM tests.ok((SELECT sent_at IS NOT NULL FROM scheduled_messages WHERE id = single_id), 'sent_at recorded');

  -- Ordinary teacher_messages rows, exactly like a live send
  PERFORM tests.ok((SELECT count(*) FROM teacher_messages WHERE scheduled_message_id = single_id) = 1, 'single: one teacher_messages row');
  PERFORM tests.ok((SELECT count(*) FROM teacher_messages WHERE scheduled_message_id = bcast) = 3, 'broadcast: one row per recipient');
  PERFORM tests.ok((SELECT batch_id IS NULL AND broadcast_label IS NULL FROM teacher_messages WHERE scheduled_message_id = single_id),
                   'single recipient behaves like a direct message (no batch)');
  PERFORM tests.ok((SELECT count(DISTINCT batch_id) = 1 AND bool_and(broadcast_label = 'Class 5 - A') AND bool_and(batch_id = (SELECT sm.batch_id FROM scheduled_messages sm WHERE sm.id = bcast))
                      FROM teacher_messages WHERE scheduled_message_id = bcast), 'broadcast rows share one batch_id and the audience label');
  PERFORM tests.ok((SELECT bool_and(sender_id = tests.id(10) AND school_id = tests.id(1000) AND message = 'Broadcast scheduled')
                      FROM teacher_messages WHERE scheduled_message_id = bcast), 'rows carry the original sender, school and text');
  PERFORM tests.ok((SELECT message_type FROM teacher_messages WHERE scheduled_message_id = single_id) = 'appreciation', 'message type preserved');
  PERFORM tests.ok((SELECT recipient_role FROM teacher_messages WHERE scheduled_message_id = bcast AND recipient_id = tests.id(30)) = 'parent', 'recipient role preserved');

  -- Existing delivery tracking (20261105) applies to scheduled rows unchanged
  PERFORM tests.ok((SELECT bool_and(delivery_status = 'pending' AND NOT is_read AND delivered_at IS NULL AND sent_at IS NOT NULL)
                      FROM teacher_messages WHERE scheduled_message_id = bcast), 'delivered rows start Pending with sent_at stamped (existing tracking)');
  PERFORM tests.login(tests.id(20));
  PERFORM tests.ok(ack_message_delivery(ARRAY(SELECT id FROM teacher_messages WHERE scheduled_message_id = bcast AND recipient_id = tests.id(20))) = 1,
                   'recipient client ack moves it to Delivered (existing ack_message_delivery)');
  UPDATE teacher_messages SET is_read = true WHERE scheduled_message_id = bcast AND recipient_id = tests.id(20);
  PERFORM tests.root();
  PERFORM tests.ok((SELECT delivery_status FROM teacher_messages WHERE scheduled_message_id = bcast AND recipient_id = tests.id(20)) = 'read', 'opening it marks it Read (existing behaviour)');
  PERFORM tests.login(tests.id(10));
  SELECT * INTO res FROM get_message_delivery_summaries(ARRAY[(SELECT sm.batch_id::text FROM public.scheduled_messages sm WHERE sm.id = bcast)]);
  PERFORM tests.ok(res.total_recipients = 3 AND res.read_count = 1 AND res.pending_count = 2, 'existing sender delivery report works on a scheduled broadcast');

  -- The recipient receives it through the normal inbox query
  PERFORM tests.login(tests.id(21));
  PERFORM tests.ok((SELECT count(*) FROM teacher_messages WHERE recipient_id = tests.id(21) AND message = 'Broadcast scheduled') = 1, 'recipient sees the message via the normal inbox query');

  -- The sender is notified through the existing notification table
  PERFORM tests.root();
  PERFORM tests.ok((SELECT count(*) FROM governance_notifications WHERE user_id = tests.id(10) AND event_type = 'scheduled_message_sent' AND reference_id = bcast) = 1,
                   'sender gets one "scheduled message sent" notification');

  -- Once sent, edit and cancel are refused
  PERFORM tests.login(tests.id(10));
  PERFORM tests.fails('sent message cannot be edited', format($q$SELECT update_scheduled_message(%L, p_message => 'too late')$q$, bcast), NULL, '%already sent%');
  PERFORM tests.fails('sent message cannot be cancelled', format($q$SELECT cancel_scheduled_message(%L)$q$, bcast), NULL, '%already sent%');
  PERFORM tests.root();
END $$;

-- ═══ 6. EXACTLY ONCE: RETRIES, FAILURES, OVERLAP ════════════════════════════════════════════════════
-- Failure injection: a trigger that fails the SECOND insert of a message whose text is 'BOOM' while the flag is on.
CREATE TABLE tests.flags (k text PRIMARY KEY, v int);
INSERT INTO tests.flags VALUES ('boom', 1);
GRANT ALL ON tests.flags TO PUBLIC;
CREATE FUNCTION tests.boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.message = 'BOOM' AND (SELECT v FROM tests.flags WHERE k = 'boom') = 1 THEN
    UPDATE tests.flags SET v = v WHERE k = 'boom';
    IF (SELECT count(*) FROM public.teacher_messages WHERE message = 'BOOM') >= 1 THEN
      RAISE EXCEPTION 'injected failure after a partial insert';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tests_boom BEFORE INSERT ON public.teacher_messages FOR EACH ROW EXECUTE FUNCTION tests.boom();

DO $$
DECLARE v uuid; ok_id uuid; n int; before_cnt int;
BEGIN
  -- 6a. Running the worker over and over delivers a message exactly once
  SELECT val INTO v FROM tests.ctx WHERE k = 'bcast';
  PERFORM tests.service();
  FOR i IN 1..5 LOOP PERFORM process_due_scheduled_messages(100); END LOOP;
  PERFORM tests.root();
  PERFORM tests.ok((SELECT count(*) FROM teacher_messages WHERE scheduled_message_id = v) = 3, 'repeated worker runs do not re-send an already sent message');
  PERFORM tests.ok((SELECT attempts FROM scheduled_messages WHERE id = v) = 1, 'a sent message is not even re-attempted');

  -- 6b. Hard guard: even a buggy second writer cannot add a duplicate row
  PERFORM tests.fails('unique index blocks a duplicate (scheduled message, recipient) row',
    format($q$INSERT INTO teacher_messages (school_id, sender_id, recipient_id, recipient_role, message, scheduled_message_id)
              VALUES (%L, %L, %L, 'student', 'dup', %L)$q$, tests.id(1000), tests.id(10), tests.id(21), v), '23505');
  PERFORM tests.ok((SELECT scheduled_message_row_id(v, tests.id(21))) = (SELECT id FROM teacher_messages WHERE scheduled_message_id = v AND recipient_id = tests.id(21)),
                   'row ids are deterministic per (message, recipient)');

  -- 6c. A failure half-way through rolls EVERYTHING back (no partial send), then a retry delivers exactly once
  PERFORM tests.login(tests.id(1));
  v := schedule_message('BOOM', now() + interval '1 hour',
         jsonb_build_array(tests.r(10,'teacher'), tests.r(11,'teacher'), tests.r(30,'parent'), tests.r(20,'student')));
  PERFORM tests.root();
  UPDATE scheduled_messages SET scheduled_for = now() - interval '1 minute' WHERE id = v;
  PERFORM tests.service();
  PERFORM process_due_scheduled_messages(100);
  PERFORM tests.root();
  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = v) = 'scheduled', 'failed delivery leaves the message scheduled for retry');
  PERFORM tests.ok((SELECT attempts FROM scheduled_messages WHERE id = v) = 1 AND (SELECT last_error FROM scheduled_messages WHERE id = v) ILIKE '%injected failure%',
                   'failure recorded (attempts + last_error)');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM teacher_messages WHERE scheduled_message_id = v), 'no partial rows survive a failed attempt (atomic)');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_message_recipients WHERE scheduled_message_id = v AND message_id IS NOT NULL), 'recipient links rolled back too');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM governance_notifications WHERE reference_id = v), 'no "sent" notification for a failed attempt');

  UPDATE tests.flags SET v = 0 WHERE k = 'boom';      -- the underlying problem is fixed
  PERFORM tests.service();
  PERFORM process_due_scheduled_messages(100);        -- the retry
  PERFORM process_due_scheduled_messages(100);        -- and a redundant retry
  PERFORM tests.root();
  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = v) = 'sent', 'retry delivers the message');
  PERFORM tests.ok((SELECT count(*) FROM teacher_messages WHERE scheduled_message_id = v) = 4, 'retry sends to each recipient exactly once');
  PERFORM tests.ok((SELECT count(DISTINCT recipient_id) FROM teacher_messages WHERE scheduled_message_id = v) = 4, 'no recipient received it twice');
  PERFORM tests.ok((SELECT count(*) FROM governance_notifications WHERE reference_id = v AND event_type = 'scheduled_message_sent') = 1, 'exactly one sender notification');

  -- 6d. A persistently failing message gives up after 5 attempts and never blocks others
  UPDATE tests.flags SET v = 1 WHERE k = 'boom';
  DELETE FROM teacher_messages WHERE message = 'BOOM';   -- so the trigger's "second insert" rule starts fresh
  PERFORM tests.login(tests.id(1));
  v := schedule_message('BOOM', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher'), tests.r(11,'teacher')));
  ok_id := schedule_message('Healthy neighbour', now() + interval '1 hour', jsonb_build_array(tests.r(10,'teacher')));
  PERFORM tests.root();
  UPDATE scheduled_messages SET scheduled_for = now() - interval '1 minute' WHERE id IN (v, ok_id);
  -- A pre-existing BOOM row makes the injected failure trigger on the FIRST row of the doomed message
  PERFORM tests.root();
  ALTER TABLE teacher_messages DISABLE TRIGGER tests_boom;
  INSERT INTO teacher_messages (school_id, sender_id, recipient_id, recipient_role, message) VALUES (tests.id(1000), tests.id(1), tests.id(32), 'parent', 'BOOM');
  ALTER TABLE teacher_messages ENABLE TRIGGER tests_boom;
  PERFORM tests.service();
  FOR i IN 1..6 LOOP PERFORM process_due_scheduled_messages(100); END LOOP;
  PERFORM tests.root();
  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = ok_id) = 'sent' AND (SELECT count(*) FROM teacher_messages WHERE scheduled_message_id = ok_id) = 1,
                   'one failing message does not block a healthy one in the same run');
  PERFORM tests.ok((SELECT status FROM scheduled_messages WHERE id = v) = 'failed', 'after 5 failed attempts the message is parked as failed');
  PERFORM tests.ok((SELECT attempts FROM scheduled_messages WHERE id = v) = 5, 'retry budget is exactly 5 attempts');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM teacher_messages WHERE scheduled_message_id = v), 'a failed message sent nothing');
  PERFORM tests.ok((SELECT count(*) FROM governance_notifications WHERE reference_id = v AND event_type = 'scheduled_message_failed') = 1, 'sender told once that it failed');
  PERFORM tests.service();
  FOR i IN 1..3 LOOP PERFORM process_due_scheduled_messages(100); END LOOP;
  PERFORM tests.root();
  PERFORM tests.ok((SELECT attempts FROM scheduled_messages WHERE id = v) = 5, 'a failed message is not retried forever');
  UPDATE tests.flags SET v = 0 WHERE k = 'boom';
END $$;

-- ═══ 7. PUSH / EMAIL HAND-OFF: AT MOST ONCE PER RECIPIENT ═══════════════════════════════════════════
DO $$
DECLARE v uuid; n1 int; n2 int; n3 int; bcast uuid; future_id uuid; first_batch uuid[];
BEGIN
  SELECT val INTO bcast FROM tests.ctx WHERE k = 'bcast';
  SELECT val INTO future_id FROM tests.ctx WHERE k = 'future';

  PERFORM tests.login(tests.id(10));
  PERFORM tests.fails('authenticated user cannot claim dispatches', $q$SELECT * FROM claim_scheduled_dispatches(10)$q$, '42501');
  PERFORM tests.service();

  SELECT count(*) INTO n1 FROM claim_scheduled_dispatches(1000) c WHERE c.scheduled_message_id = bcast;
  PERFORM tests.ok(n1 = 3, 'first claim returns every recipient of the sent broadcast');
  SELECT count(*) INTO n2 FROM claim_scheduled_dispatches(1000) c WHERE c.scheduled_message_id = bcast;
  PERFORM tests.ok(n2 = 0, 'a retried claim returns nothing for already-claimed recipients (no double push)');
  PERFORM tests.root();
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_message_recipients r JOIN scheduled_messages m ON m.id = r.scheduled_message_id
                                WHERE m.status <> 'sent' AND r.dispatched_at IS NOT NULL), 'only SENT messages are ever handed to push/email');
  PERFORM tests.ok(NOT EXISTS (SELECT 1 FROM scheduled_message_recipients WHERE scheduled_message_id = future_id AND dispatched_at IS NOT NULL), 'a still-scheduled message is never dispatched');
  PERFORM tests.service();
  PERFORM record_scheduled_dispatch_error(scheduled_message_row_id(bcast, tests.id(30)), 'fcm: no active device');
  PERFORM tests.root();
  PERFORM tests.ok((SELECT dispatch_error FROM scheduled_message_recipients WHERE scheduled_message_id = bcast AND recipient_id = tests.id(30)) = 'fcm: no active device', 'dispatch failure is recorded');
  PERFORM tests.ok((SELECT dispatched_at IS NOT NULL FROM scheduled_message_recipients WHERE scheduled_message_id = bcast AND recipient_id = tests.id(30)), 'a failed dispatch is not retried (claim stays)');
END $$;

-- ═══ 8. EXISTING MESSAGING IS UNAFFECTED ════════════════════════════════════════════════════════════
DO $$
DECLARE id1 uuid := gen_random_uuid(); id2 uuid := gen_random_uuid(); b uuid := gen_random_uuid();
BEGIN
  -- A live direct send exactly as TeacherCommunicationCenter does it
  PERFORM tests.login(tests.id(10));
  INSERT INTO teacher_messages (id, school_id, sender_id, recipient_id, recipient_role, message, message_type)
  VALUES (id1, tests.id(1000), tests.id(10), tests.id(20), 'student', 'live direct', 'general');
  -- A live broadcast: several rows with NULL scheduled_message_id must not collide on the new unique index
  INSERT INTO teacher_messages (id, school_id, sender_id, recipient_id, recipient_role, message, batch_id, broadcast_label)
  VALUES (id2, tests.id(1000), tests.id(10), tests.id(21), 'student', 'live bcast', b, 'Class 5 - A'),
         (gen_random_uuid(), tests.id(1000), tests.id(10), tests.id(20), 'student', 'live bcast', b, 'Class 5 - A'),
         (gen_random_uuid(), tests.id(1000), tests.id(10), tests.id(30), 'parent',  'live bcast', b, 'Class 5 - A');
  PERFORM tests.ok((SELECT count(*) FROM teacher_messages WHERE batch_id = b) = 3, 'live broadcasts still insert normally');
  PERFORM tests.ok((SELECT scheduled_message_id IS NULL FROM teacher_messages WHERE id = id1), 'live messages have no scheduled_message_id');
  PERFORM tests.ok((SELECT sent_at IS NOT NULL AND delivery_status = 'pending' FROM teacher_messages WHERE id = id1), 'live messages still get sent_at + Pending');
  PERFORM tests.login(tests.id(20));
  PERFORM tests.ok(ack_message_delivery(ARRAY[id1]) = 1, 'live delivery ack still works');
  UPDATE teacher_messages SET is_read = true WHERE id = id1;
  PERFORM tests.ok((SELECT delivery_status FROM teacher_messages WHERE id = id1) = 'read', 'live read tracking still works');
  PERFORM tests.login(tests.id(10));
  INSERT INTO teacher_messages (id, school_id, sender_id, recipient_id, recipient_role, message, delivered_at, read_at)
  VALUES (gen_random_uuid(), tests.id(1000), tests.id(10), tests.id(20), 'student', 'forge attempt', now(), now())
  RETURNING id INTO id2;
  PERFORM tests.ok((SELECT delivered_at IS NULL AND read_at IS NULL AND delivery_status = 'pending' FROM teacher_messages WHERE id = id2),
                   'existing guard still stops a client forging delivered/read on insert');
  PERFORM tests.root();
  PERFORM tests.ok((SELECT count(*) FROM governance_notifications WHERE event_type NOT IN ('scheduled_message_sent', 'scheduled_message_failed')) = 0, 'no stray notifications created for other event types');
END $$;

-- Migration is re-runnable and leaves exactly one copy of each object
SELECT tests.ok((SELECT count(*) FROM pg_proc WHERE proname = 'process_due_scheduled_messages') = 1, 'worker function exists once');
SELECT tests.ok((SELECT count(*) FROM pg_indexes WHERE indexname = 'teacher_messages_scheduled_once_idx') = 1, 'duplicate-guard index exists once');
SELECT tests.ok((SELECT count(*) FROM pg_policies WHERE tablename = 'scheduled_messages') = 1, 'RLS policy exists once after re-running the migration');
