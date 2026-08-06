import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface DriverRow {
  id: string;
  name: string;
  license_document_url: string | null;
  background_verification_document_url: string | null;
  medical_certificate_document_url: string | null;
}

interface AssignedRoute {
  id: string;
  route_name: string;
  vehicle_id: string | null;
  vehicles: {
    registration_number: string;
    insurance_document_url: string | null;
    fitness_document_url: string | null;
    puc_document_url: string | null;
    rc_document_url: string | null;
  } | null;
}

function DriverDocumentRow({ label, path }: { label: string; path: string | null }) {
  const handleView = async () => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("transport-documents").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Failed to open document");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };
  return (
    <div className="flex items-center justify-between border-b last:border-b-0 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {path ? (
        <button
          type="button"
          onClick={handleView}
          className="text-emerald-600 hover:underline inline-flex items-center gap-1"
        >
          <ExternalLink className="h-3.5 w-3.5" /> View
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">Not uploaded</span>
      )}
    </div>
  );
}

export default function DriverDocuments() {
  const { profile } = useAuth();
  const [driverRow, setDriverRow] = useState<DriverRow | null>(null);
  const [route, setRoute] = useState<AssignedRoute | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      const { data: driver } = await supabase
        .from("drivers")
        .select("id, name, license_document_url, background_verification_document_url, medical_certificate_document_url")
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (!driver) { setLoading(false); return; }
      setDriverRow(driver as DriverRow);

      const { data: routeRow } = await supabase
        .from("transport_routes")
        .select("id, route_name, vehicle_id, vehicles(registration_number, insurance_document_url, fitness_document_url, puc_document_url, rc_document_url)")
        .eq("driver_id", driver.id)
        .eq("status", "active")
        .maybeSingle();

      setRoute((routeRow as any) ?? null);
      setLoading(false);
    };
    load();
  }, [profile?.id]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-700 p-8">
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <div className="rounded-xl bg-white/15 p-3">
              <FileText className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">My Documents</h1>
              <p className="text-emerald-50/90 mt-1">Your license, verification, and assigned vehicle documents</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading documents...
              </p>
            ) : !driverRow ? (
              <p className="text-sm text-muted-foreground">
                We could not find your driver profile. Ask your school admin to check your account setup.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Driver Documents</p>
                  <DriverDocumentRow label="License" path={driverRow.license_document_url} />
                  <DriverDocumentRow label="Background Verification" path={driverRow.background_verification_document_url} />
                  <DriverDocumentRow label="Medical Certificate" path={driverRow.medical_certificate_document_url} />
                </div>
                {route?.vehicles ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Vehicle Documents{route.vehicles.registration_number ? ` — ${route.vehicles.registration_number}` : ""}
                    </p>
                    <DriverDocumentRow label="Insurance" path={route.vehicles.insurance_document_url} />
                    <DriverDocumentRow label="Fitness Certificate" path={route.vehicles.fitness_document_url} />
                    <DriverDocumentRow label="Pollution Certificate (PUC)" path={route.vehicles.puc_document_url} />
                    <DriverDocumentRow label="RC Document" path={route.vehicles.rc_document_url} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground border-t pt-3">
                    No active vehicle assignment yet — vehicle documents will show here once assigned to a route.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
