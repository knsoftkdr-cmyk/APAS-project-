-- Minimal stand-in for the Supabase environment + the tables this repo does not track in migrations.
-- Used ONLY by supabase/tests/scheduled_messages/run.sh against a throw-away local Postgres database.
-- Column shapes follow the real code (types.ts, existing migrations, and how the Communication Center pages
-- read/write them). The real 20261105 delivery-tracking migration and the real notification de-dupe trigger
-- are applied on top by run.sh so the new feature is tested against the genuine existing behaviour.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- Same contract as Supabase: the signed-in user comes from the request JWT claims; service role / cron have none.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  full_name text,
  role text NOT NULL DEFAULT 'student',
  school_id uuid,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.school_admin_schools (school_admin_id uuid, school_id uuid);
CREATE TABLE public.classes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, section text);
CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid, full_name text, class text, section text);
CREATE TABLE public.class_students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid REFERENCES classes(id), student_id uuid REFERENCES students(id), UNIQUE (class_id, student_id));
CREATE TABLE public.class_teachers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid REFERENCES classes(id), teacher_id uuid REFERENCES profiles(id), UNIQUE (class_id, teacher_id));
-- parent_students.student_id is a PROFILE id (see TeacherCommunicationCenter), not students.id.
CREATE TABLE public.parent_students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid, student_id uuid);
CREATE TABLE public.drivers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid, school_id uuid, name text, phone text);

-- Verbatim shape from 20260402094813 (+ columns the later migrations add).
CREATE TABLE public.governance_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  reference_id uuid,
  reference_type text,
  channel text NOT NULL DEFAULT 'in_app',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- teacher_messages is not in any tracked migration; this is the shape the Communication Center pages use.
CREATE TABLE public.teacher_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid,
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  recipient_role text,
  message text NOT NULL,
  message_type text NOT NULL DEFAULT 'general',
  attachment_url text,
  attachment_name text,
  meeting_date text,
  meeting_time text,
  meeting_status text,
  batch_id uuid,
  broadcast_label text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.teacher_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tm_select ON public.teacher_messages FOR SELECT TO authenticated USING (sender_id = auth.uid() OR recipient_id = auth.uid());
CREATE POLICY tm_insert ON public.teacher_messages FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());
CREATE POLICY tm_update ON public.teacher_messages FOR UPDATE TO authenticated USING (recipient_id = auth.uid() OR sender_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teacher_messages TO authenticated;
GRANT ALL ON public.teacher_messages, public.governance_notifications TO service_role;

CREATE PUBLICATION supabase_realtime;
