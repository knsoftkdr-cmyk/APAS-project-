import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ShieldCheck, Phone, Droplet } from "lucide-react";

interface VerifyStudent {
  id: string;
  full_name: string;
  class: string;
  section: string;
  photo_url: string | null;
  blood_group: string | null;
  contact_phone: string | null;
  parent_phone: string | null;
  admission_number: string | null;
  status: string;
}

export default function StudentVerify() {
  const { id } = useParams<{ id: string }>();
  const [student, setStudent] = useState<VerifyStudent | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, class, section, photo_url, blood_group, contact_phone, parent_phone, admission_number, status")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
      } else {
        setStudent(data as VerifyStudent);
      }
      setLoading(false);
    })();
  }, [id]);

  return (
    <AppLayout>
      <div className="max-w-md mx-auto p-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : notFound || !student ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No student record found for this ID card.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-green-700">
                <ShieldCheck className="h-5 w-5" />
                <span className="font-medium">Verified student record</span>
              </div>

              <div className="flex items-center gap-4">
                {student.photo_url ? (
                  <img
                    src={student.photo_url}
                    alt={student.full_name}
                    className="w-20 h-20 rounded-full object-cover border"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center text-2xl font-semibold text-muted-foreground">
                    {student.full_name?.charAt(0) ?? "?"}
                  </div>
                )}
                <div>
                  <div className="text-lg font-semibold">{student.full_name}</div>
                  <div className="text-sm text-muted-foreground">
                    Class {student.class}{student.section ? ` - ${student.section}` : ""}
                  </div>
                  {student.admission_number && (
                    <div className="text-xs text-muted-foreground">Adm. No: {student.admission_number}</div>
                  )}
                </div>
              </div>

              {student.status !== "active" && (
                <div className="text-sm bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-md p-2">
                  Note: this student's status is "{student.status}", not active.
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 pt-2 border-t">
                {student.blood_group && (
                  <div className="flex items-center gap-2 text-sm">
                    <Droplet className="h-4 w-4 text-red-500" />
                    <span className="text-muted-foreground">Blood Group:</span>
                    <span className="font-medium">{student.blood_group}</span>
                  </div>
                )}
                {(student.contact_phone || student.parent_phone) && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Emergency Contact:</span>
                    <span className="font-medium">{student.contact_phone ?? student.parent_phone}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
