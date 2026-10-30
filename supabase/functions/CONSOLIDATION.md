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

## Individual Education Plan (IEP) Generator (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| IEP Generator: drafts an IEP (goals, accommodations, strategies) for a SEN student | ai-teacher-assistant | action: `iep_generate` |

Handler: `_shared/handlers/iepGenerator.ts`; pure model: `_shared/iepModel.ts` (unit-tested in `src/test/iepModel.test.ts`).
Body: `{ action: "iep_generate", sen_student_id, duration_months?: 3-12, focus_domains?: string[], teacher_notes?: string }`.
The existing `{ teacher_id, school_id }` dashboard call, `action: "copilot"` and `action: "ptm_prep"` are unchanged.

* UI: a "Generate IEP with AI" button in the IEP tab of `SENManagement.tsx` (admin view) and `MySENStudents.tsx` (case manager only; therapists stay read-only),
  using the shared `components/sen/IepGeneratorDialog.tsx`. No sidebar change. Frontend call: `generateIepDraft()` in `src/lib/iepGenerator.ts`.
* No migration and no new table. The function returns a DRAFT and saves nothing. The dialog lets the case manager edit it, then saves through the same
  `iep_plans` / `iep_goals` / `sen_accommodations` inserts the screen already used (plan saved with status `draft`; if the goals insert fails the empty plan is removed).
* Access: admin / principal / hod / school_admin in the SEN student's school, or the teacher who is that student's case manager. Everyone else gets 403.
* Dates are computed in code, never by the model. Model output is checked against the allowed domains / accommodation types / `applies_to` values;
  unusable output, no AI key, or an AI failure -> a template-based draft (`source: "rules"`) that says so on screen.
* Privacy: the student's name is replaced by `STU_01` before the model call. SEN category and case notes are sent (they are the input), unlike PTM prep.
* Data read (all optional, a missing table becomes a "data gap"): sen_students, students, attendance_records, student_marks, behaviour_records, iep_plans/goals/reviews,
  sen_accommodations, therapy_sessions, and the `get_student_mastery_tree` RPC (as the caller).

## Accessibility Engine (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| Load a user's accessibility preferences (+ suggestion from SEN accommodations for students) | get-mastery-history | action: `accessibility_get` |
| Save a user's accessibility preferences | get-mastery-history | action: `accessibility_save` |

Handler: `_shared/handlers/accessibility.ts`; pure model: `_shared/accessibilityModel.ts` (unit-tested in
`src/test/accessibilityModel.test.ts`). Any signed-in user, own row only (user id comes from the verified JWT).
Storage: `user_accessibility_preferences` (migration 20261013000000, RLS on, service role only). The feature works
without that migration: settings stay cached on the device and `accessibility_save` answers 503 `persistence_unavailable`.

Existing functions changed (additive, optional field, unchanged behaviour when absent):
* `student-tutor-chat` and `student-self-assistant` accept `accessibility: { dyslexia?: true, screen_reader?: true }`
  and append plain-language writing guidance to the system prompt (`accessibilityDirective`).

Frontend: `src/lib/accessibility.ts`, `src/lib/accessibilityDom.ts`, `src/contexts/AccessibilityContext.tsx`,
`src/components/accessibility/AccessibilityPanel.tsx`, styles at the end of `src/index.css`.
After merging, redeploy `get-mastery-history`, `student-tutor-chat` and `student-self-assistant` (no new functions).

## Pronunciation Assessment (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| Score a spoken reading + AI tips (needs migration 20261014000000 to save results) | get-mastery-history | action: `pronunciation_assess` |
| Pronunciation history + tricky words | get-mastery-history | action: `pronunciation_history` |
| AI practice passage in any teaching language | get-mastery-history | action: `pronunciation_passage` |

## Real-Time Learning Event Stream (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| Browser telemetry (page views, active-time heartbeat, resource open/complete) - students, own row only | get-mastery-history | action: `lel_ingest` |
| Live event feed for a student or a class (cursor polling) | get-mastery-history | action: `lel_stream` |
| Activity summary: volume, accuracy, active minutes, sessions, status; class roster rollup | get-mastery-history | action: `lel_summary` |

