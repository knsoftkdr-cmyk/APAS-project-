import { AppLayout } from "@/components/layout/AppLayout";
import { SafeguardingDashboard } from "@/components/safeguarding/SafeguardingDashboard";

export default function SafeguardingPage() {
  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto">
        <SafeguardingDashboard />
      </div>
    </AppLayout>
  );
}