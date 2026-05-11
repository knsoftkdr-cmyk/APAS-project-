## Student Onboarding & Guided Tour

Build a production-ready first-time onboarding flow for students on the APAS dashboard.

### 1. Database changes (migration)

Extend `profiles` table with onboarding/profile fields:
- `gender` text — 'male' | 'female' | 'prefer_not_to_say'
- `avatar_url` text
- `class_grade` text
- `school_name` text
- `onboarding_completed` boolean default false
- `tour_completed` boolean default false

Create a public storage bucket `avatars` with RLS so students can upload their own profile photo (read public; insert/update/delete restricted to `auth.uid()::text = (storage.foldername(name))[1]`).

### 2. AI avatar assets

Generate 9 avatar PNGs in `src/assets/avatars/` (3 male, 3 female, 3 neutral) using imagegen. Cartoon-style student avatars matching APAS palette (navy `#2C3E50` + blue `#2563EB`).

### 3. Components

```
src/components/onboarding/
  OnboardingFlow.tsx          // orchestrator: decides which step to render
  GenderStep.tsx              // Step 1 modal — 3 cards, save → profiles.gender
  AvatarStep.tsx              // Step 2 modal — gender-filtered AI avatars + upload tile
  ProfileCompletionBar.tsx    // dismissible bar shown on dashboard when <100%
  GuidedTour.tsx              // overlay tour with Next/Back/Skip/Finish
  tourSteps.ts                // step definitions targeting sidebar nav by data-tour-id
src/hooks/
  useProfileCompletion.ts     // returns { percent, missingFields }
  useOnboardingState.ts       // loads profile flags, exposes setters
```

`OnboardingFlow` is mounted inside `StudentDashboard.tsx`. It:
- reads profile, shows Gender modal if `gender` null
- then Avatar modal if `avatar_url` null
- then triggers `GuidedTour` if `tour_completed` false (and onboarding now done)
- sets `onboarding_completed=true` after avatar step

Profile completion (6 fields, ~16.6% each, rounded): name, gender, avatar_url, class_grade (from `students.grade`), school_name, academic info (any assessment row exists). Bar at top of `StudentDashboard` with progress + CTA "Complete profile" linking to `/settings`.

### 4. Guided tour

Add `data-tour-id` attributes to sidebar nav items in `AppSidebar.tsx` for: home, dashboard, assessments, academic-tests, gamification, settings.

`GuidedTour` highlights each target via fixed overlay + spotlight (computed from `getBoundingClientRect`), tooltip card with title/description, and Next/Back/Skip/Finish. On Skip or Finish → update `profiles.tour_completed=true`.

### 5. Settings page

Extend `Settings.tsx` form to edit gender, class/grade, school, and re-pick/upload avatar — so students can finish their profile from the bar's CTA.

### 6. Behavior

- Modals are blocking (cannot close until saved) for gender; avatar step has Skip → marks onboarding done but completion stays <100%.
- Tour runs only when `onboarding_completed=true && tour_completed=false`.
- Bar auto-hides at 100%.
- All state persisted in DB; no localStorage.
- Reuses shadcn `Dialog`, `Progress`, `Button`, `Card`. Tailwind semantic tokens only.

### Files touched
- migration (profiles columns + avatars bucket + policies)
- `src/components/onboarding/*` (new)
- `src/hooks/useProfileCompletion.ts`, `useOnboardingState.ts` (new)
- `src/assets/avatars/*` (9 generated)
- `src/pages/StudentDashboard.tsx` (mount flow + bar)
- `src/components/layout/AppSidebar.tsx` (data-tour-id)
- `src/pages/Settings.tsx` (extra fields)
