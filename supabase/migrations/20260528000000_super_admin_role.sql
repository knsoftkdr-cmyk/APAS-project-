-- ============================================================
-- SUPER ADMIN MIGRATION
-- Run this in your Supabase SQL editor or as a new migration
-- ============================================================

-- 1. Add 'super_admin' to the role check constraint
-- First drop existing constraint (name may vary — adjust if needed)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'teacher', 'admin', 'school_admin', 'principal', 'super_admin', 'knsoft_admin', 'hod', 'parent'));

-- 2. Create schools table (multi-tenant: each super_admin owns one school)
CREATE TABLE IF NOT EXISTS schools (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  email       TEXT,
  logo_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Add school_id to profiles so every user belongs to a school
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE SET NULL;

-- 4. Create super_admins join table  (one super_admin manages one school)
CREATE TABLE IF NOT EXISTS super_admin_schools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (super_admin_id, school_id)
);

-- 5. RLS: super_admins can read all profiles that share their school_id
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow super_admin to SELECT all profiles in their school
DROP POLICY IF EXISTS "super_admin_select_school_profiles" ON profiles;
CREATE POLICY "super_admin_select_school_profiles"
  ON profiles FOR SELECT
  USING (
    school_id = (
      SELECT sas.school_id
      FROM super_admin_schools sas
      WHERE sas.super_admin_id = auth.uid()
      LIMIT 1
    )
    OR auth.uid() = id  -- always allow reading own profile
  );

-- Allow super_admin to INSERT profiles (create accounts) in their school
DROP POLICY IF EXISTS "super_admin_insert_school_profiles" ON profiles;
CREATE POLICY "super_admin_insert_school_profiles"
  ON profiles FOR INSERT
  WITH CHECK (
    school_id = (
      SELECT sas.school_id
      FROM super_admin_schools sas
      WHERE sas.super_admin_id = auth.uid()
      LIMIT 1
    )
  );

-- Allow super_admin to UPDATE profiles in their school
DROP POLICY IF EXISTS "super_admin_update_school_profiles" ON profiles;
CREATE POLICY "super_admin_update_school_profiles"
  ON profiles FOR UPDATE
  USING (
    school_id = (
      SELECT sas.school_id
      FROM super_admin_schools sas
      WHERE sas.super_admin_id = auth.uid()
      LIMIT 1
    )
  );

-- 6. Schools table RLS
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_manage_own_school" ON schools;
CREATE POLICY "super_admin_manage_own_school"
  ON schools FOR ALL
  USING (
    id = (
      SELECT sas.school_id
      FROM super_admin_schools sas
      WHERE sas.super_admin_id = auth.uid()
      LIMIT 1
    )
  );

-- 7. Helper function: is the current user a super_admin for a given school?
CREATE OR REPLACE FUNCTION is_super_admin_of(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM super_admin_schools
    WHERE super_admin_id = auth.uid()
      AND school_id = p_school_id
  );
$$;

-- ============================================================
-- HOW TO CREATE A SUPER ADMIN (run manually per school)
-- ============================================================
-- Step 1: Create user via Supabase Auth dashboard OR via service-role API
--   email: superadmin@yourschool.com  password: <choose>
--
-- Step 2: Insert school
--   INSERT INTO schools (name, email) VALUES ('My School', 'school@example.com');
--
-- Step 3: Update profile role + school_id
--   UPDATE profiles
--     SET role = 'super_admin', school_id = '<school_uuid>'
--   WHERE id = '<auth_user_uuid>';
--
-- Step 4: Link super_admin to school
--   INSERT INTO super_admin_schools (super_admin_id, school_id)
--   VALUES ('<auth_user_uuid>', '<school_uuid>');
-- ============================================================
