// src/components/erp/inventory/HistoryTab.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import type {
  InventoryMovementWithDetails,
  InventoryMovementType,
  InventoryItem,
  InventoryWarehouse,
} from '@/types/inventory';

const MOVEMENT_LABEL: Record<InventoryMovementType, string> = {
  opening_stock: 'Opening Stock',
  manual_adjustment: 'Manual Adjustment',
  purchase_receipt: 'Purchase Receipt',
  issue: 'Issued',
  issue_return: 'Returned',
  issue_damage_writeoff: 'Damaged/Lost',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
};

const MOVEMENT_VARIANT: Record<
  InventoryMovementType,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  opening_stock: 'outline',
  manual_adjustment: 'secondary',
  purchase_receipt: 'default',
  issue: 'destructive',
  issue_return: 'default',
  issue_damage_writeoff: 'destructive',
  transfer_in: 'default',
  transfer_out: 'destructive',
};

const ALL_MOVEMENT_TYPES: InventoryMovementType[] = [
  'opening_stock',
  'manual_adjustment',
  'purchase_receipt',
  'issue',
  'issue_return',
  'issue_damage_writeoff',
  'transfer_in',
  'transfer_out',
];

export default function HistoryTab({ schoolId }: { schoolId: string }) {
  const [itemFilter, setItemFilter] = useState<string>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const { data: items } = useQuery({
    queryKey: ['inventory-items-simple', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('school_id', schoolId)
        .order('name');
      if (error) throw error;
      return data as InventoryItem[];
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
        .order('name');
      if (error) throw error;
      return data as InventoryWarehouse[];
    },
    enabled: !!schoolId,
  });

  const { data: movements, isLoading } = useQuery({
    queryKey: ['inventory-movements', schoolId, itemFilter, warehouseFilter, typeFilter],
    queryFn: async () => {
      let query = supabase
        .from('inventory_movements_with_details')
        .select('*')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (itemFilter !== 'all') query = query.eq('item_id', itemFilter);
      if (warehouseFilter !== 'all') query = query.eq('warehouse_id', warehouseFilter);
      if (typeFilter !== 'all') query = query.eq('movement_type', typeFilter);

      const { data, error } = await query;
      if (error) throw error;
      return data as InventoryMovementWithDetails[];
    },
    enabled: !!schoolId,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select value={itemFilter} onValueChange={setItemFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All items" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            {items?.map((it) => (
              <SelectItem key={it.id} value={it.id}>
                {it.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All warehouses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All warehouses</SelectItem>
            {warehouses?.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All movement types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All movement types</SelectItem>
            {ALL_MOVEMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {MOVEMENT_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  Loading history...
                </TableCell>
              </TableRow>
            ) : !movements?.length ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  No stock movements match these filters.
                </TableCell>
              </TableRow>
            ) : (
              movements.map((m) => {
                const isPositive = m.quantity_delta > 0;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">
                      {m.item_name}
                      <span className="text-xs text-muted-foreground ml-1">({m.item_sku})</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.warehouse_name}
                    </TableCell>
                    <TableCell>
                      <Badge variant={MOVEMENT_VARIANT[m.movement_type]}>
                        {MOVEMENT_LABEL[m.movement_type]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={`inline-flex items-center gap-1 ${
                          isPositive ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {isPositive ? (
                          <ArrowUpCircle className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownCircle className="h-3.5 w-3.5" />
                        )}
                        {isPositive ? '+' : ''}
                        {m.quantity_delta} {m.item_unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.created_by_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {m.notes ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
