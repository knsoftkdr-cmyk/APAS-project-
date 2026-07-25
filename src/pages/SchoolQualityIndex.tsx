import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import SchoolQualityIndex from "@/components/dashboard/SchoolQualityIndex";

export default function SchoolQualityIndexPage() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;

  return (
    <AppLayout>
      <div className="mx-auto max-w-md px-4 py-8">
        {!schoolId ? (
          <p className="text-center text-sm text-slate-400">Loading school info…</p>
        ) : (
          <SchoolQualityIndex schoolId={schoolId} />
        )}
      </div>
    </AppLayout>
  );
}
