
-- Enable realtime for mismatch_alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.mismatch_alerts;

-- Alert read tracking per user
CREATE TABLE public.alert_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES public.mismatch_alerts(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, alert_id)
);

ALTER TABLE public.alert_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own alert_reads"
  ON public.alert_reads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own alert_reads"
  ON public.alert_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own alert_reads"
  ON public.alert_reads FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
