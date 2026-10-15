-- 20261020000000_exam_review_recompute.sql
--
-- Teacher review of written exam answers (Assessments hub -> "Exam Reviews").
--
-- sync_assessment_attempt_grade() used to stop as soon as an attempt was 'graded'. That is right for
-- the FIRST finalisation, but it meant that when a teacher later corrected a mark on an
-- already-graded attempt, the stored totals (total_score / open_ended_teacher_score) went stale
-- while the student's result screen - which is computed live - showed the new mark.
--
-- Same scoring as before (teacher_score is on the question's own max_marks scale, rescaled to the
-- marks the PAPER gives that slot and capped at the slot). The only change: an attempt that is
-- already graded is recomputed instead of skipped, and its original graded_at is kept.
-- The trigger itself (AFTER UPDATE OF status ON open_response_submissions) is unchanged.

CREATE OR REPLACE FUNCTION public.sync_assessment_attempt_grade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt RECORD;
  v_total int;
  v_reviewed int;
  v_teacher_sum numeric;
BEGIN
  IF NEW.source <> 'test' OR NEW.status <> 'teacher_reviewed' OR NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt FROM public.generated_assessment_paper_attempts WHERE id = NEW.source_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE s.status = 'teacher_reviewed'),
         COALESCE(sum(
           CASE WHEN s.status = 'teacher_reviewed'
                THEN LEAST(
                       COALESCE(s.teacher_score, 0) * COALESCE(pi.marks / NULLIF(q.max_marks, 0), 1),
                       COALESCE(pi.marks, q.max_marks))
           END), 0)
    INTO v_total, v_reviewed, v_teacher_sum
  FROM public.open_response_submissions s
  JOIN public.question_bank_extended q ON q.id = s.item_id
  LEFT JOIN public.generated_assessment_paper_assignments asg ON asg.id = v_attempt.assignment_id
  LEFT JOIN public.generated_assessment_paper_items pi
         ON pi.paper_id = asg.paper_id AND pi.extended_item_id = s.item_id
  WHERE s.source = 'test' AND s.source_id = NEW.source_id;

  IF v_total > 0 AND v_reviewed = v_total THEN
    UPDATE public.generated_assessment_paper_attempts
    SET open_ended_teacher_score = round(v_teacher_sum, 2),
        total_score = round(COALESCE(v_attempt.mcq_score, 0) + v_teacher_sum, 2),
        status = 'graded',
        graded_at = COALESCE(v_attempt.graded_at, now())
    WHERE id = NEW.source_id;
  END IF;

  RETURN NEW;
END;
$$;
