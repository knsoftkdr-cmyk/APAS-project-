import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { IncidentReportForm } from "@/components/safeguarding/IncidentReportForm";
import { MyIncidentReports } from "@/components/safeguarding/MyIncidentReports";

export default function TeacherSafeguardingReport() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <AppLayout>
      <div className="p-6 max-w-2xl mx-auto">
        <IncidentReportForm onSubmitted={() => setRefreshKey((k) => k + 1)} />
        <MyIncidentReports key={refreshKey} />
      </div>
    </AppLayout>
  );
}