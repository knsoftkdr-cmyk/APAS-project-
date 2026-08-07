-- ============================================================
-- APAS Library Management Module
-- Run this entire script in Supabase Dashboard SQL Editor
-- Project ref: qkclzrscyhzrbixajaiw
-- ============================================================
-- NOTE: This script assumes a `schools` table with column `id`
-- exists. If your schools table is named differently, adjust
-- the FK references below before running.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Access flag on profiles (mirrors profiles.erp_access pattern)
-- ------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS library_manager boolean DEFAULT false;

-- ------------------------------------------------------------
-- 1. Categories (subject/genre taxonomy per school)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. Unified catalog: physical books, ebooks, research papers, journals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('physical_book','ebook','research_paper','journal')),
  title text NOT NULL,
  author text,
  isbn text,
  category_id uuid REFERENCES library_categories(id) ON DELETE SET NULL,
  publisher text,
  edition text,
  publication_year int,
  description text,
  cover_image_url text,
  subject text,
  class_level text,           -- e.g. "Class 6" - curriculum linkage
  language text DEFAULT 'English',
  total_copies int DEFAULT 1, -- physical books only
  available_copies int DEFAULT 1,
  is_reference_only boolean DEFAULT false,
  status text DEFAULT 'active' CHECK (status IN ('active','archived','lost','damaged')),
  added_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_items_school ON library_items(school_id);
CREATE INDEX IF NOT EXISTS idx_library_items_type ON library_items(school_id, item_type);
CREATE INDEX IF NOT EXISTS idx_library_items_search ON library_items USING gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(author,'') || ' ' || coalesce(subject,'')));

-- ------------------------------------------------------------
-- 3. Digital files (ebooks / research papers / journals)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_item_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  school_id uuid NOT NULL, -- denormalized for simpler RLS
  file_url text NOT NULL,  -- Supabase Storage path
  file_type text,          -- pdf / epub
  file_size_kb int,
  is_downloadable boolean DEFAULT true,
  uploaded_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_files_item ON library_item_files(item_id);

-- ------------------------------------------------------------
-- 4. Tags (for research repository search/filtering)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_item_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  school_id uuid NOT NULL,
  tag text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_tags_item ON library_item_tags(item_id);
CREATE INDEX IF NOT EXISTS idx_library_tags_tag ON library_item_tags(school_id, tag);

-- ------------------------------------------------------------
-- 5. Members (students/teachers/staff registered with the library)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  member_type text CHECK (member_type IN ('student','teacher','staff')),
  max_books_allowed int DEFAULT 3,
  membership_status text DEFAULT 'active' CHECK (membership_status IN ('active','suspended','expired')),
  joined_date date DEFAULT current_date,
  created_at timestamptz DEFAULT now(),
  UNIQUE(school_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_library_members_school ON library_members(school_id);

-- ------------------------------------------------------------
-- 6. Circulation (issue / return / fines) - physical books
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_circulation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES library_items(id),
  member_id uuid NOT NULL REFERENCES library_members(id),
  issued_date date DEFAULT current_date,
  due_date date NOT NULL,
  returned_date date,
  fine_per_day numeric DEFAULT 0,
  fine_amount numeric DEFAULT 0,
  fine_paid boolean DEFAULT false,
  status text DEFAULT 'issued' CHECK (status IN ('issued','returned','overdue','lost')),
  issued_by uuid REFERENCES profiles(id),
  returned_to uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_circulation_school ON library_circulation(school_id);
CREATE INDEX IF NOT EXISTS idx_circulation_member ON library_circulation(member_id);
CREATE INDEX IF NOT EXISTS idx_circulation_status ON library_circulation(school_id, status);

-- ------------------------------------------------------------
-- 7. Reservations (hold requests when a physical copy is unavailable)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES library_items(id),
  member_id uuid NOT NULL REFERENCES library_members(id),
  reserved_date timestamptz DEFAULT now(),
  status text DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_reservations_item ON library_reservations(item_id);

-- ------------------------------------------------------------
-- 8. Per-school settings (loan period, fine rate, renewals)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS library_settings (
  school_id uuid PRIMARY KEY,
  default_loan_days int DEFAULT 14,
  fine_per_day numeric DEFAULT 2,
  max_renewals int DEFAULT 1,
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- All checks join through `profiles` for role / school_id.
-- Never use raw_app_meta_data or JWT claims (per project convention).
-- ============================================================

ALTER TABLE library_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_item_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_item_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_circulation ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_settings ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- library_categories: everyone in the school can view; only
-- library_manager / school_admin / principal can manage.
-- ------------------------------------------------------------
CREATE POLICY "lib_categories_select" ON library_categories
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_categories.school_id
  )
);

