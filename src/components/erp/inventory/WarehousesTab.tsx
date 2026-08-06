// src/components/erp/inventory/WarehousesTab.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Star } from 'lucide-react';
import type { InventoryWarehouse } from '@/types/inventory';

export default function WarehousesTab({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const { data: warehouses, isLoading } = useQuery({
    queryKey: ['inventory-warehouses', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_warehouses')
        .select('*')
        .eq('school_id', schoolId)
        .order('is_default', { ascending: false })
        .order('name');
      if (error) throw error;
      return data as InventoryWarehouse[];
    },
    enabled: !!schoolId,
  });

  const createWarehouse = useMutation({
    mutationFn: async () => {
      if (!schoolId) throw new Error('No school context');

      // If marking this one default, clear the existing default first
      // (unique partial index also enforces this, but we clear proactively
      // to avoid a 409 from the DB).
      if (isDefault) {
        await supabase
          .from('inventory_warehouses')
          .update({ is_default: false })
          .eq('school_id', schoolId)
          .eq('is_default', true);
      }

      const { error } = await supabase.from('inventory_warehouses').insert({
        school_id: schoolId,
        name: name.trim(),
        location_notes: notes.trim() || null,
        is_default: isDefault,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Warehouse created');
      queryClient.invalidateQueries({ queryKey: ['inventory-warehouses', schoolId] });
      setDialogOpen(false);
      setName('');
      setNotes('');
      setIsDefault(false);
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to create warehouse');
    },
  });

  const setAsDefault = useMutation({
    mutationFn: async (warehouseId: string) => {
      if (!schoolId) throw new Error('No school context');
      await supabase
        .from('inventory_warehouses')
        .update({ is_default: false })
        .eq('school_id', schoolId)
        .eq('is_default', true);
      const { error } = await supabase
        .from('inventory_warehouses')
        .update({ is_default: true })
        .eq('id', warehouseId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Default warehouse updated');
      queryClient.invalidateQueries({ queryKey: ['inventory-warehouses', schoolId] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to update default warehouse');
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Warehouse
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Warehouse</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="wh-name">Name</Label>
                <Input
                  id="wh-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Main Store, Lab Store"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wh-notes">Location notes</Label>
                <Textarea
                  id="wh-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Set as default warehouse</p>
                  <p className="text-xs text-muted-foreground">
                    Used as the default location for new stock adjustments.
                  </p>
                </div>
                <Switch checked={isDefault} onCheckedChange={setIsDefault} />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createWarehouse.mutate()}
                disabled={!name.trim() || createWarehouse.isPending}
              >
                {createWarehouse.isPending ? 'Creating...' : 'Create Warehouse'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading warehouses...</p>
      ) : !warehouses?.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No warehouses yet. Create one to start tracking stock.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {warehouses.map((wh) => (
            <Card key={wh.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{wh.name}</span>
                  {wh.is_default && (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="h-3 w-3" />
                      Default
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {wh.location_notes && (
                  <p className="text-sm text-muted-foreground">{wh.location_notes}</p>
                )}
                {!wh.is_default && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAsDefault.mutate(wh.id)}
                    disabled={setAsDefault.isPending}
                  >
                    Set as default
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
