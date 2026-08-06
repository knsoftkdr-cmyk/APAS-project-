// src/components/erp/inventory/ItemsTab.tsx

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
import { Plus, Pencil, PackagePlus, AlertTriangle } from 'lucide-react';
import type {
  InventoryItemWithStock,
  InventoryWarehouse,
  InventoryCategory,
  InventoryItemFormValues,
} from '@/types/inventory';

const UNIT_OPTIONS = ['pcs', 'box', 'kg', 'g', 'ltr', 'ml', 'ream', 'set', 'pair'];

const emptyForm: InventoryItemFormValues = {
  sku: '',
  name: '',
  description: '',
  category_id: null,
  unit: 'pcs',
  cost_price: 0,
  reorder_point: 0,
};

export default function ItemsTab({ schoolId, userId }: { schoolId: string; userId: string }) {
  const queryClient = useQueryClient();

  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItemWithStock | null>(null);
  const [form, setForm] = useState<InventoryItemFormValues>(emptyForm);

  const [adjustDialogItem, setAdjustDialogItem] = useState<InventoryItemWithStock | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ['inventory-items', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items_with_stock')
        .select('*')
        .eq('school_id', schoolId)
        .order('name');
      if (error) throw error;
      return data as InventoryItemWithStock[];
    },
    enabled: !!schoolId,
  });

  const { data: categories } = useQuery({
    queryKey: ['inventory-categories', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_categories')
        .select('*')
        .eq('school_id', schoolId)
        .order('name');
      if (error) throw error;
      return data as InventoryCategory[];
    },
    enabled: !!schoolId,
  });

  const openCreateDialog = () => {
    setEditingItem(null);
    setForm(emptyForm);
    setItemDialogOpen(true);
  };

  const openEditDialog = (item: InventoryItemWithStock) => {
    setEditingItem(item);
    setForm({
      sku: item.sku,
      name: item.name,
      description: item.description ?? '',
      category_id: item.category_id,
      unit: item.unit,
      cost_price: item.cost_price,
      reorder_point: item.reorder_point,
    });
    setItemDialogOpen(true);
  };

  const saveItem = useMutation({
    mutationFn: async () => {
      if (!schoolId) throw new Error('No school context');
      const payload = {
        school_id: schoolId,
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id,
        unit: form.unit,
        cost_price: form.cost_price,
        reorder_point: form.reorder_point,
      };

      if (editingItem) {
        const { error } = await supabase
          .from('inventory_items')
          .update(payload)
          .eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('inventory_items').insert({
          ...payload,
          created_by: userId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingItem ? 'Item updated' : 'Item created');
      queryClient.invalidateQueries({ queryKey: ['inventory-items', schoolId] });
      setItemDialogOpen(false);
    },
    onError: (err: any) => {
      // Surface unique-constraint violation on (school_id, sku) clearly
      if (err?.code === '23505') {
        toast.error('That SKU is already in use at this school.');
      } else {
        toast.error(err?.message ?? 'Failed to save item');
      }
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          New Item
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">On Hand</TableHead>
              <TableHead className="text-right">Reorder At</TableHead>
              <TableHead className="w-[110px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  Loading items...
                </TableCell>
              </TableRow>
            ) : !items?.length ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  No items yet. Create your first item to start tracking stock.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {item.name}
                      {item.is_low_stock && (
                        <Badge variant="destructive" className="gap-1 text-[10px]">
                          <AlertTriangle className="h-3 w-3" />
                          Low stock
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.category_name ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">{item.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.total_quantity_on_hand}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {item.reorder_point}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Adjust stock"
                        onClick={() => setAdjustDialogItem(item)}
                      >
                        <PackagePlus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit item"
                        onClick={() => openEditDialog(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Item Dialog */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'New Item'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="item-sku">SKU</Label>
              <Input
                id="item-sku"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="e.g. LAB-BEAKER-250"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-unit">Unit</Label>
              <Select
                value={form.unit}
                onValueChange={(v) => setForm({ ...form, unit: v })}
              >
                <SelectTrigger id="item-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="item-name">Name</Label>
              <Input
                id="item-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Glass Beaker 250ml"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="item-desc">Description</Label>
              <Textarea
                id="item-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-category">Category</Label>
              <Select
                value={form.category_id ?? 'none'}
                onValueChange={(v) =>
                  setForm({ ...form, category_id: v === 'none' ? null : v })
                }
              >
                <SelectTrigger id="item-category">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-cost">Cost Price</Label>
              <Input
                id="item-cost"
                type="number"
                min={0}
                step="0.01"
                value={form.cost_price}
                onChange={(e) =>
                  setForm({ ...form, cost_price: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="item-reorder">Reorder Point</Label>
              <Input
                id="item-reorder"
                type="number"
                min={0}
                step="0.01"
                value={form.reorder_point}
                onChange={(e) =>
                  setForm({ ...form, reorder_point: parseFloat(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">
                You'll see a "Low stock" badge once total quantity on hand drops to or below
                this number.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveItem.mutate()}
              disabled={!form.sku.trim() || !form.name.trim() || saveItem.isPending}
            >
              {saveItem.isPending ? 'Saving...' : editingItem ? 'Save Changes' : 'Create Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Adjust Dialog */}
      {adjustDialogItem && (
        <StockAdjustDialog
          item={adjustDialogItem}
          schoolId={schoolId}
          userId={userId}
          onClose={() => setAdjustDialogItem(null)}
        />
      )}
    </div>
  );
}

function StockAdjustDialog({
  item,
  schoolId,
  userId,
  onClose,
}: {
  item: InventoryItemWithStock;
  schoolId: string;
  userId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [delta, setDelta] = useState<number>(0);
  const [notes, setNotes] = useState('');

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

  const submit = useMutation({
    mutationFn: async () => {
      if (!warehouseId) throw new Error('Select a warehouse');
      if (!delta) throw new Error('Enter a non-zero quantity change');
      const { error } = await supabase.from('inventory_stock_movements').insert({
        school_id: schoolId,
        item_id: item.id,
        warehouse_id: warehouseId,
        movement_type: 'manual_adjustment',
        quantity_delta: delta,
        notes: notes.trim() || null,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Stock adjusted');
      queryClient.invalidateQueries({ queryKey: ['inventory-items', schoolId] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to adjust stock');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Stock — {item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {warehouses?.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                    {w.is_default ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-delta">Quantity change</Label>
            <Input
              id="adjust-delta"
              type="number"
              step="0.01"
              value={delta}
              onChange={(e) => setDelta(parseFloat(e.target.value) || 0)}
              placeholder="e.g. 50 to add, -5 to remove"
            />
            <p className="text-xs text-muted-foreground">
              Positive adds stock, negative removes stock. Current on-hand across all
              warehouses: {item.total_quantity_on_hand}.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-notes">Notes</Label>
            <Textarea
              id="adjust-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for adjustment (optional)"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => submit.mutate()}
            disabled={!warehouseId || !delta || submit.isPending}
          >
            {submit.isPending ? 'Saving...' : 'Apply Adjustment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
