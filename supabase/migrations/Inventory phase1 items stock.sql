-- =====================================================================
-- APAS ERP :: Inventory & Procurement Module — PHASE 1
-- Items & Stock Tracking (per-school scoped)
-- Run in Supabase Dashboard SQL Editor (project: qkclzrscyhzrbixajaiw)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CATEGORIES (optional grouping, e.g. "Lab Equipment", "Stationery")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  parent_id       UUID REFERENCES inventory_categories(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name, parent_id)
);

-- ---------------------------------------------------------------------
-- 2. WAREHOUSES / LOCATIONS (a school can have multiple: "Main Store",
--    "Lab Store", "Library Store" etc.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_warehouses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  location_notes  TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

-- Ensure only one default warehouse per school
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_warehouses_one_default
  ON inventory_warehouses (school_id)
  WHERE is_default = true;

-- ---------------------------------------------------------------------
-- 3. ITEMS (the catalog)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  category_id     UUID REFERENCES inventory_categories(id) ON DELETE SET NULL,
  unit            TEXT NOT NULL DEFAULT 'pcs',       -- pcs, box, kg, ltr, ream, etc.
  cost_price      NUMERIC(12,2) DEFAULT 0,
  reorder_point   NUMERIC(12,2) DEFAULT 0,           -- trigger low-stock alert below this
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, sku)
);

-- ---------------------------------------------------------------------
-- 4. STOCK (current quantity per item per warehouse)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_stock (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  warehouse_id        UUID NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
  quantity_on_hand    NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity_reserved   NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, warehouse_id)
);

-- ---------------------------------------------------------------------
-- 5. STOCK MOVEMENTS (audit trail — every change to quantity_on_hand
--    must insert a row here; Phase 2/3 will write to this too)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  warehouse_id    UUID NOT NULL REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
  movement_type   TEXT NOT NULL CHECK (movement_type IN
                    ('opening_stock','manual_adjustment','purchase_receipt',
                     'issue','transfer_in','transfer_out')),
  quantity_delta  NUMERIC(14,2) NOT NULL,   -- positive = stock in, negative = stock out
  reference_type  TEXT,                     -- e.g. 'purchase_order', 'issue_request'
  reference_id    UUID,                     -- FK to that record (added in later phases)
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_movements_item_wh
  ON inventory_stock_movements (item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_movements_school
  ON inventory_stock_movements (school_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 6. TRIGGER: keep inventory_stock.quantity_on_hand in sync whenever a
--    movement row is inserted (single source of truth = movements table)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_inventory_stock_movement()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory_stock (item_id, warehouse_id, quantity_on_hand, updated_at)
  VALUES (NEW.item_id, NEW.warehouse_id, NEW.quantity_delta, now())
  ON CONFLICT (item_id, warehouse_id)
  DO UPDATE SET
    quantity_on_hand = inventory_stock.quantity_on_hand + NEW.quantity_delta,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_apply_inventory_stock_movement ON inventory_stock_movements;
CREATE TRIGGER trg_apply_inventory_stock_movement
  AFTER INSERT ON inventory_stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_stock_movement();

-- updated_at bump on inventory_items
CREATE OR REPLACE FUNCTION touch_inventory_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_inventory_items ON inventory_items;
CREATE TRIGGER trg_touch_inventory_items
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION touch_inventory_items_updated_at();

-- ---------------------------------------------------------------------
-- 7. RLS — every table gated by profiles.erp_access + matching school_id
--    (mirrors the ERPDashboard.tsx / erp_access pattern already in use)
-- ---------------------------------------------------------------------
ALTER TABLE inventory_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_warehouses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock            ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_movements  ENABLE ROW LEVEL SECURITY;

-- categories
CREATE POLICY inv_categories_access ON inventory_categories
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_categories.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_categories.school_id
    )
  );

-- warehouses
CREATE POLICY inv_warehouses_access ON inventory_warehouses
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_warehouses.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_warehouses.school_id
    )
  );

-- items
CREATE POLICY inv_items_access ON inventory_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_items.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_items.school_id
    )
  );

-- stock (join through items for school_id, since inventory_stock has no school_id column)
CREATE POLICY inv_stock_access ON inventory_stock
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM inventory_items i
      JOIN profiles p ON p.id = auth.uid()
      WHERE i.id = inventory_stock.item_id
        AND p.erp_access = true
        AND p.school_id = i.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inventory_items i
      JOIN profiles p ON p.id = auth.uid()
      WHERE i.id = inventory_stock.item_id
        AND p.erp_access = true
        AND p.school_id = i.school_id
    )
  );

-- stock movements
CREATE POLICY inv_movements_access ON inventory_stock_movements
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_stock_movements.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_stock_movements.school_id
    )
  );

-- ---------------------------------------------------------------------
-- 8. CONVENIENCE VIEW — items with total stock across all warehouses
--    (used by the Items list screen; avoids N+1 queries client-side)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW inventory_items_with_stock AS
SELECT
  i.id,
  i.school_id,
  i.sku,
  i.name,
  i.description,
  i.category_id,
  c.name AS category_name,
  i.unit,
  i.cost_price,
  i.reorder_point,
  i.is_active,
  COALESCE(SUM(s.quantity_on_hand), 0) AS total_quantity_on_hand,
  COALESCE(SUM(s.quantity_reserved), 0) AS total_quantity_reserved,
  (COALESCE(SUM(s.quantity_on_hand), 0) <= i.reorder_point) AS is_low_stock,
  i.updated_at
FROM inventory_items i
LEFT JOIN inventory_categories c ON c.id = i.category_id
LEFT JOIN inventory_stock s ON s.item_id = i.id
GROUP BY i.id, c.name;

-- Views inherit RLS from underlying tables automatically in Postgres
-- when security_invoker is not overridden, so no extra policy needed here.