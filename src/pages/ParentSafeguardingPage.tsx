import { AppLayout } from "@/components/layout/AppLayout";
import { ParentSafeguardingView } from "@/components/safeguarding/ParentSafeguardingView";

export default function ParentSafeguardingPage() {
  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto">
        <ParentSafeguardingView />
      </div>
    </AppLayout>
  );
}