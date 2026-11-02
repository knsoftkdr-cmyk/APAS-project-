-- Retire AI-generated Gamification pool items that were saved for Nursery / LKG / UKG under the earlier, too-loose
-- difficulty rules (e.g. "simple machines", "floral print" questions). New, simpler items are generated on demand.
-- Safe to re-run. Only flips status; nothing is deleted, and student_question_history is untouched (what a child
-- has already been served stays recorded).
UPDATE public.gamification_question_pool
   SET status = 'retired'
 WHERE class_key IN ('nursery', 'lkg', 'ukg')
   AND source = 'ai'
   AND status = 'active';
