SELECT tests.ok((SELECT status FROM scheduled_messages WHERE message = 'SLOW') = 'sent', 'concurrent workers: big message sent');
SELECT tests.ok((SELECT count(*) FROM teacher_messages WHERE message = 'SLOW') = 300, 'concurrent workers: exactly 300 rows (one per recipient, none doubled)');
SELECT tests.ok((SELECT count(DISTINCT recipient_id) FROM teacher_messages WHERE message = 'SLOW') = 300, 'concurrent workers: every recipient got it once');
SELECT tests.ok((SELECT attempts FROM scheduled_messages WHERE message = 'SLOW') = 1, 'concurrent workers: delivered in a single attempt (no worker repeated it)');
SELECT tests.ok((SELECT count(*) FROM teacher_messages WHERE message IN ('CONC-2', 'CONC-3')) = 4, 'concurrent workers: the small messages were each delivered once');
SELECT tests.ok((SELECT count(*) FROM governance_notifications WHERE event_type = 'scheduled_message_sent'
                  AND reference_id IN (SELECT id FROM scheduled_messages WHERE message IN ('SLOW','CONC-2','CONC-3'))) = 3,
                'concurrent workers: one sender notification per message');
SELECT tests.ok(:claimed_total = :claimed_unique, 'parallel push claims never overlap (no recipient handed out twice)');
SELECT tests.ok(:claimed_total = (SELECT count(*) FROM scheduled_message_recipients r JOIN scheduled_messages m ON m.id = r.scheduled_message_id
                                   WHERE m.message IN ('SLOW','CONC-2','CONC-3')),
                'parallel push claims together cover every recipient exactly once');
