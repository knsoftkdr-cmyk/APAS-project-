# Edge Function consolidation

The Supabase project hit its Edge Function deployment limit, so 25 features that
used to be standalone functions (24 from the original list + root-cause-analysis, which turned out to be undeployed too) are now served by functions that were already
deployed ("anchors"). No new function names exist and nothing new needs deploying.

* Feature logic lives in `_shared/handlers/*.ts` (each exports one `handleXxx(req)`;
  the code is the former function body, contract unchanged, own auth included).
* `_shared/mergedRouter.ts` forwards a request to a handler when the body's
  discriminator matches. Each anchor calls it right after CORS preflight; anything
  unmatched falls through to the anchor's original code, so old behavior is intact.
* The frontend sends the discriminator listed below. Call the ANCHOR, not the old name.

| Former function | Anchor (deployed) | Discriminator |
|---|---|---|
| get-forgetting-forecast | get-class-forgetting-risk | action: `student_forecast` |
| get-retention-curve | get-class-forgetting-risk | action: `retention_curve` |
| spaced-repetition | cat-session | action: `sr_forecast` `sr_due` `sr_session_start` `sr_session_answer` `sr_snooze` |
| learning-path | cat-session | action: `lp_generate` `lp_answer` |
| next-best-action | cat-session | action: `nba_get` |
| get-assessment-paper-attempt | cat-session | action: `paper_attempt` `paper_save_draft` |
| submit-assessment-paper-attempt | cat-session | action: `paper_submit` |
| get-learning-velocity | get-mastery-history | action: `student_velocity` |
| get-student-misconceptions | get-mastery-history | action: `student_misconceptions` |
| root-cause-analysis | get-mastery-history | action: `root_cause` |
| get-class-velocity | get-class-mastery | mode: `class_velocity` |
| get-class-misconception-hotspots | get-class-mastery | mode: `misconception_hotspots` |
| get-student-risk-profile | get-class-mastery | mode: `risk_profile` |
| get-class-risk-roster | get-class-mastery | mode: `risk_roster` |
| get-intervention-recommendations | get-class-mastery | mode: `intervention_recs` |
| get-intervention-effectiveness-summary | get-class-mastery | mode: `intervention_effectiveness` |
| adaptive-homework | update-mastery | action: `ah_generate` `ah_submit_answer` |
| generate-assessment-paper | evaluate-assessment | action: `generate_paper` (incl. `list_exam_patterns`) |
| assign-assessment-paper | evaluate-assessment | action: `assign_paper` |
| get-assessment-paper-full | evaluate-assessment | action: `get_paper_full` |
| grade-open-response | evaluate-assessment | action: `grade_open_response` `review_open_response` |
| generate-open-ended-items | generate-item-bank | action: `open_ended` |
| score-question-quality | generate-item-bank | action: `score_quality` |
| calibrate-open-ended-items | calibrate-irt | item_type: `open_ended` |
| calibrate-open-ended-items-cron | calibrate-irt-cron | job: `open_ended` (cron job repointed by migration 20261007000000) |

Notes
* `calibrate-irt-cron` must stay deployed with `--no-verify-jwt` (pg_net has no user JWT); the handler
  checks `x-cron-secret` itself.
* To add a feature later: write a handler in `_shared/handlers/`, add one entry to the anchor's
  `MERGED_ROUTES`. Do not add a function folder.
