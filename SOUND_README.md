# APAS Gamification Sounds

Copy `src/` over your project (it overlays the redesign-phase1 files). No new dependencies, no audio files.

New files: `components/gamification/SoundToggle.tsx`
Replaced:  `components/gamification/sounds.ts` (all old function names still work)
Patched:   `pages/Gamification.tsx`, `hub/Gamification2Hub.tsx`, `hub/CompetencyMissions.tsx`,
           `setup/GameSetupScreen.tsx`, `hooks/useGamification2.ts`

Note: `hooks/useGamification2.ts` and the 11 game files are from the original APAS-project zip.
The game files are NOT included because they need no changes: they already call the sound functions,
and the engine now makes them rise in pitch with answer streaks automatically.

## Sound is scoped to the Gamification page only
`pages/Gamification.tsx` calls `activateGamificationAudio()` on mount and `deactivateGamificationAudio()` on
unmount. Outside that page nothing plays, no music timer runs, no listeners stay attached, and the browser
AudioContext is closed. Nothing else in the app needs to change.
