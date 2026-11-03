Restores the original question-history behaviour (subjects from the class's textbooks in `books`).

1. Copy the 3 files here over the project (same paths).
2. DELETE src/test/gamificationAssignedSubjectsAndLanguage.test.ts (it tests the removed code and would fail).
3. Migration 20261031000000_gamification_concept_history.sql: if you already ran it, leave it - it is harmless.
   If you have not run it, do not run it.
4. Redeploy the update-mastery edge function.
