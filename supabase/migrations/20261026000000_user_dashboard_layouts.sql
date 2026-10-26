-- Personalized dashboard widgets: each user's section order and visibility, per dashboard.
--
-- One row per (user, dashboard). The app works without this table: the layout is then kept on the device
-- (localStorage) and simply won't follow the user to another browser.
--
-- Security: RLS limits every operation to the signed-in user's own rows. No school data is stored - only
-- widget ids, their order, and which are hidden - so there is nothing to leak across schools.

CREATE TABLE IF NOT EXISTS public.user_dashboard_layouts (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dashboard_key text NOT NULL CHECK (char_length(dashboard_key) BETWEEN 1 AND 64),
  layout        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(layout) <= 16384),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dashboard_key)
);

ALTER TABLE public.user_dashboard_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own dashboard layouts" ON public.user_dashboard_layouts
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own dashboard layouts" ON public.user_dashboard_layouts
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own dashboard layouts" ON public.user_dashboard_layouts
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own dashboard layouts" ON public.user_dashboard_layouts
  FOR DELETE USING (user_id = auth.uid());