Handler: `_shared/handlers/learningEventStream.ts`; pure model: `_shared/learningEventModel.ts` (unit-tested in
`src/test/learningEventModel.test.ts`); one-line emit helper for other functions: `_shared/learningEvents.ts`.
Storage: `learning_events` (migration 20261015000000). The feature works without that migration: endpoints answer
`persistence: "unavailable"`, the UI says it isn't switched on, and the emit helper is a silent no-op.

How events get in
* **Every graded answer** (practice, homework, daily review, adaptive test, exam paper, AI tutor, diagnostic) becomes a
  `question_answered` event through a trigger on `mastery_evidence_log`, so flows added later are captured with no wiring.
* Existing functions emit with `emitLearningEvent()` (additive, never throws, runs after the original work):
  `student-tutor-chat` (`tutor_message`: length/mode only, never the text), `cat-session` (`adaptive_test_started` /
  `adaptive_test_completed`), `submit-assessment-paper-attempt` handler (`assessment_submitted`), `pronunciation` handler
  (`pronunciation_attempt`: scores only, never the transcript).
* The browser (students only) sends whitelisted types through `lel_ingest`. Fields are sanitised (no query strings, no free
  text beyond a short title, timestamps clamped), capped at 20 per request and 400 per hour per student.

Access (same rules as the Learning Twin): student -> self; parent -> linked children; staff -> own school, teachers only
students/classes they teach (`studentAccess.ts`). Class scope is staff only. `learning_events` has RLS on with ONE policy: a
student may SELECT their own rows (so Realtime can push to their own browser). No client can write; staff and parents read only
through the edge function.

Existing functions changed (additive): `get-mastery-history` (3 routes), `student-tutor-chat`, `cat-session`. Redeploy those
three; no new functions. The pronunciation / exam-paper handlers ship inside `get-mastery-history` and `cat-session`.

Frontend: `src/lib/learningEvents.ts`, `src/hooks/useLearningEventStream.ts`, `src/hooks/useLearningTelemetry.ts` (mounted in
`AppLayout`), `src/components/telemetry/LiveLearningFeed.tsx`. UI: a "Live Activity" tab in `Student360Profile.tsx` and a
"Live activity" tab in `ClassMasteryDashboard.tsx`. No sidebar change.

Retention: `public.prune_learning_events()` deletes heartbeats after 30 days and everything after a year; schedule it with
pg_cron if wanted (commented example in the migration).

## Gamification 2.0 (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| Snapshot: progression, streak, missions, badges, insights | update-mastery | action: `g2_state` |
| Record a finished game round (awards XP, streak, mission progress, badges) | update-mastery | action: `g2_event` |
| Claim a completed mission's reward (once) | update-mastery | action: `g2_claim` |

Handler: `_shared/handlers/gamification2.ts`; pure model: `_shared/gamification2Model.ts` (unit-tested in
`src/test/gamification2Model.test.ts`). The existing `ah_generate` / `ah_submit_answer` routes and the plain mastery body are unchanged.
Bodies: `{ action: "g2_state", tz_offset_minutes? }`, `{ action: "g2_event", round: { game_id, subject?, accuracy, score, max_score, questions_attempted, duration_seconds }, dedupe_key?, tz_offset_minutes? }`,
`{ action: "g2_claim", mission_id, tz_offset_minutes? }`.

* UI: new tabs (Play / Missions / Badges / Progress) on the existing `/gamification` page, a streak + level header, and a rewards card on the
  results screen. **No sidebar change** and no new route. The "Play" tab is the unchanged setup screen. Frontend: `src/lib/gamification2.ts`,
  `src/hooks/useGamification2.ts`, `src/components/gamification/hub/Gamification2Hub.tsx`.
