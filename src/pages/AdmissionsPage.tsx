import { AppLayout } from "@/components/layout/AppLayout";
import { AdmissionDashboard } from "@/components/admission/AdmissionDashboard";

export default function AdmissionsPage() {
  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto">
        <AdmissionDashboard />
      </div>
    </AppLayout>
  );
}
