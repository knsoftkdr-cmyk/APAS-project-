// src/components/erp/inventory/PurchaseOrdersTab.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Trash2, PackageCheck } from 'lucide-react';
import type {
  PurchaseOrderWithSummary,
  PurchaseOrderItemWithDetails,
  PurchaseOrderStatus,
  InventoryVendor,
  InventoryWarehouse,
  InventoryItem,
  NewPurchaseOrderLine,
} from '@/types/inventory';

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  ordered: 'secondary',
  partially_received: 'secondary',
  received: 'default',
  cancelled: 'destructive',
};

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export default function PurchaseOrdersTab({
  schoolId,
  userId,
}: {
  schoolId: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrderWithSummary | null>(null);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['purchase-orders', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders_with_summary')
        .select('*')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as PurchaseOrderWithSummary[];
    },
    enabled: !!schoolId,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Purchase Order
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO Number</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  Loading purchase orders...
                </TableCell>
              </TableRow>
            ) : !orders?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  No purchase orders yet.
                </TableCell>
              </TableRow>
            ) : (
              orders.map((po) => (
                <TableRow key={po.id}>
                  <TableCell className="font-mono text-xs">{po.po_number}</TableCell>
                  <TableCell className="font-medium">{po.vendor_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {po.warehouse_name}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[po.status]}>
                      {STATUS_LABEL[po.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {po.total_quantity_ordered}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {po.total_quantity_received}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {po.total_value.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {po.status !== 'received' && po.status !== 'cancelled' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Receive stock"
                        onClick={() => setReceiveOrder(po)}
                      >
                        <PackageCheck className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {createOpen && (
        <CreatePurchaseOrderDialog
          schoolId={schoolId}
          userId={userId}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {receiveOrder && (
        <ReceivePurchaseOrderDialog
          order={receiveOrder}
          userId={userId}
          onClose={() => setReceiveOrder(null)}
        />
      )}
    </div>
  );
}

// =========================================================================
// Create Purchase Order Dialog
// =========================================================================
function CreatePurchaseOrderDialog({
  schoolId,
  userId,
  onClose,
}: {
  schoolId: string;
  userId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [vendorId, setVendorId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<NewPurchaseOrderLine[]>([
    { item_id: '', quantity_ordered: 1, unit_cost: 0 },
  ]);

  const { data: vendors } = useQuery({
    queryKey: ['inventory-vendors', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_vendors')
        .select('*')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as InventoryVendor[];
    },
    enabled: !!schoolId,
  });

  const { data: warehouses } = useQuery({
    queryKey: ['inventory-warehouses', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_warehouses')
        .select('*')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .order('is_default', { ascending: false });
      if (error) throw error;
      return data as InventoryWarehouse[];
    },
    enabled: !!schoolId,
  });

  const { data: items } = useQuery({
    queryKey: ['inventory-items-simple', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as InventoryItem[];
    },
    enabled: !!schoolId,
  });

  const updateLine = (index: number, patch: Partial<NewPurchaseOrderLine>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const addLine = () => {
    setLines((prev) => [...prev, { item_id: '', quantity_ordered: 1, unit_cost: 0 }]);
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const validLines = lines.filter((l) => l.item_id && l.quantity_ordered > 0);

  const createPO = useMutation({
    mutationFn: async () => {
      if (!vendorId) throw new Error('Select a vendor');
      if (!warehouseId) throw new Error('Select a destination warehouse');
      if (!validLines.length) throw new Error('Add at least one line item');

      const { data: po, error: poError } = await supabase
        .from('purchase_orders')
        .insert({
          school_id: schoolId,
          vendor_id: vendorId,
          warehouse_id: warehouseId,
          status: 'ordered',
          order_date: orderDate,
          expected_date: expectedDate || null,
          notes: notes.trim() || null,
          created_by: userId,
        })
        .select()
        .single();
      if (poError) throw poError;

      const { error: linesError } = await supabase.from('purchase_order_items').insert(
        validLines.map((l) => ({
          purchase_order_id: po.id,
          item_id: l.item_id,
          quantity_ordered: l.quantity_ordered,
          unit_cost: l.unit_cost,
        }))
      );
      if (linesError) throw linesError;
    },
    onSuccess: () => {
      toast.success('Purchase order created');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', schoolId] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to create purchase order');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Purchase Order</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors?.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Destination Warehouse</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses?.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Order Date</Label>
              <Input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Expected Date</Label>
              <Input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line Items</Label>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add Line
              </Button>
            </div>

            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="flex items-end gap-2 rounded-md border p-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Item</Label>
                    <Select
                      value={line.item_id}
                      onValueChange={(v) => updateLine(i, { item_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        {items?.map((it) => (
                          <SelectItem key={it.id} value={it.id}>
                            {it.name} ({it.sku})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Qty</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.quantity_ordered}
                      onChange={(e) =>
                        updateLine(i, { quantity_ordered: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    <Label className="text-xs">Unit Cost</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unit_cost}
                      onChange={(e) =>
                        updateLine(i, { unit_cost: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => createPO.mutate()}
            disabled={!vendorId || !warehouseId || !validLines.length || createPO.isPending}
          >
            {createPO.isPending ? 'Creating...' : 'Create Purchase Order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// Receive Purchase Order Dialog
// =========================================================================
function ReceivePurchaseOrderDialog({
  order,
  userId,
  onClose,
}: {
  order: PurchaseOrderWithSummary;
  userId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});

  const { data: lines, isLoading } = useQuery({
    queryKey: ['purchase-order-items', order.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('*, inventory_items(name, sku, unit)')
        .eq('purchase_order_id', order.id);
      if (error) throw error;
      return (data as any[]).map((row) => ({
        ...row,
        item_name: row.inventory_items?.name ?? '',
        item_sku: row.inventory_items?.sku ?? '',
        item_unit: row.inventory_items?.unit ?? '',
      })) as PurchaseOrderItemWithDetails[];
    },
  });

  const receiveAll = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(receiveQty).filter(([, qty]) => qty > 0);
      if (!entries.length) throw new Error('Enter a quantity to receive for at least one line');

      for (const [poItemId, qty] of entries) {
        const { error } = await supabase.rpc('receive_purchase_order_item', {
          p_po_item_id: poItemId,
          p_quantity: qty,
          p_created_by: userId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Stock received');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', order.school_id] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items', order.school_id] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-items', order.id] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to receive stock');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive Stock — {order.po_number}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Receiving into <span className="font-medium">{order.warehouse_name}</span>. Enter
          quantities for what has actually arrived — partial receipts are fine.
        </p>

        <div className="space-y-3 py-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading line items...</p>
          ) : (
            lines?.map((line) => {
              const remaining = line.quantity_ordered - line.quantity_received;
              return (
                <div key={line.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{line.item_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Ordered {line.quantity_ordered} {line.item_unit} · Received{' '}
                      {line.quantity_received} · Remaining {remaining}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={remaining}
                    step="0.01"
                    className="w-24"
                    disabled={remaining <= 0}
                    value={receiveQty[line.id] ?? ''}
                    onChange={(e) =>
                      setReceiveQty({
                        ...receiveQty,
                        [line.id]: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0"
                  />
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => receiveAll.mutate()} disabled={receiveAll.isPending}>
            {receiveAll.isPending ? 'Receiving...' : 'Confirm Receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
