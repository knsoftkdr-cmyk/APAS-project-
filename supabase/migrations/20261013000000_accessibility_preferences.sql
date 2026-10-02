-- Accessibility Engine: one row of display preferences per user (dyslexia mode,
-- screen-reader mode, keyboard navigation, text size). Read and written only by the already-deployed
-- get-mastery-history edge function (service role) via action = 'accessibility_get' / 'accessibility_save'.
-- The feature works without this table: preferences are still cached on the device (localStorage);
-- they just won't follow the user to another device.

CREATE TABLE IF NOT EXISTS public.user_accessibility_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on with no policies: only the service role (edge function) can read or write.
ALTER TABLE public.user_accessibility_preferences ENABLE ROW LEVEL SECURITY;