* Storage (migration `20261016000000_gamification_2.sql`): `gamification_events`, `gamification_missions`, three additive columns on `user_gamification`
  (`streak_freezes`, `last_freeze_date`, `freeze_earned_at_streak`), and 16 badge rows (`g2_*` keys) in the EXISTING `achievement_definitions`. XP, level and
  earned badges still live in `user_gamification` / `xp_transactions` / `user_achievements`, so the Leaderboard and the legacy `awardXp()` flow are unchanged.
  Without the migration every g2 action answers 503 `persistence_unavailable` and the page hides the new tabs (games and XP work as before).
* Adaptive: missions are generated per student per day / week from their last 14-28 days (typical rounds per day, average accuracy, weakest subject with 2+
  rounds, game types not played this week); new students get gentle defaults. Badges are tiered (Bronze/Silver/Gold) plus adaptive ones (Comeback, Personal
  Best, Steady Climber, Explorer).
* Streaks use the student's own day (`tz_offset_minutes`). A freeze is earned every 7 streak days (max 2) and automatically bridges ONE missed day.
* Access: students only, own data only (user id from the verified JWT). Writes use the service role; RLS lets a student read only their own new rows.
* Limits: round results come from the browser, so XP is bounded rather than proven (min 3 questions for full XP, 200 round-XP/day cap, `dedupe_key` per
  round). The legacy client-side `awardXp()` path still writes XP directly and can still use the UTC day for `last_activity_date`.
* Deploy: apply the migration, then redeploy `update-mastery` only (`supabase functions deploy update-mastery`). No new functions.

## Security Anomaly Detection (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| Record a login / failed login / data export / record view | log-audit | **mode**: `sec_record` |
| Anomaly alerts + real sign-in activity for a school (or all schools, platform admin) | log-audit | **mode**: `sec_list` |
| Acknowledge / resolve / mark false positive / reopen an alert | log-audit | **mode**: `sec_update` |

Note the key: `log-audit` already uses `action` for the audit action name, so this anchor routes on `mode`
(`routeMerged(req, MERGED_ROUTES, "mode")`). A body with no matching `mode` is the original audit-log insert, unchanged.

Handler: `_shared/handlers/securityAnomaly.ts`; pure rules: `_shared/securityAnomalyModel.ts` (unit-tested in
`src/test/securityAnomalyModel.test.ts`). Storage: `security_events`, `security_alerts` (migration 20261017000000, RLS on,
no client policies). Works without the migration: `sec_record` answers ok with `persistence: "unavailable"`, `sec_list`
returns an empty list and the panel says detection is not switched on.

Rules (deterministic, no AI call, thresholds in `THRESHOLDS`): brute force (5 failures / 15 min on one id), password spray
(8 ids from one address / 15 min), success after 3+ failures, new device AND network for someone with 3+ earlier logins
(high for admin/principal), 3 networks in an hour, overnight staff login that is unusual for that person (IST), many exports
in an hour (>= 5 and 3x the user's own peak), one very large export (500 / 5000 rows), mass record access (30 distinct
records/hour for staff, 60 for leadership, or 3x own peak).

* Events come from: `Login.tsx` (success + failure), `exportSelectedApplicants.ts` and `Alerts.tsx` CSV (exports), and
  `Student360Profile.tsx` (staff opening a student record, once per record per 10 min). Client helper: `src/lib/securityEvents.ts`
  (fire-and-forget; can never block the action it reports). Add more by calling `reportSecurityEvent({ event: "data_export", resource, count })`.
* Alerts are raised when an event is recorded and re-checked on every `sec_list`. `dedupe_key` + `ignoreDuplicates` means a
  re-scan never duplicates an alert and never reopens one a person already reviewed. Reviews are copied into `audit_logs`
  (`security_alert_reviewed`) so the Security Center "All Logs" tab shows them.
* Access: admin / principal / school_admin -> their own school only; knsoft_admin -> all schools. Everyone else gets 403.
* Privacy: login ids are stored as a SHA-256 hash plus a masked hint (`te***`); passwords are never seen; device is a coarse
  "browser|os" label. Failed logins are unauthenticated by nature, so they are rate-limited to 100 stored per address per hour.
