// src/components/erp/inventory/VendorsTab.tsx

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Plus } from 'lucide-react';
import type { InventoryVendor } from '@/types/inventory';

const emptyForm = {
  name: '',
  contact_person: '',
  email: '',
  phone: '',
  address: '',
  tax_id: '',
};

export default function VendorsTab({
  schoolId,
  userId,
}: {
  schoolId: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data: vendors, isLoading } = useQuery({
    queryKey: ['inventory-vendors', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_vendors')
        .select('*')
        .eq('school_id', schoolId)
        .order('name');
      if (error) throw error;
      return data as InventoryVendor[];
    },
    enabled: !!schoolId,
  });

  const createVendor = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('inventory_vendors').insert({
        school_id: schoolId,
        name: form.name.trim(),
        contact_person: form.contact_person.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        tax_id: form.tax_id.trim() || null,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Vendor added');
      queryClient.invalidateQueries({ queryKey: ['inventory-vendors', schoolId] });
      setDialogOpen(false);
      setForm(emptyForm);
    },
    onError: (err: any) => {
      if (err?.code === '23505') {
        toast.error('A vendor with that name already exists.');
      } else {
        toast.error(err?.message ?? 'Failed to add vendor');
      }
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Vendor
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New Vendor</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="v-name">Vendor Name</Label>
                <Input
                  id="v-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. ABC Lab Supplies"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-contact">Contact Person</Label>
                <Input
                  id="v-contact"
                  value={form.contact_person}
                  onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-phone">Phone</Label>
                <Input
                  id="v-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-email">Email</Label>
                <Input
                  id="v-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-tax">Tax ID / GSTIN</Label>
                <Input
                  id="v-tax"
                  value={form.tax_id}
                  onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="v-address">Address</Label>
                <Textarea
                  id="v-address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createVendor.mutate()}
                disabled={!form.name.trim() || createVendor.isPending}
              >
                {createVendor.isPending ? 'Adding...' : 'Add Vendor'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                  Loading vendors...
                </TableCell>
              </TableRow>
            ) : !vendors?.length ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                  No vendors yet. Add one before creating a purchase order.
                </TableCell>
              </TableRow>
            ) : (
              vendors.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {v.contact_person ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">{v.phone ?? '—'}</TableCell>
                  <TableCell className="text-sm">{v.email ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
