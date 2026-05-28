-- ============================================================
-- PERMISSION MATRIX MIGRATION
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Modules table (what can be permitted)
CREATE TABLE IF NOT EXISTS permission_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,  -- e.g. "Gamification"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Seed all modules from the document
INSERT INTO permission_modules (name) VALUES
  ('View School Dashboard'),
  ('User Creation'),
  ('Student Profile'),
  ('Teacher Profile'),
  ('Attendance'),
  ('Homework'),
  ('Lesson Plans'),
  ('Assessments'),
  ('AI Tutor'),
  ('Analytics'),
  ('Reports'),
  ('Gamification'),
  ('Parent Communication'),
  ('Risk Prediction'),
  ('ERP Integration'),
  ('Billing'),
  ('Settings')
ON CONFLICT (name) DO NOTHING;

-- 3. Role permissions table (school-scoped)
CREATE TABLE IF NOT EXISTS role_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,  -- 'principal','hod','teacher','student','parent'
  module_name   TEXT NOT NULL,
  allowed       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, role, module_name)
);

-- 4. RLS
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_modules ENABLE ROW LEVEL SECURITY;

-- School admin can manage permissions for their school
CREATE POLICY "school_admin_manage_permissions"
  ON role_permissions FOR ALL
  USING (
    school_id = (
      SELECT sas.school_id FROM school_admin_schools sas
      WHERE sas.school_admin_id = auth.uid() LIMIT 1
    )
  );

-- All authenticated users can read permissions for their school
CREATE POLICY "users_read_own_school_permissions"
  ON role_permissions FOR SELECT
  USING (
    school_id = (
      SELECT school_id FROM profiles WHERE id = auth.uid() LIMIT 1
    )
  );

-- Everyone can read modules
CREATE POLICY "anyone_read_modules"
  ON permission_modules FOR SELECT
  USING (true);

-- 5. Seed DEFAULT permissions for all roles
-- (School admin can override these later via the UI)
-- These defaults match what currently exists in the app

-- Helper: insert defaults for a school when it's created
CREATE OR REPLACE FUNCTION seed_default_permissions(p_school_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_role TEXT;
  v_module TEXT;
  v_allowed BOOLEAN;
BEGIN
  FOR v_role IN SELECT unnest(ARRAY['principal','hod','teacher','student','parent'])
  LOOP
    FOR v_module IN SELECT name FROM permission_modules
    LOOP
      -- Default permission logic
      v_allowed := CASE
        WHEN v_role = 'principal' AND v_module IN (
          'View School Dashboard','Student Profile','Teacher Profile',
          'Attendance','Lesson Plans','Assessments','Analytics',
          'Reports','Risk Prediction','Settings'
        ) THEN true
        WHEN v_role = 'hod' AND v_module IN (
          'View School Dashboard','Student Profile','Teacher Profile',
          'Attendance','Lesson Plans','Assessments','Analytics','Reports'
        ) THEN true
        WHEN v_role = 'teacher' AND v_module IN (
          'View School Dashboard','Student Profile','Attendance',
          'Homework','Lesson Plans','Assessments','Analytics','Reports'
        ) THEN true
        WHEN v_role = 'student' AND v_module IN (
          'Homework','Assessments','AI Tutor','Gamification',
          'Risk Prediction'
        ) THEN true
        WHEN v_role = 'parent' AND v_module IN (
          'Student Profile','Homework','Reports','Parent Communication'
        ) THEN true
        ELSE false
      END;

      INSERT INTO role_permissions (school_id, role, module_name, allowed)
      VALUES (p_school_id, v_role, v_module, v_allowed)
      ON CONFLICT (school_id, role, module_name) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

-- 6. Seed permissions for the existing Excellencia School
-- (replace with your actual school UUID if different)
SELECT seed_default_permissions(
  (SELECT id FROM schools LIMIT 1)
);
-- ============================================================
