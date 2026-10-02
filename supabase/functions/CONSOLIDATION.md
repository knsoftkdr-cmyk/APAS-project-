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
| enrichment-generator (never standalone) | generate-item-bank | action: `enrichment` (needs migration 20261009000000) |
| practice-hint (never standalone) | cat-session | action: `practice_hint` (needs migration 20261010000000) |
| calibrate-open-ended-items | calibrate-irt | item_type: `open_ended` |
| calibrate-open-ended-items-cron | calibrate-irt-cron | job: `open_ended` (cron job repointed by migration 20261007000000) |
| peer-group-identification | get-class-mastery | mode: `peer_groups` |
| dynamic-student-grouping | get-class-mastery | mode: `dynamic_groups` (+ `op`: `preview` `apply` `current` `override`; needs migration 20261008000000) |
| teacher-copilot | ai-teacher-assistant | action: `copilot` |

Notes
* `calibrate-irt-cron` must stay deployed with `--no-verify-jwt` (pg_net has no user JWT); the handler
  checks `x-cron-secret` itself.
* To add a feature later: write a handler in `_shared/handlers/`, add one entry to the anchor's
  `MERGED_ROUTES`. Do not add a function folder.

## Digital Twin + What-If Academic Simulation (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| School Academic Digital Twin | whatif-timetable | mode: `twin_snapshot` |
| What-If Academic Simulation (picker data) | whatif-timetable | mode: `academic_simulation_options` |
| What-If Academic Simulation | whatif-timetable | mode: `academic_simulation` |

Handler: `_shared/handlers/schoolTwin.ts`; pure model: `_shared/schoolTwinModel.ts` (unit-tested in
`src/test/schoolTwinModel.test.ts`). The existing `teacher_absence` / `draft_preview` modes are unchanged.
These three modes require a signed-in staff user and are read-only; `verify_jwt` for whatif-timetable is unchanged.

## Academic Forecasting Engine + Student Digital Learning Twin (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| Academic Forecasting Engine (school / subject / class trends, student watch-list) | predict-performance | action: `forecast_overview` |
| Student Digital Learning Twin (ability, preferences, progression) | get-mastery-history | action: `student_twin` |

Handlers: `_shared/handlers/academicForecast.ts`, `_shared/handlers/studentTwin.ts`; pure models:
`_shared/academicForecastModel.ts`, `_shared/studentTwinModel.ts` (unit-tested in `src/test/academicForecastModel.test.ts`
and `src/test/studentTwinModel.test.ts`). Requests without these actions fall through to the anchors' original code unchanged.

* Forecast: staff only, pinned to the caller's own school; teachers only see classes they are assigned to. Read-only.
  Refuses to forecast with under 3 months / 5 tests of data and says so.
* Twin: students see their own, parents see linked children (`parent_students`), staff follow `studentAccess.ts`.
  Stores one snapshot per student per day in `student_learning_twin_snapshots` (migration 20261011000000); the twin
  works without that migration, it just shows no history.
* `predict-performance` is self-contained: it imports `forecastBundle.js` (generated with esbuild from the _shared sources, because the dashboard editor does not upload `_shared`). After editing `academicForecast.ts` / `academicForecastModel.ts` / `studentAccess.ts`, rebuild it:
  `npx esbuild <entry re-exporting routeMerged + handleAcademicForecast> --bundle --format=esm --platform=neutral --external:https://* --outfile=supabase/functions/predict-performance/forecastBundle.js`
* UI: a Forecast tab in School Intelligence (`SchoolAnalytics.tsx`) and a Learning Twin tab in `Student360Profile.tsx`.
  No sidebar change.

## Parent-Teacher Meeting Intelligence (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| PTM prep: discussion points for a booked parent-teacher meeting | ai-teacher-assistant | action: `ptm_prep` |

Handler: `_shared/handlers/ptmPrep.ts`; pure model: `_shared/ptmPrepModel.ts` (unit-tested in `src/test/ptmPrepModel.test.ts`).
Body: `{ action: "ptm_prep", appointment_id, refresh? }`. The existing `{ teacher_id, school_id }` dashboard call and `action: "copilot"` are unchanged.

* UI: a collapsible "Meeting prep" panel on each Pending & Upcoming card in `TeacherAppointments.tsx` (`components/appointments/PtmPrepPanel.tsx`).
  Meetings within 2 days open and load automatically. No sidebar change. Frontend call: `getPtmPrep()` in `src/lib/appointments.ts`.
* Access: the appointment's own teacher (who must still teach the student), or admin / principal / hod / school_admin of the appointment's school.
* Grounding: findings ("signals") are computed from records first; the model only phrases the "how to raise it" guidance. A model point that cites no real
  signal id is dropped, and the evidence shown is always taken from the signals, never from model text. No AI key / AI failure -> a rules-based brief (`source: "rules"`).
* Privacy: the student's name is replaced by `STU_01` before the model call; the parent's name is never sent. Safeguarding, medical, SEN/IEP and fee data are NOT read.
* Data read (all optional, a missing table becomes a "data gap"): attendance_records, student_marks, academic_tests, homework_assignments/submissions, behaviour_records,
  teacher_notes (this teacher's own), student_interventions, student_predictions, student_goals, previous appointments, and the mastery / misconception / risk RPCs.
* Cache (optional, migration `20261012000000_ptm_prep_briefs.sql`): AI briefs are stored in `ptm_prep_briefs` for 12h (or until the agenda changes). It is a separate table with RLS
  on and no client policies on purpose - parents read `appointments` with `select("*")`, so a column there would leak teacher-side prep to them. Works without the migration.
