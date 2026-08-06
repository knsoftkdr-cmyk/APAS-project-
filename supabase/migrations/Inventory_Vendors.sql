-- =====================================================================
-- APAS ERP :: Inventory & Procurement Module — PHASE 2
-- Vendors & Purchase Orders
-- Run in Supabase Dashboard SQL Editor (project: qkclzrscyhzrbixajaiw)
-- Requires Phase 1 (inventory_items, inventory_warehouses,
-- inventory_stock, inventory_stock_movements) already applied.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. VENDORS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  contact_person  TEXT,
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  tax_id          TEXT,                 -- GSTIN or similar, optional
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

-- ---------------------------------------------------------------------
-- 2. PURCHASE ORDERS (header)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  po_number       TEXT NOT NULL,
  vendor_id       UUID NOT NULL REFERENCES inventory_vendors(id),
  warehouse_id    UUID NOT NULL REFERENCES inventory_warehouses(id),  -- destination for received stock
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','ordered','partially_received','received','cancelled')),
  order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date   DATE,
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, po_number)
);

-- ---------------------------------------------------------------------
-- 3. PURCHASE ORDER LINE ITEMS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id             UUID NOT NULL REFERENCES inventory_items(id),
  quantity_ordered    NUMERIC(14,2) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received   NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost           NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items (purchase_order_id);

-- ---------------------------------------------------------------------
-- 4. AUTO-GENERATE po_number PER SCHOOL (e.g. PO-0001, PO-0002, ...)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TRIGGER AS $$
DECLARE
  next_seq INT;
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(po_number FROM 'PO-(\d+)') AS INT)), 0) + 1
    INTO next_seq
    FROM purchase_orders
    WHERE school_id = NEW.school_id
      AND po_number ~ '^PO-\d+$';

    NEW.po_number := 'PO-' || LPAD(next_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_po_number ON purchase_orders;
CREATE TRIGGER trg_generate_po_number
  BEFORE INSERT ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION generate_po_number();

CREATE OR REPLACE FUNCTION touch_purchase_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_purchase_orders ON purchase_orders;
CREATE TRIGGER trg_touch_purchase_orders
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION touch_purchase_orders_updated_at();

-- ---------------------------------------------------------------------
-- 5. RECEIVE FUNCTION — call this instead of inserting stock movements
--    manually. Records the receipt on the PO line, writes an audit
--    movement (which the Phase-1 trigger turns into a stock update),
--    and recalculates the PO's overall status.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION receive_purchase_order_item(
  p_po_item_id UUID,
  p_quantity NUMERIC,
  p_created_by UUID
)
RETURNS VOID AS $$
DECLARE
  v_po_id UUID;
  v_item_id UUID;
  v_school_id UUID;
  v_warehouse_id UUID;
  v_ordered NUMERIC;
  v_already_received NUMERIC;
  v_total_ordered NUMERIC;
  v_total_received NUMERIC;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Receive quantity must be positive';
  END IF;

  SELECT poi.purchase_order_id, poi.item_id, poi.quantity_ordered, poi.quantity_received,
         po.school_id, po.warehouse_id
  INTO v_po_id, v_item_id, v_ordered, v_already_received, v_school_id, v_warehouse_id
  FROM purchase_order_items poi
  JOIN purchase_orders po ON po.id = poi.purchase_order_id
  WHERE poi.id = p_po_item_id;

  IF v_po_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order item not found';
  END IF;

  IF v_already_received + p_quantity > v_ordered THEN
    RAISE EXCEPTION 'Cannot receive more than ordered (ordered: %, already received: %, attempted: %)',
      v_ordered, v_already_received, p_quantity;
  END IF;

  -- Bump quantity_received on the line
  UPDATE purchase_order_items
  SET quantity_received = quantity_received + p_quantity
  WHERE id = p_po_item_id;

  -- Write the audit movement; Phase-1 trigger updates inventory_stock automatically
  INSERT INTO inventory_stock_movements (
    school_id, item_id, warehouse_id, movement_type,
    quantity_delta, reference_type, reference_id, created_by
  ) VALUES (
    v_school_id, v_item_id, v_warehouse_id, 'purchase_receipt',
    p_quantity, 'purchase_order', v_po_id, p_created_by
  );

  -- Recalculate PO status from all its lines
  SELECT SUM(quantity_ordered), SUM(quantity_received)
  INTO v_total_ordered, v_total_received
  FROM purchase_order_items
  WHERE purchase_order_id = v_po_id;

  UPDATE purchase_orders
  SET status = CASE
    WHEN v_total_received >= v_total_ordered THEN 'received'
    WHEN v_total_received > 0 THEN 'partially_received'
    ELSE status
  END
  WHERE id = v_po_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
ALTER TABLE inventory_vendors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items   ENABLE ROW LEVEL SECURITY;

CREATE POLICY inv_vendors_access ON inventory_vendors
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_vendors.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_vendors.school_id
    )
  );

CREATE POLICY purchase_orders_access ON purchase_orders
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = purchase_orders.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = purchase_orders.school_id
    )
  );

-- purchase_order_items has no school_id column directly, join through purchase_orders
CREATE POLICY purchase_order_items_access ON purchase_order_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      JOIN profiles p ON p.id = auth.uid()
      WHERE po.id = purchase_order_items.purchase_order_id
        AND p.erp_access = true
        AND p.school_id = po.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      JOIN profiles p ON p.id = auth.uid()
      WHERE po.id = purchase_order_items.purchase_order_id
        AND p.erp_access = true
        AND p.school_id = po.school_id
    )
  );

-- ---------------------------------------------------------------------
-- 7. CONVENIENCE VIEW — PO list with vendor name + computed totals
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW purchase_orders_with_summary AS
SELECT
  po.id,
  po.school_id,
  po.po_number,
  po.vendor_id,
  v.name AS vendor_name,
  po.warehouse_id,
  w.name AS warehouse_name,
  po.status,
  po.order_date,
  po.expected_date,
  po.notes,
  COALESCE(SUM(poi.quantity_ordered), 0) AS total_quantity_ordered,
  COALESCE(SUM(poi.quantity_received), 0) AS total_quantity_received,
  COALESCE(SUM(poi.quantity_ordered * poi.unit_cost), 0) AS total_value,
  po.created_at,
  po.updated_at
FROM purchase_orders po
JOIN inventory_vendors v ON v.id = po.vendor_id
JOIN inventory_warehouses w ON w.id = po.warehouse_id
LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
GROUP BY po.id, v.name, w.name;