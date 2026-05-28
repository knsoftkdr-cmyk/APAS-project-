
-- Hooks registry
CREATE TABLE public.ai_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hook_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('pre','post')),
  category TEXT NOT NULL CHECK (category IN ('safety','curriculum_alignment','quality','moderation','schema','relevance')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  action_on_fail TEXT NOT NULL DEFAULT 'regenerate' CHECK (action_on_fail IN ('block','regenerate','warn')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  applies_to TEXT[] NOT NULL DEFAULT ARRAY['*']::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_hooks_active ON public.ai_hooks(is_active, stage);

ALTER TABLE public.ai_hooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage hooks"
ON public.ai_hooks FOR ALL
USING (public.get_user_role(auth.uid()) IN ('admin','school_admin'))
WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','school_admin'));

CREATE POLICY "Authenticated can read active hooks"
ON public.ai_hooks FOR SELECT
USING (auth.uid() IS NOT NULL AND is_active = true);

-- Violations log
CREATE TABLE public.ai_hook_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hook_key TEXT NOT NULL,
  skill_key TEXT,
  stage TEXT NOT NULL,
  severity TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  caller_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_hook_violations_created ON public.ai_hook_violations(created_at DESC);
CREATE INDEX idx_ai_hook_violations_caller ON public.ai_hook_violations(caller_id);

ALTER TABLE public.ai_hook_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view all violations"
ON public.ai_hook_violations FOR SELECT
USING (public.get_user_role(auth.uid()) IN ('admin','school_admin'));

CREATE POLICY "Users view own violations"
ON public.ai_hook_violations FOR SELECT
USING (caller_id = auth.uid());

CREATE POLICY "Service can insert violations"
ON public.ai_hook_violations FOR INSERT
WITH CHECK (true);

-- updated_at trigger
CREATE TRIGGER trg_ai_hooks_updated_at
BEFORE UPDATE ON public.ai_hooks
FOR EACH ROW EXECUTE FUNCTION public.update_ai_memory_updated_at();

-- Seed core guardrails
INSERT INTO public.ai_hooks (hook_key, name, description, stage, category, severity, action_on_fail, config) VALUES
('safety_profanity', 'Profanity & Unsafe Content', 'Blocks outputs containing profanity, hate, or unsafe content', 'post', 'safety', 'critical', 'block',
  '{"banned_terms":["kill yourself","hate","stupid idiot"],"patterns":["\\b(suicide|self-harm)\\b"]}'::jsonb),
('curriculum_alignment', 'Curriculum Alignment', 'Ensures output references the target subject/class/topic', 'post', 'curriculum_alignment', 'high', 'regenerate',
  '{"min_keyword_matches":1}'::jsonb),
('quality_min_length', 'Minimum Quality Length', 'Rejects outputs that are too short to be useful', 'post', 'quality', 'medium', 'regenerate',
  '{"min_chars":120}'::jsonb),
('schema_valid_json', 'Valid JSON Schema', 'Ensures JSON outputs parse correctly when JSON is expected', 'post', 'schema', 'high', 'regenerate',
  '{}'::jsonb),
('relevance_offtopic', 'Off-topic Filter', 'Rejects outputs that drift away from the requested topic', 'post', 'relevance', 'medium', 'regenerate',
  '{"min_topic_overlap":0.15}'::jsonb),
('moderation_pii', 'PII Moderation', 'Blocks outputs leaking emails, phone numbers, or IDs', 'post', 'moderation', 'high', 'block',
  '{"patterns":["[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}","\\b\\d{10}\\b"]}'::jsonb);
