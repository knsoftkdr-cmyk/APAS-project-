-- =====================================================================
-- APAS ERP :: Inventory & Procurement Module — PHASE 3
-- Issuing Stock to Staff (with optional returns for equipment)
-- Run in Supabase Dashboard SQL Editor (project: qkclzrscyhzrbixajaiw)
-- Requires Phase 1 + Phase 2 already applied.
--
-- ASSUMPTION TO VERIFY: `employees` table has columns (id, name,
-- organization_id). If your actual column names differ, adjust the
-- REFERENCES clause below and the `employee_name` lookup in the
-- inventory_issues_with_summary view before running.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Allow the new movement type used when issued stock is returned
-- ---------------------------------------------------------------------
ALTER TABLE inventory_stock_movements
  DROP CONSTRAINT IF EXISTS inventory_stock_movements_movement_type_check;

ALTER TABLE inventory_stock_movements
  ADD CONSTRAINT inventory_stock_movements_movement_type_check
  CHECK (movement_type IN
    ('opening_stock','manual_adjustment','purchase_receipt',
     'issue','issue_return','transfer_in','transfer_out'));

-- ---------------------------------------------------------------------
-- 2. ISSUES (header) — stock going out to a staff member
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  warehouse_id    UUID NOT NULL REFERENCES inventory_warehouses(id),
  employee_id     UUID NOT NULL REFERENCES employees(id),
  issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  purpose         TEXT,
  status          TEXT NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('issued','partially_returned','returned')),
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. ISSUE LINE ITEMS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_issue_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id          UUID NOT NULL REFERENCES inventory_issues(id) ON DELETE CASCADE,
  item_id           UUID NOT NULL REFERENCES inventory_items(id),
  quantity_issued   NUMERIC(14,2) NOT NULL CHECK (quantity_issued > 0),
  quantity_returned NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_items_issue ON inventory_issue_items (issue_id);

CREATE OR REPLACE FUNCTION touch_inventory_issues_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_inventory_issues ON inventory_issues;
CREATE TRIGGER trg_touch_inventory_issues
  BEFORE UPDATE ON inventory_issues
  FOR EACH ROW EXECUTE FUNCTION touch_inventory_issues_updated_at();

-- ---------------------------------------------------------------------
-- 4. ISSUE FUNCTION — validates available stock, creates the issue +
--    lines, and writes 'issue' movements (negative delta) atomically.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_inventory_issue(
  p_school_id UUID,
  p_warehouse_id UUID,
  p_employee_id UUID,
  p_purpose TEXT,
  p_created_by UUID,
  p_lines JSONB   -- array of {"item_id": "...", "quantity": 5}
)
RETURNS UUID AS $$
DECLARE
  v_issue_id UUID;
  v_line JSONB;
  v_item_id UUID;
  v_qty NUMERIC;
  v_available NUMERIC;
BEGIN
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  -- Validate stock availability for every line before writing anything
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_item_id := (v_line->>'item_id')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be positive for item %', v_item_id;
    END IF;

    SELECT COALESCE(quantity_on_hand, 0) INTO v_available
    FROM inventory_stock
    WHERE item_id = v_item_id AND warehouse_id = p_warehouse_id;

    IF COALESCE(v_available, 0) < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for item % (available: %, requested: %)',
        v_item_id, COALESCE(v_available, 0), v_qty;
    END IF;
  END LOOP;

  INSERT INTO inventory_issues (school_id, warehouse_id, employee_id, purpose, created_by)
  VALUES (p_school_id, p_warehouse_id, p_employee_id, p_purpose, p_created_by)
  RETURNING id INTO v_issue_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_item_id := (v_line->>'item_id')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;

    INSERT INTO inventory_issue_items (issue_id, item_id, quantity_issued)
    VALUES (v_issue_id, v_item_id, v_qty);

    INSERT INTO inventory_stock_movements (
      school_id, item_id, warehouse_id, movement_type,
      quantity_delta, reference_type, reference_id, created_by
    ) VALUES (
      p_school_id, v_item_id, p_warehouse_id, 'issue',
      -v_qty, 'inventory_issue', v_issue_id, p_created_by
    );
  END LOOP;

  RETURN v_issue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- 5. RETURN FUNCTION — mirrors receive_purchase_order_item(), but adds
