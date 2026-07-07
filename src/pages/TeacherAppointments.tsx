import { useEffect, useState } from "react";
import { getTeacherAppointments, updateAppointmentStatus, Appointment } from "@/lib/appointments";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Check, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";

export default function TeacherAppointmentsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [history, setHistory] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  async function loadData() {
    if (!profile?.id) return;
    try {
      const data = await getTeacherAppointments(profile.id);
      setUpcoming(data.upcoming || []);
      setHistory(data.history || []);
    } catch (error) {
      console.error("Error loading teacher appointments:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (profile?.id) loadData();
  }, [profile?.id]);

  async function handleAccept(appointmentId: string) {
    try {
      await updateAppointmentStatus(appointmentId, "confirmed");
      toast({ title: "Appointment Confirmed", description: "The meeting has been confirmed." });
      loadData();
    } catch (error) {
      console.error("Error confirming:", error);
      toast({ title: "Action Failed", description: "Could not confirm the appointment.", variant: "destructive" });
    }
  }

  async function handleDeclineSubmit(appointmentId: string) {
    try {
      await updateAppointmentStatus(appointmentId, "rejected", declineReason.trim() || undefined);
      toast({ title: "Appointment Declined", description: "The parent will be notified of the reason." });
      setDecliningId(null);
      setDeclineReason("");
      loadData();
    } catch (error) {
      console.error("Error declining:", error);
      toast({ title: "Action Failed", description: "Could not decline the appointment.", variant: "destructive" });
    }
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Appointments Module</h1>
          <p className="text-sm text-muted-foreground">Manage schedule requests from parents.</p>
        </div>

        {loading ? (
          <div className="p-6 text-center">Loading appointments...</div>
        ) : (
          <>
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4 text-purple-700">Pending & Upcoming Meetings</h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground border border-dashed p-6 rounded-lg bg-card text-center">
                  No active appointment requests right now.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {upcoming.map((appt) => (
                    <div key={appt.id} className="p-4 border rounded-xl shadow-sm bg-card flex flex-col justify-between">
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold uppercase bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                            Parent ID: {appt.parentId?.slice(0, 8)}...
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                            appt.status === "confirmed" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                          }`}>
                            {appt.status}
                          </span>
                        </div>
                        <h3 className="font-semibold text-base">Student: {appt.studentName || "Linked Student"}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          📅 {appt.appointmentDate} | ⏰ {appt.startTime?.slice(0, 5)} - {appt.endTime?.slice(0, 5)}
                        </p>
                        <p className="text-xs mt-2 bg-muted p-2 border rounded italic">
                          <strong>Reason:</strong> {appt.reasonCategory?.replace('_', ' ')}
                          {appt.reasonNote && ` — "${appt.reasonNote}"`}
                        </p>
                      </div>

                      {appt.status === "pending" && decliningId !== appt.id && (
                        <div className="flex gap-2 border-t pt-3 mt-2">
                          <button
                            onClick={() => handleAccept(appt.id)}
                            className="flex-1 flex items-center justify-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium py-2 px-3 rounded-lg"
                          >
                            <Check className="h-3.5 w-3.5" /> Accept
                          </button>
                          <button
                            onClick={() => { setDecliningId(appt.id); setDeclineReason(""); }}
                            className="flex-1 flex items-center justify-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-medium py-2 px-3 rounded-lg"
                          >
                            <X className="h-3.5 w-3.5" /> Decline
                          </button>
                        </div>
                      )}

                      {decliningId === appt.id && (
                        <div className="border-t pt-3 mt-2 space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            Reason for declining (shown to the parent)
                          </label>
                          <textarea
                            value={declineReason}
                            onChange={(e) => setDeclineReason(e.target.value)}
                            placeholder="e.g. I have a class at that time, please pick another slot"
                            className="w-full text-sm border rounded-lg p-2 min-h-[70px]"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleDeclineSubmit(appt.id)}
                              className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-2 px-3 rounded-lg"
                            >
                              Confirm Decline
                            </button>
                            <button
                              onClick={() => { setDecliningId(null); setDeclineReason(""); }}
                              className="flex-1 bg-muted hover:bg-muted/70 text-xs font-medium py-2 px-3 rounded-lg border"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-4 text-muted-foreground">Past History</h2>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No historical logs found.</p>
              ) : (
                <div className="grid gap-2 bg-muted border rounded-xl p-4">
                  {history.map((appt) => (
                    <div key={appt.id} className="flex flex-col text-xs py-2 border-b last:border-none text-muted-foreground">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="font-medium text-foreground">{appt.studentName || "Student"}</span> • {appt.appointmentDate} at {appt.startTime?.slice(0, 5)}
                        </div>
                        <span className={`font-semibold uppercase text-[10px] px-2 py-0.5 rounded ${
                          appt.status === 'completed' ? 'bg-gray-200 text-gray-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {appt.status}
                        </span>
                      </div>
                      {appt.status === "rejected" && appt.rejectionReason && (
                        <p className="mt-1 italic text-red-600">Reason given: "{appt.rejectionReason}"</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}