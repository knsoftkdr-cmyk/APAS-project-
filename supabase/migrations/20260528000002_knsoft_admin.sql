-- ============================================================
-- KNSOFT SUPER ADMIN + FULL RBAC MIGRATION
-- Run AFTER the permissions_matrix migration
-- ============================================================

-- Note: Role constraint is already defined in 20260528000000_super_admin_role.sql
-- This migration adds additional functionality

-- 1. Add extra fields to schools table
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS curriculum VARCHAR(100),
  ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50) DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 2. knsoft_admin_logs table (audit log for knsoft actions)
CREATE TABLE IF NOT EXISTS knsoft_admin_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  target_type  TEXT,  -- 'school' | 'user' | 'permission'
  target_id    UUID,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. RLS for knsoft_admin — can see ALL schools
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knsoft_admin_all_schools" ON schools;
CREATE POLICY "knsoft_admin_all_schools"
  ON schools FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'knsoft_admin'
    )
  );

-- knsoft can see all profiles
DROP POLICY IF EXISTS "knsoft_admin_all_profiles" ON profiles;
CREATE POLICY "knsoft_admin_all_profiles"
  ON profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'knsoft_admin'
    )
  );

-- 4. HOW TO CREATE KNSOFT ADMIN (one time):
-- Step 1: Create user in Supabase Auth dashboard
-- Step 2: Run:
--   UPDATE profiles SET role = 'knsoft_admin' WHERE id = '<user_uuid>';
-- That's it — knsoft_admin has no school_id, they manage ALL schools
-- ============================================================