--    stock back and recalculates the issue's status.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION return_inventory_issue_item(
  p_issue_item_id UUID,
  p_quantity NUMERIC,
  p_created_by UUID
)
RETURNS VOID AS $$
DECLARE
  v_issue_id UUID;
  v_item_id UUID;
  v_school_id UUID;
  v_warehouse_id UUID;
  v_issued NUMERIC;
  v_already_returned NUMERIC;
  v_total_issued NUMERIC;
  v_total_returned NUMERIC;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Return quantity must be positive';
  END IF;

  SELECT ii.issue_id, ii.item_id, ii.quantity_issued, ii.quantity_returned,
         i.school_id, i.warehouse_id
  INTO v_issue_id, v_item_id, v_issued, v_already_returned, v_school_id, v_warehouse_id
  FROM inventory_issue_items ii
  JOIN inventory_issues i ON i.id = ii.issue_id
  WHERE ii.id = p_issue_item_id;

  IF v_issue_id IS NULL THEN
    RAISE EXCEPTION 'Issue item not found';
  END IF;

  IF v_already_returned + p_quantity > v_issued THEN
    RAISE EXCEPTION 'Cannot return more than issued (issued: %, already returned: %, attempted: %)',
      v_issued, v_already_returned, p_quantity;
  END IF;

  UPDATE inventory_issue_items
  SET quantity_returned = quantity_returned + p_quantity
  WHERE id = p_issue_item_id;

  INSERT INTO inventory_stock_movements (
    school_id, item_id, warehouse_id, movement_type,
    quantity_delta, reference_type, reference_id, created_by
  ) VALUES (
    v_school_id, v_item_id, v_warehouse_id, 'issue_return',
    p_quantity, 'inventory_issue', v_issue_id, p_created_by
  );

  SELECT SUM(quantity_issued), SUM(quantity_returned)
  INTO v_total_issued, v_total_returned
  FROM inventory_issue_items
  WHERE issue_id = v_issue_id;

  UPDATE inventory_issues
  SET status = CASE
    WHEN v_total_returned >= v_total_issued THEN 'returned'
    WHEN v_total_returned > 0 THEN 'partially_returned'
    ELSE status
  END
  WHERE id = v_issue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
ALTER TABLE inventory_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_issue_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_issues_access ON inventory_issues
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_issues.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.erp_access = true
        AND p.school_id = inventory_issues.school_id
    )
  );

CREATE POLICY inventory_issue_items_access ON inventory_issue_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM inventory_issues iss
      JOIN profiles p ON p.id = auth.uid()
      WHERE iss.id = inventory_issue_items.issue_id
        AND p.erp_access = true
        AND p.school_id = iss.school_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inventory_issues iss
      JOIN profiles p ON p.id = auth.uid()
      WHERE iss.id = inventory_issue_items.issue_id
        AND p.erp_access = true
        AND p.school_id = iss.school_id
    )
  );

-- ---------------------------------------------------------------------
-- 7. CONVENIENCE VIEW — issues with employee/warehouse names + totals
--    NOTE: assumes employees.name exists — adjust if column differs.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW inventory_issues_with_summary AS
SELECT
  iss.id,
  iss.school_id,
  iss.warehouse_id,
  w.name AS warehouse_name,
  iss.employee_id,
  e.full_name AS employee_name,
  iss.issue_date,
  iss.purpose,
  iss.status,
  COALESCE(SUM(items.quantity_issued), 0) AS total_quantity_issued,
  COALESCE(SUM(items.quantity_returned), 0) AS total_quantity_returned,
  iss.created_at,
  iss.updated_at
FROM inventory_issues iss
JOIN inventory_warehouses w ON w.id = iss.warehouse_id
JOIN employees e ON e.id = iss.employee_id
LEFT JOIN inventory_issue_items items ON items.issue_id = iss.id
GROUP BY iss.id, w.name, e.full_name;