-- AI Token Usage Tracking & Analytics
-- This migration creates comprehensive token tracking for all AI operations

-- 1. AI Usage Logs Table - Track every AI call
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  model_used text NOT NULL,
  input_tokens integer DEFAULT 0,
  output_tokens integer DEFAULT 0,
  total_tokens integer GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  cost_usd numeric(10, 6) DEFAULT 0,
  response_time_ms integer DEFAULT 0,
  status text CHECK (status IN ('success', 'error', 'rate_limited')),
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 2. AI Cost Configuration Table - Store pricing per model
CREATE TABLE IF NOT EXISTS public.ai_model_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_name text NOT NULL UNIQUE,
  provider text NOT NULL,
  input_cost_per_1k_tokens numeric(10, 8) NOT NULL,
  output_cost_per_1k_tokens numeric(10, 8) NOT NULL,
  is_active boolean DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 3. Daily AI Analytics Summary
CREATE TABLE IF NOT EXISTS public.ai_usage_daily_summary (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  summary_date date NOT NULL DEFAULT CURRENT_DATE,
  total_calls integer DEFAULT 0,
  total_input_tokens integer DEFAULT 0,
  total_output_tokens integer DEFAULT 0,
  total_cost_usd numeric(12, 6) DEFAULT 0,
  by_model jsonb DEFAULT '{}'::jsonb,
  by_task jsonb DEFAULT '{}'::jsonb,
  error_rate numeric(5, 2) DEFAULT 0,
  avg_response_time_ms integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(summary_date)
);

-- 4. AI Response Confidence Scores
CREATE TABLE IF NOT EXISTS public.ai_response_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ai_usage_log_id uuid REFERENCES public.ai_usage_logs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  confidence_score numeric(3, 2) CHECK (confidence_score >= 0 AND confidence_score <= 1.0),
  is_accurate boolean,
  teacher_feedback text,
  correction_provided text,
  value_rating integer CHECK (value_rating >= 1 AND value_rating <= 5),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 5. AI Content Approval Queue
CREATE TABLE IF NOT EXISTS public.ai_content_approval_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content_id uuid NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('lesson_plan', 'mcq', 'suggestion', 'feedback')),
  generated_by_model text NOT NULL,
  generated_content jsonb NOT NULL,
  generated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_revision')),
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_notes text,
  confidence_score numeric(3, 2),
  quality_issues jsonb DEFAULT '{}'::jsonb,
  approved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 6. AI Learning Feedback Loop
CREATE TABLE IF NOT EXISTS public.ai_improvement_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ai_usage_log_id uuid REFERENCES public.ai_usage_logs(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  model_used text NOT NULL,
  original_response jsonb NOT NULL,
  user_correction jsonb,
  improvement_notes text,
  impact_score numeric(3, 2) DEFAULT 0,
  has_improved_similar_tasks boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 7. Image Upload & Compression Log
CREATE TABLE IF NOT EXISTS public.image_compression_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  original_size_bytes integer NOT NULL,
  compressed_size_bytes integer,
  compression_ratio numeric(5, 2) GENERATED ALWAYS AS (
    ROUND((1.0 - CAST(compressed_size_bytes AS numeric) / original_size_bytes) * 100, 2)
  ) STORED,
  storage_path text,
  mime_type text,
  dimensions_original text,
  dimensions_compressed text,
  quality_level integer CHECK (quality_level >= 1 AND quality_level <= 100),
  status text CHECK (status IN ('pending', 'compressed', 'failed')),
  error_message text,
  cloudflare_image_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_daily_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_response_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_content_approval_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_improvement_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_compression_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_usage_logs
CREATE POLICY "Users can read own usage logs"
  ON public.ai_usage_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Teachers/admins can read class usage"
  ON public.ai_usage_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM students s 
      WHERE s.profile_id = auth.uid() AND s.id = ai_usage_logs.user_id
    )
    OR get_user_role(auth.uid()) IN ('teacher', 'admin', 'school_admin')
  );

CREATE POLICY "Service role manages logs"
  ON public.ai_usage_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RLS Policies for ai_model_costs
CREATE POLICY "Public can read costs"
  ON public.ai_model_costs FOR SELECT
  USING (is_active = true);

CREATE POLICY "Service role manages costs"
  ON public.ai_model_costs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RLS Policies for ai_usage_daily_summary
CREATE POLICY "Teachers/admins can read summaries"
  ON public.ai_usage_daily_summary FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) IN ('teacher', 'admin', 'school_admin'));

