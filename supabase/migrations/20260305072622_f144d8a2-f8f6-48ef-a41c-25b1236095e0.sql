
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
@'
-- Create worksheets table
CREATE TABLE IF NOT EXISTS public.worksheets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id UUID,
  class_level TEXT NOT NULL,
  section TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT,
  topic TEXT,
  subtopic TEXT,
  academic_year TEXT DEFAULT '2025-26',
  worksheet_content TEXT NOT NULL,
  page_count INTEGER DEFAULT 5,
  ai_generated BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.worksheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage their own worksheets"
  ON public.worksheets
  FOR ALL
  USING (teacher_id = auth.uid());

CREATE POLICY "School members can view worksheets"
  ON public.worksheets
  FOR SELECT
  USING (school_id IN (
    SELECT school_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE INDEX idx_worksheets_teacher ON public.worksheets(teacher_id);
CREATE INDEX idx_worksheets_class_section ON public.worksheets(class_level, section);
CREATE INDEX idx_worksheets_subject_topic ON public.worksheets(subject, topic);
'@ | Out-File -FilePath "supabase\migrations\20260618000001_create_worksheets_table.sql" -Encoding UTF8