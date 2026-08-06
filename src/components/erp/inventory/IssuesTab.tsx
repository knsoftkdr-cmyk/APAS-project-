// src/components/erp/inventory/IssuesTab.tsx

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
} from '@/components/ui/dialog';
import { Plus, Trash2, Undo2 } from 'lucide-react';
import type {
  InventoryIssueWithSummary,
  InventoryIssueItemWithDetails,
  InventoryIssueStatus,
  TeacherProfile,
  InventoryWarehouse,
  InventoryItem,
  NewIssueLine,
} from '@/types/inventory';

const STATUS_VARIANT: Record<InventoryIssueStatus, 'default' | 'secondary' | 'outline'> = {
  issued: 'secondary',
  partially_returned: 'outline',
  returned: 'default',
};

const STATUS_LABEL: Record<InventoryIssueStatus, string> = {
  issued: 'Issued',
  partially_returned: 'Partially Returned',
  returned: 'Returned',
};

export default function IssuesTab({
  schoolId,
  userId,
}: {
  schoolId: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [returnIssue, setReturnIssue] = useState<InventoryIssueWithSummary | null>(null);

  const { data: issues, isLoading } = useQuery({
    queryKey: ['inventory-issues', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_issues_with_summary')
        .select('*')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as InventoryIssueWithSummary[];
    },
    enabled: !!schoolId,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Issue
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Issued To</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Issued</TableHead>
              <TableHead className="text-right">Returned</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  Loading issues...
                </TableCell>
              </TableRow>
            ) : !issues?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  No stock has been issued yet.
                </TableCell>
              </TableRow>
            ) : (
              issues.map((iss) => (
                <TableRow key={iss.id}>
                  <TableCell className="font-medium">{iss.teacher_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {iss.warehouse_name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {iss.purpose ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[iss.status]}>
                      {STATUS_LABEL[iss.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {iss.total_quantity_issued}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {iss.total_quantity_returned}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(iss.issue_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {iss.status !== 'returned' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Record return"
                        onClick={() => setReturnIssue(iss)}
                      >
                        <Undo2 className="h-4 w-4" />
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
        <CreateIssueDialog
          schoolId={schoolId}
          userId={userId}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {returnIssue && (
        <ReturnIssueDialog
          issue={returnIssue}
          userId={userId}
          onClose={() => setReturnIssue(null)}
        />
      )}
    </div>
  );
}

// =========================================================================
// Create Issue Dialog
// =========================================================================
function CreateIssueDialog({
  schoolId,
  userId,
  onClose,
}: {
  schoolId: string;
  userId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [teacherId, setTeacherId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [lines, setLines] = useState<NewIssueLine[]>([{ item_id: '', quantity: 1 }]);

  const { data: teachers } = useQuery({
    queryKey: ['teachers-for-issue', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, school_id, full_name, role, designation, department, email')
        .eq('school_id', schoolId)
        .eq('role', 'teacher')
        .order('full_name');
      if (error) throw error;
      return data as TeacherProfile[];
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

  // Available stock for the chosen warehouse, so the UI can warn before
  // the server-side check in create_inventory_issue() rejects it.
  const { data: stockInWarehouse } = useQuery({
    queryKey: ['inventory-stock-for-warehouse', warehouseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_stock')
        .select('item_id, quantity_on_hand')
        .eq('warehouse_id', warehouseId);
      if (error) throw error;
      return data as { item_id: string; quantity_on_hand: number }[];
    },
    enabled: !!warehouseId,
  });

  const availableFor = (itemId: string) =>
    stockInWarehouse?.find((s) => s.item_id === itemId)?.quantity_on_hand ?? 0;

  const updateLine = (index: number, patch: Partial<NewIssueLine>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { item_id: '', quantity: 1 }]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const validLines = lines.filter((l) => l.item_id && l.quantity > 0);
  const hasOverage = validLines.some((l) => l.quantity > availableFor(l.item_id));

  const createIssue = useMutation({
    mutationFn: async () => {
      if (!teacherId) throw new Error('Select which teacher this is being issued to');
      if (!warehouseId) throw new Error('Select a warehouse');
      if (!validLines.length) throw new Error('Add at least one line item');

      const { error } = await supabase.rpc('create_inventory_issue', {
        p_school_id: schoolId,
        p_warehouse_id: warehouseId,
        p_teacher_id: teacherId,
        p_purpose: purpose.trim() || null,
        p_created_by: userId,
        p_lines: validLines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Stock issued');
      queryClient.invalidateQueries({ queryKey: ['inventory-issues', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items', schoolId] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to issue stock');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Issue</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Issued To (Teacher)</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select teacher" />
                </SelectTrigger>
                <SelectContent>
                  {teachers?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.full_name}
                      {t.designation ? ` — ${t.designation}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Purpose</Label>
            <Textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Class 8 science lab session"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add Line
              </Button>
            </div>

            <div className="space-y-2">
              {lines.map((line, i) => {
                const available = line.item_id ? availableFor(line.item_id) : null;
                const overage = available !== null && line.quantity > available;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-end gap-2 rounded-md border p-2">
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
                      <div className="w-28 space-y-1">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(i, { quantity: parseFloat(e.target.value) || 0 })
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
                    {line.item_id && (
                      <p className={`text-xs px-1 ${overage ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {available} available in selected warehouse
                        {overage ? ' — not enough stock' : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => createIssue.mutate()}
            disabled={
              !teacherId || !warehouseId || !validLines.length || hasOverage || createIssue.isPending
            }
          >
            {createIssue.isPending ? 'Issuing...' : 'Issue Stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// Return Issue Dialog
// =========================================================================
function ReturnIssueDialog({
  issue,
  userId,
  onClose,
}: {
  issue: InventoryIssueWithSummary;
  userId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [returnLines, setReturnLines] = useState<
    Record<string, { quantity: number; condition: 'good' | 'damaged' | 'lost'; notes: string }>
  >({});

  const updateReturnLine = (
    lineId: string,
    patch: Partial<{ quantity: number; condition: 'good' | 'damaged' | 'lost'; notes: string }>
  ) => {
    setReturnLines((prev) => ({
      ...prev,
      [lineId]: {
        quantity: prev[lineId]?.quantity ?? 0,
        condition: prev[lineId]?.condition ?? 'good',
        notes: prev[lineId]?.notes ?? '',
        ...patch,
      },
    }));
  };

  const { data: lines, isLoading } = useQuery({
    queryKey: ['inventory-issue-items', issue.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_issue_items')
        .select('*, inventory_items(name, sku, unit)')
        .eq('issue_id', issue.id);
      if (error) throw error;
      return (data as any[]).map((row) => ({
        ...row,
        item_name: row.inventory_items?.name ?? '',
        item_sku: row.inventory_items?.sku ?? '',
        item_unit: row.inventory_items?.unit ?? '',
      })) as InventoryIssueItemWithDetails[];
    },
  });

  const returnAll = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(returnLines).filter(([, l]) => l.quantity > 0);
      if (!entries.length) throw new Error('Enter a quantity to return for at least one line');

      for (const [issueItemId, line] of entries) {
        const { error } = await supabase.rpc('return_inventory_issue_item', {
          p_issue_item_id: issueItemId,
          p_quantity: line.quantity,
          p_condition: line.condition,
          p_notes: line.notes.trim() || null,
          p_created_by: userId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Return recorded');
      queryClient.invalidateQueries({ queryKey: ['inventory-issues', issue.school_id] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items', issue.school_id] });
      queryClient.invalidateQueries({ queryKey: ['inventory-issue-items', issue.id] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to record return');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Return — {issue.teacher_name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Returning into <span className="font-medium">{issue.warehouse_name}</span>. "Good"
          adds the quantity back to usable stock. "Damaged" or "Lost" closes it out against{' '}
          {issue.teacher_name} without restocking it.
        </p>

        <div className="space-y-3 py-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading items...</p>
          ) : (
            lines?.map((line) => {
              const remaining = line.quantity_issued - line.quantity_returned;
              const current = returnLines[line.id] ?? {
                quantity: 0,
                condition: 'good' as const,
                notes: '',
              };
              const isDamagedOrLost = current.condition !== 'good';
              return (
                <div key={line.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{line.item_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Issued {line.quantity_issued} {line.item_unit} · Resolved{' '}
                        {line.quantity_returned} · Outstanding {remaining}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={current.condition}
                        onValueChange={(v) =>
                          updateReturnLine(line.id, { condition: v as 'good' | 'damaged' | 'lost' })
                        }
                        disabled={remaining <= 0}
                      >
                        <SelectTrigger className="w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="good">Good</SelectItem>
                          <SelectItem value="damaged">Damaged</SelectItem>
                          <SelectItem value="lost">Lost</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min={0}
                        max={remaining}
                        step="0.01"
                        className="w-20"
                        disabled={remaining <= 0}
                        value={current.quantity || ''}
                        onChange={(e) =>
                          updateReturnLine(line.id, {
                            quantity: parseFloat(e.target.value) || 0,
                          })
                        }
                        placeholder="0"
                      />
                    </div>
                  </div>
                  {isDamagedOrLost && current.quantity > 0 && (
                    <Input
                      value={current.notes}
                      onChange={(e) => updateReturnLine(line.id, { notes: e.target.value })}
                      placeholder={
                        current.condition === 'damaged'
                          ? 'What happened to it? (optional)'
                          : 'Where/how was it lost? (optional)'
                      }
                      className="text-sm"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => returnAll.mutate()} disabled={returnAll.isPending}>
            {returnAll.isPending ? 'Recording...' : 'Confirm Return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