CREATE POLICY "Service role manages summaries"
  ON public.ai_usage_daily_summary FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RLS Policies for ai_response_feedback
CREATE POLICY "Users can read own feedback"
  ON public.ai_response_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Teachers/admins can read all feedback"
  ON public.ai_response_feedback FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) IN ('teacher', 'admin', 'school_admin'));

CREATE POLICY "Users can create own feedback"
  ON public.ai_response_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role manages feedback"
  ON public.ai_response_feedback FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RLS Policies for ai_content_approval_queue
CREATE POLICY "Submitters can read own queue items"
  ON public.ai_content_approval_queue FOR SELECT TO authenticated
  USING (submitted_by_user_id = auth.uid());

CREATE POLICY "Reviewers can read assigned items"
  ON public.ai_content_approval_queue FOR SELECT TO authenticated
  USING (
    reviewer_id = auth.uid() 
    OR get_user_role(auth.uid()) IN ('admin', 'school_admin')
  );

CREATE POLICY "Teachers can submit content"
  ON public.ai_content_approval_queue FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role(auth.uid()) IN ('teacher', 'admin') 
    AND submitted_by_user_id = auth.uid()
  );

CREATE POLICY "Reviewers can update queue items"
  ON public.ai_content_approval_queue FOR UPDATE TO authenticated
  USING (
    reviewer_id = auth.uid() 
    OR get_user_role(auth.uid()) IN ('admin', 'school_admin')
  );

CREATE POLICY "Service role manages queue"
  ON public.ai_content_approval_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RLS Policies for ai_improvement_feedback
CREATE POLICY "Service role manages improvement feedback"
  ON public.ai_improvement_feedback FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can read class improvement data"
  ON public.ai_improvement_feedback FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) IN ('teacher', 'admin', 'school_admin'));

-- RLS Policies for image_compression_log
CREATE POLICY "Users can read own uploads"
  ON public.image_compression_log FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Teachers can read student uploads"
  ON public.image_compression_log FOR SELECT TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('teacher', 'admin', 'school_admin')
    OR EXISTS (
      SELECT 1 FROM students s 
      WHERE s.profile_id = auth.uid() AND s.id = image_compression_log.user_id
    )
  );

CREATE POLICY "Service role manages compression log"
  ON public.image_compression_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Create Indexes for performance
CREATE INDEX idx_ai_usage_logs_user_id ON public.ai_usage_logs(user_id);
CREATE INDEX idx_ai_usage_logs_task_type ON public.ai_usage_logs(task_type);
CREATE INDEX idx_ai_usage_logs_created_at ON public.ai_usage_logs(created_at DESC);
CREATE INDEX idx_ai_usage_logs_model_used ON public.ai_usage_logs(model_used);
CREATE INDEX idx_ai_usage_logs_status ON public.ai_usage_logs(status);

CREATE INDEX idx_ai_response_feedback_user_id ON public.ai_response_feedback(user_id);
CREATE INDEX idx_ai_response_feedback_task_type ON public.ai_response_feedback(task_type);
CREATE INDEX idx_ai_response_feedback_created_at ON public.ai_response_feedback(created_at DESC);

CREATE INDEX idx_ai_content_approval_content_type ON public.ai_content_approval_queue(content_type);
CREATE INDEX idx_ai_content_approval_status ON public.ai_content_approval_queue(status);
CREATE INDEX idx_ai_content_approval_reviewer_id ON public.ai_content_approval_queue(reviewer_id);

CREATE INDEX idx_image_compression_user_id ON public.image_compression_log(user_id);
CREATE INDEX idx_image_compression_status ON public.image_compression_log(status);
CREATE INDEX idx_image_compression_created_at ON public.image_compression_log(created_at DESC);

-- Initialize default AI model costs (US pricing as of 2026)
INSERT INTO public.ai_model_costs (model_name, provider, input_cost_per_1k_tokens, output_cost_per_1k_tokens, is_active)
VALUES 
  ('google/gemini-2.5-flash-lite', 'Google', 0.000075, 0.0003, true),
  ('google/gemini-3-flash-preview', 'Google', 0.00015, 0.0006, true),
  ('google/gemini-2.5-flash', 'Google', 0.00015, 0.0006, true),
  ('google/gemini-2.5-pro', 'Google', 0.001, 0.004, true),
  ('openai/gpt-4o-mini', 'OpenAI', 0.00015, 0.0006, true),
  ('meta-llama/llama-3.3-70b', 'Meta', 0.0001, 0.0002, true)
ON CONFLICT (model_name) DO NOTHING;
