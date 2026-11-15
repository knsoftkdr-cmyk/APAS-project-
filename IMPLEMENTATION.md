# Interactive Video Player: implementation notes

Copy the files in this folder over the project (paths are preserved), then:
1. Apply `supabase/migrations/20261111010000_interactive_video.sql`.
2. Redeploy `get-mastery-history` (all new routes live there; no new edge function).

## Where it appears (no new menu / module)
- **Teacher/admin**: Marketplace video cards (where videos are uploaded and managed) get **Questions** and a **performance** button.
- **Student**: the existing **Play** button opens the interactive learning screen (video + questions + doubt panel).
- **Analytics**: new "Video learning" section on the teacher and school-admin Dashboard; per-video detail dialog; per-student "Video learning" block in the existing student engagement dialog.

## Database (all service-role only, RLS on, accessed via the edge function)
video_settings, video_questions, video_question_attempts, video_progress, video_doubts; engagement trigger/index extended with
`video_question_answered` and `video_doubt`. Listing FK (ON DELETE CASCADE) is added only if marketplace_listings.id is uuid.

## Behaviour
- Questions pause the video at the timestamp; instant feedback with explanation; grading is server-side (students never receive the answer key beforehand).
- Per video: allow skipping ahead (on/off), allow skipping questions (on/off). Defaults = on, so existing videos behave as before.
- Watch time = unique seconds actually played (merged ranges, never above video length); completion = 90% watched; resume from last position.
- AI question drafts use title, description and pasted notes/transcript (AI cannot watch the video); teacher reviews before adding.
- Doubts: student asks inside the player (quick AI answer + teacher reply); teacher answers from the video's performance dialog.
- Engagement Score: watch time already feeds Video; answered questions and doubts now count as Interactions (daily cap applies, skips earn nothing).
- If the migration is not applied, students silently get the old tracked player.
