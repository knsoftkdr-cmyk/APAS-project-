import { useState } from "react";
import { AdminInstalmentTracker } from "./AdminInstalmentTracker";
import { AdminRequests } from "./AdminRequests";
import { AdminSettings } from "./AdminSettings";

const SUB = [["tracking", "Overview & tracking"], ["requests", "Requests"], ["settings", "Settings"]] as const;

/** The "Instalments" tab of the existing ERP Fees page: dashboard + tracking, request review, and school settings. */
export function InstalmentsAdminTab({ schoolId }: { schoolId: string }) {
  const [sub, setSub] = useState<(typeof SUB)[number][0]>("tracking");
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);
  return (
    <div className="space-y-5">
      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 overflow-hidden" role="tablist" aria-label="Instalment sections">
        {SUB.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sub === k} onClick={() => setSub(k)} className={`px-4 py-2 text-sm font-medium ${sub === k ? "bg-[#12203a] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      {sub === "tracking" && <AdminInstalmentTracker schoolId={schoolId} refreshKey={refreshKey} onChanged={bump} />}
      {sub === "requests" && <AdminRequests schoolId={schoolId} onChanged={bump} />}
      {sub === "settings" && <AdminSettings schoolId={schoolId} />}
    </div>
  );
}
