// src/types/inventory.ts
// Types for the Inventory & Procurement module (Phase 1: Items & Stock)

export interface InventoryCategory {
  id: string;
  school_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface InventoryWarehouse {
  id: string;
  school_id: string;
  name: string;
  location_notes: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  school_id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  unit: string;
  cost_price: number;
  reorder_point: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Shape returned by the inventory_items_with_stock view
export interface InventoryItemWithStock extends InventoryItem {
  category_name: string | null;
  total_quantity_on_hand: number;
  total_quantity_reserved: number;
  is_low_stock: boolean;
}

export type InventoryMovementType =
  | 'opening_stock'
  | 'manual_adjustment'
  | 'purchase_receipt'
  | 'issue'
  | 'issue_return'
  | 'issue_damage_writeoff'
  | 'transfer_in'
  | 'transfer_out';

export interface InventoryStockMovement {
  id: string;
  school_id: string;
  item_id: string;
  warehouse_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InventoryItemFormValues {
  sku: string;
  name: string;
  description: string;
  category_id: string | null;
  unit: string;
  cost_price: number;
  reorder_point: number;
}

// ---------------------------------------------------------------------
// Phase 2: Vendors & Purchase Orders
// ---------------------------------------------------------------------

export interface InventoryVendor {
  id: string;
  school_id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface PurchaseOrder {
  id: string;
  school_id: string;
  po_number: string;
  vendor_id: string;
  warehouse_id: string;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Shape returned by purchase_orders_with_summary view
export interface PurchaseOrderWithSummary extends PurchaseOrder {
  vendor_name: string;
  warehouse_name: string;
  total_quantity_ordered: number;
  total_quantity_received: number;
  total_value: number;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  item_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  created_at: string;
}

// PO item joined with item name/sku/unit, for the receive dialog
export interface PurchaseOrderItemWithDetails extends PurchaseOrderItem {
  item_name: string;
  item_sku: string;
  item_unit: string;
}

export interface NewPurchaseOrderLine {
  item_id: string;
  quantity_ordered: number;
  unit_cost: number;
}

// ---------------------------------------------------------------------
// Phase 3: Issuing Stock to Staff
// ---------------------------------------------------------------------

export type InventoryIssueStatus = 'issued' | 'partially_returned' | 'returned';

// A profiles row scoped to role = 'teacher' -- used for "Issued To" in Issues
export interface TeacherProfile {
  id: string;
  school_id: string;
  full_name: string;
  role: string;
  designation: string | null;
  department: string | null;
  email: string | null;
}

export interface InventoryIssue {
  id: string;
  school_id: string;
  warehouse_id: string;
  teacher_id: string;
  issue_date: string;
  purpose: string | null;
  status: InventoryIssueStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Shape returned by inventory_issues_with_summary view
export interface InventoryIssueWithSummary extends InventoryIssue {
  warehouse_name: string;
  teacher_name: string;
  total_quantity_issued: number;
  total_quantity_returned: number;
}

export interface InventoryIssueItem {
  id: string;
  issue_id: string;
  item_id: string;
  quantity_issued: number;
  quantity_returned: number;
  created_at: string;
}

export interface InventoryIssueItemWithDetails extends InventoryIssueItem {
  item_name: string;
  item_sku: string;
  item_unit: string;
}

export interface NewIssueLine {
  item_id: string;
  quantity: number;
}

// ---------------------------------------------------------------------
// Phase 4: Movement History
// ---------------------------------------------------------------------

// Shape returned by inventory_movements_with_details view
export interface InventoryMovementWithDetails {
  id: string;
  school_id: string;
  item_id: string;
  item_name: string;
  item_sku: string;
  item_unit: string;
  warehouse_id: string;
  warehouse_name: string;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}