* UI: an "Anomaly Alerts" tab in the existing Security Center (`SecurityCenter.tsx`, admin / principal) and in the existing
  Security Dashboard (`SecurityDashboard.tsx`, knsoft_admin). **No sidebar change.** Panel: `components/security/SecurityAnomalyPanel.tsx`.
* Redeploy only `log-audit` (it now imports `_shared`, so deploy with the CLI, not the dashboard editor). No new function.
* Retention: `public.prune_security_data()` (events 180 days, closed alerts 1 year); schedule with pg_cron if wanted.

## Session & Device Management (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| Register this device + learn if its login was ended | log-audit | **mode**: `sess_heartbeat` |
| List my active devices | log-audit | **mode**: `sess_list` |
| Sign one of my other devices out | log-audit | **mode**: `sess_revoke` |
| Sign out all my other devices | log-audit | **mode**: `sess_revoke_others` |
| Admin: sign a user out everywhere | log-audit | **mode**: `sess_admin_revoke_user` |

Handler: `_shared/handlers/sessionManagement.ts`; pure helpers: `_shared/sessionModel.ts` (tests: `src/test/sessionModel.test.ts`).
Storage: Supabase's own `auth.sessions` (via service-role-only RPCs `list_auth_sessions` / `revoke_auth_sessions`) plus
`user_sessions` for labels and a revoke trail (migration 20261018000000, RLS on, no client policies). Works without the
migration: heartbeat answers ok, the panel says device management is not switched on.

* Revoking deletes the row in `auth.sessions`, which cascades to its refresh tokens, so the device cannot renew its login.
  Its current access token verifies until it expires (Supabase default 1 hour), so `useSessionGuard` (mounted in `AuthContext`)
  sends a heartbeat every 5 minutes and when the tab becomes visible, and signs the device out the moment the server says "revoked".
  It never signs out on a network error: only on an explicit `revoked`, or a 401/403 that `auth.getUser()` confirms.
* The current device is identified by the `session_id` claim of the caller's JWT; it can't be revoked from the list and
  "sign out others" refuses to run if the claim is missing.
* Access: everyone manages their own devices. `sess_admin_revoke_user` needs admin / principal / school_admin (same school
  only, never a knsoft_admin) or knsoft_admin. Every revoke is copied to `audit_logs` (`session_revoked`, `session_revoked_by_admin`).
* UI: a "My Devices" tab in the existing Security Center (`/security`, all roles) and Security Dashboard (knsoft_admin); a
  "Sign out everywhere" button on Anomaly Alerts that name a user. **No sidebar change.**
* Redeploy only `log-audit`. No new function. Retention: `public.prune_session_data()` (90 days).
* Not touched: push tokens in `user_devices`. A revoked phone keeps its FCM token until that table is cleaned up separately.

## Competency Missions (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| A student's mastery missions, re-checked against real mastery | update-mastery | **action**: `cm_state` |
| Pay a verified mission's XP once | update-mastery | **action**: `cm_claim` |

Handler: `_shared/handlers/competencyMissions.ts`; pure rules: `_shared/competencyMissionModel.ts` (tests: `src/test/competencyMissionModel.test.ts`).
Storage: `competency_missions`, `competency_xp_awards` (migration 20261019000000, RLS on, no client policies). XP goes into the existing
`user_gamification` + `xp_transactions`, so levels and the Leaderboard need no change. Without the migration both actions answer
503 `persistence_unavailable` and the UI section hides itself.

