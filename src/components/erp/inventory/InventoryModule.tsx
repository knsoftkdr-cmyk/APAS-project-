// src/components/erp/inventory/InventoryModule.tsx
// Entry point for the Inventory & Procurement module.
// Mount this as a route/tab inside ERPDashboard.tsx, guarded the same way
// other ERP routes are (profiles.erp_access).

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Boxes, Warehouse, Truck, ClipboardList, HandCoins, History } from 'lucide-react';
import ItemsTab from './ItemsTab';
import WarehousesTab from './WarehousesTab';
import VendorsTab from './VendorsTab';
import PurchaseOrdersTab from './PurchaseOrdersTab';
import IssuesTab from './IssuesTab';
import HistoryTab from './HistoryTab';

interface InventoryModuleProps {
  schoolId: string;
  userId: string;
}

export default function InventoryModule({ schoolId, userId }: InventoryModuleProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory &amp; Procurement</h1>
        <p className="text-sm text-muted-foreground">
          Track items, stock levels, warehouses, vendors, purchase orders, staff issues, and
          movement history for your school.
        </p>
      </div>

      <Tabs defaultValue="items" className="w-full">
        <TabsList>
          <TabsTrigger value="items" className="gap-2">
            <Boxes className="h-4 w-4" />
            Items
          </TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-2">
            <Warehouse className="h-4 w-4" />
            Warehouses
          </TabsTrigger>
          <TabsTrigger value="vendors" className="gap-2">
            <Truck className="h-4 w-4" />
            Vendors
          </TabsTrigger>
          <TabsTrigger value="purchase-orders" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Purchase Orders
          </TabsTrigger>
          <TabsTrigger value="issues" className="gap-2">
            <HandCoins className="h-4 w-4" />
            Issues
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-4">
          <ItemsTab schoolId={schoolId} userId={userId} />
        </TabsContent>

        <TabsContent value="warehouses" className="mt-4">
          <WarehousesTab schoolId={schoolId} />
        </TabsContent>

        <TabsContent value="vendors" className="mt-4">
          <VendorsTab schoolId={schoolId} userId={userId} />
        </TabsContent>

        <TabsContent value="purchase-orders" className="mt-4">
          <PurchaseOrdersTab schoolId={schoolId} userId={userId} />
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
          <IssuesTab schoolId={schoolId} userId={userId} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab schoolId={schoolId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
