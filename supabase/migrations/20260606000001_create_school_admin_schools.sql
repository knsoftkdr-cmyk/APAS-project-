-- ============================================================
-- Create school_admin_schools mapping table
-- ============================================================

-- Create the school_admin_schools table (links school admins to schools)
CREATE TABLE IF NOT EXISTS school_admin_schools (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_admin_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_admin_id, school_id)
);

-- Enable RLS
ALTER TABLE school_admin_schools ENABLE ROW LEVEL SECURITY;

-- Allow knsoft_admin to see all school_admin assignments
CREATE POLICY "knsoft_admin_view_school_admins"
  ON school_admin_schools FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'knsoft_admin'
    )
  );

-- Allow knsoft_admin to manage school_admin assignments
CREATE POLICY "knsoft_admin_manage_school_admins"
  ON school_admin_schools FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'knsoft_admin'
    )
  );

-- School admins can see their own assignments
CREATE POLICY "school_admin_view_own"
  ON school_admin_schools FOR SELECT
  USING (school_admin_id = auth.uid());

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_school_admin_schools_admin_id ON school_admin_schools(school_admin_id);
CREATE INDEX IF NOT EXISTS idx_school_admin_schools_school_id ON school_admin_schools(school_id);