CREATE POLICY "lib_categories_manage" ON library_categories
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_categories.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_categories.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
);

-- ------------------------------------------------------------
-- library_items: everyone in the school can browse the catalog;
-- only library_manager / school_admin / principal can add/edit.
-- ------------------------------------------------------------
CREATE POLICY "lib_items_select" ON library_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_items.school_id
  )
);

CREATE POLICY "lib_items_manage" ON library_items
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_items.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_items.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
);

-- ------------------------------------------------------------
-- library_item_files: viewable by school members; uploaded by
-- library_manager/admin/principal OR a teacher (for research repository).
-- ------------------------------------------------------------
CREATE POLICY "lib_files_select" ON library_item_files
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_item_files.school_id
  )
);

CREATE POLICY "lib_files_manage" ON library_item_files
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_item_files.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal','teacher'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_item_files.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal','teacher'))
  )
);

-- ------------------------------------------------------------
-- library_item_tags: same visibility as items; manage = same as files
-- ------------------------------------------------------------
CREATE POLICY "lib_tags_select" ON library_item_tags
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_item_tags.school_id
  )
);

CREATE POLICY "lib_tags_manage" ON library_item_tags
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_item_tags.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal','teacher'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_item_tags.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal','teacher'))
  )
);

-- ------------------------------------------------------------
-- library_members: a user can view their own membership record;
-- library_manager/admin/principal can view & manage all in the school.
-- ------------------------------------------------------------
CREATE POLICY "lib_members_select_own" ON library_members
FOR SELECT USING (
  profile_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_members.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
);

CREATE POLICY "lib_members_manage" ON library_members
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_members.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_members.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
);

-- ------------------------------------------------------------
-- library_circulation: a member sees only their own issue/return
-- history; library_manager/admin/principal sees & manages all
-- circulation records for the school.
-- ------------------------------------------------------------
CREATE POLICY "lib_circulation_select_own" ON library_circulation
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM library_members lm
    WHERE lm.id = library_circulation.member_id
      AND lm.profile_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_circulation.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
);

CREATE POLICY "lib_circulation_manage" ON library_circulation
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_circulation.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_circulation.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
);

-- ------------------------------------------------------------
-- library_reservations: member can create/view their own; manager
-- sees and manages all.
-- ------------------------------------------------------------
CREATE POLICY "lib_reservations_select_own" ON library_reservations
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM library_members lm
    WHERE lm.id = library_reservations.member_id
      AND lm.profile_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_reservations.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
);

CREATE POLICY "lib_reservations_insert_own" ON library_reservations
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM library_members lm
    WHERE lm.id = library_reservations.member_id
      AND lm.profile_id = auth.uid()
  )
);

CREATE POLICY "lib_reservations_manage" ON library_reservations
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_reservations.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_reservations.school_id
      AND (p.library_manager = true OR p.role IN ('school_admin','principal'))
  )
);

-- ------------------------------------------------------------
-- library_settings: viewable by all school members (loan rules
-- are informational); editable only by admin/principal.
-- ------------------------------------------------------------
CREATE POLICY "lib_settings_select" ON library_settings
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_settings.school_id
  )
);

CREATE POLICY "lib_settings_manage" ON library_settings
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_settings.school_id
      AND p.role IN ('school_admin','principal')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.school_id = library_settings.school_id
      AND p.role IN ('school_admin','principal')
  )
);

-- ============================================================
-- HELPER FUNCTION: auto-decrement/increment available_copies
-- on issue/return of physical books (mirrors your fee RPC pattern
-- of doing arithmetic server-side rather than client-side)
-- ============================================================
CREATE OR REPLACE FUNCTION handle_circulation_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE library_items
      SET available_copies = available_copies - 1
      WHERE id = NEW.item_id AND available_copies > 0;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'issued' AND NEW.status IN ('returned','lost') THEN
    IF NEW.status = 'returned' THEN
      UPDATE library_items
        SET available_copies = available_copies + 1
        WHERE id = NEW.item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_circulation_change ON library_circulation;
CREATE TRIGGER trg_circulation_change
AFTER INSERT OR UPDATE ON library_circulation
FOR EACH ROW EXECUTE FUNCTION handle_circulation_change();

-- ============================================================
-- STORAGE BUCKET for digital library files (run once)
-- ============================================================
-- Create via Dashboard > Storage, or:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('library-files', 'library-files', false)
-- ON CONFLICT (id) DO NOTHING;
-- Then add storage.objects RLS policies scoped by school_id in the file path,
-- e.g. path convention: library-files/{school_id}/{item_id}/{filename}