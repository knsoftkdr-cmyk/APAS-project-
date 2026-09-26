-- ============================================================================
-- ADAPTIVE QUESTION DIFFICULTY, EVERYWHERE (module 17)
--
-- Not a new engine. Module 4 (CAT) already re-estimates ability after every
-- answer and serves the next item nearest that ability (Fisher-information
-- selection over question_bank's IRT parameters) - that behaviour already
-- *is* "question difficulty changes dynamically while the student is
-- answering". What was missing was a way to get that same live adjustment
-- inside a short, everyday practice round (Adaptive Homework, Worksheets,
-- AI Tutor) instead of only the dedicated, precision-targeted CAT test.
--
-- So this migration adds exactly one thing: a `mode` on cat_sessions.
--   'assessment' (existing behaviour, default) - stops when the ability
--                estimate is precise enough (se <= se_target), reports a
--                scaled score/band, meant to be taken occasionally.
--   'practice'   - the calling surface sets min_items = max_items (a short
--                fixed length, e.g. 5), so evaluateStopping() - unchanged -
--                naturally runs exactly that many items with difficulty
--                still adapting every single answer, then stops. No new
--                stopping logic needed; two existing conditions already
--                compose into this.
--
-- `source` records which surface launched a practice round, purely for
-- later analytics (e.g. "students practice more from homework than from
-- worksheets"); nothing reads it to change behaviour.
-- ============================================================================

ALTER TABLE public.cat_sessions ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'assessment'
  CHECK (mode IN ('assessment','practice'));
ALTER TABLE public.cat_sessions ADD COLUMN IF NOT EXISTS source text;

-- A formal test and a quick practice round on the same concept shouldn't
-- collide - split the "one live session" rule by mode.
DROP INDEX IF EXISTS uq_cat_one_live_session;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cat_one_live_session
  ON public.cat_sessions(student_id, scope_type, scope_id, mode) WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_cat_sessions_mode ON public.cat_sessions(student_id, mode, started_at DESC);