* Missions come from the student's own `student_mastery` rows: "level up" a skill to the next tier (>= 0.10 above where they are;
  Developing 0.35 / Proficient 0.60 / Mastered 0.85, same bands as `student_mastery_labeled`), at most 3 at a time, one per topic;
  plus one "topic quest" (raise a whole topic's average through 50% / 65% / 80% across at least 60% of its skills).
* Nothing the browser reports can complete one. Every `cm_state` recomputes from `student_mastery` + `mastery_evidence_log`.
  Complete = score reached target AND >= 3 answers (2 correct) since the mission started (topic quest: 6 / 4) AND those answers
  on >= 2 different local days (1 day for the Developing tier). Mastery alone, however high, does not complete a mission.
* XP: 25 / 60 / 100 per skill tier, 80 / 120 / 180 per topic target. Paid once per skill tier or topic target ever
  (`UNIQUE(user_id, scope_key)`), so forgetting and re-learning can't be farmed. Capped at 400 mastery XP per local day; a claim
  over the cap waits (429 `daily_cap`) and the mission stays completed. Missions expire after 21 days and are re-offered fresh.
* UI: a "Competency missions" section at the top of the existing **Gamification -> Missions** tab (students). No new route, no sidebar change.
  Needs Gamification 2.0 switched on (the Missions tab lives behind it).
* Redeploy only `update-mastery`. No new function.
* Known limit: mastery is only as trustworthy as the flows that write it. `useMastery`'s direct `update-mastery` call sends
  client-judged `is_correct`, so a determined student could still inflate a score; the evidence/multi-day rules and the daily cap
  make that slow and bounded, not impossible. Grading every flow server-side is the real fix.

<<<<<<< Updated upstream
## AI Command Bar (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| AI Command Bar (resolve + read-only lookups + action previews; no writes) | ai-teacher-assistant | action: `command_bar` (any signed-in role; the handler authenticates the caller's JWT itself, uses the caller's RLS-bound client, never the service role) |
=======
## Teacher & AI suite - sheet rows 27, 28, 40, 41, 42, 43 (same pattern; migration 20261023000000)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| AI whiteboard (row 27) | ai-teacher-assistant | action: `whiteboard_draw` |
| AI class briefing (row 41) | ai-teacher-assistant | action: `class_briefing` |
| Digital classroom workspace (row 43) | ai-teacher-assistant | action: `classroom` (+ `op`) |
| One-screen assessment builder (row 42) | evaluate-assessment | action: `build_paper` (then `assign_paper`) |
| AI quality & safety control (row 40) | ai-hooks | action: `quality_evaluate` `quality_list` `quality_review` |
| Voice conversational tutor (row 28) | student-tutor-chat | body flag `voice: true` (safeguards apply to every message) |

Optional secrets: `AI_QUALITY_SAMPLE_RATE` (default 0.2) and `AI_QUALITY_VOICE_SAMPLE_RATE` (default 0.5) -
the share of AI Tutor / Voice Tutor replies sent to the quality evaluator.

## Teacher suite part 2 - sheet rows 44, 45, 46, 47 (migration 20261024000000)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| Interactive rubric grading (row 44) | evaluate-assessment | action: `review_open_response` + `teacher_rubric` |
| Bulk actions on exam reviews (row 45) | evaluate-assessment | action: `bulk_review` (+ `op`: `preview` `apply` `undo` `list`) |
| AI-assisted differentiation (row 46) | ai-teacher-assistant | action: `differentiate` (+ `op`: `generate` `list` `get` `delete` `share`) |
| Student intervention board (row 47) | - (client, existing RLS on student_interventions) | - |
>>>>>>> Stashed changes

## Gamification question history (added later, same pattern)

| Feature | Anchor (deployed) | Discriminator |
|---|---|---|
| The student's own class (from the DB) + subjects taught to it | update-mastery | action: `gq_context` |
| Fresh, class-strict items for one game; recorded as served so they never repeat | update-mastery | action: `gq_serve` (`game_type`, `subject` or `mode: "generic"`, `session_id`) |

Handler: `_shared/handlers/gamificationQuestions.ts`; pure model: `_shared/gamificationQuestionModel.ts` (unit-tested in
`src/test/gamificationQuestionModel.test.ts`). Needs migration `20261029000000_gamification_question_history.sql`
(`gamification_question_pool`, `student_question_history`, `gq_claim_items()`); without it both actions answer 503 `persistence_unavailable`.

* Class, school and curriculum come from the verified JWT's student record, never the request body.
* Sources, in order: teacher-approved `question_bank` MCQs (quick quiz), class-tagged pooled items, newly AI-generated items
  (existing `_shared/aiClient.ts`, same Gemini secrets as generate-mcqs). Nothing a student has been served is served again.
* Requests without these actions fall through to update-mastery's original code unchanged.

