import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  getTeacherAppointments,
  updateAppointmentStatus,
  getTeacherParents,
  getChildrenForParentByTeacher,
  getTeacherAvailableSlots,
  createAppointment,
  Appointment,
  ParentOption,
  ChildOption,
  AvailableSlot,
  ReasonCategory,
  MeetingMode,
} from "@/lib/appointments";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X, CalendarCheck, Clock, MapPin, Video, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";

type TabKey = "book" | "upcoming" | "history";

const REASON_LABELS: Record<ReasonCategory, string> = {
  academic_concern: "Academic concern",
  behaviour_discussion: "Behaviour discussion",
  general_checkin: "General check-in",
  other: "Other",
};

interface LocationState {
  parentId?: string;
  parentName?: string;
  context?: string;
}

export default function TeacherAppointmentsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navState = (location.state ?? {}) as LocationState;

  const [activeTab, setActiveTab] = useState<TabKey>(navState.parentId ? "book" : "upcoming");

  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [history, setHistory] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  // ── Book New state ──────────────────────────────────────────────────────
  const [parents, setParents] = useState<ParentOption[]>([]);
  const [loadingParents, setLoadingParents] = useState(true);
  const [selectedParentId, setSelectedParentId] = useState<string | undefined>(navState.parentId);

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [selectedChild, setSelectedChild] = useState<ChildOption | null>(null);

  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);

  const [reasonCategory, setReasonCategory] = useState<ReasonCategory>("general_checkin");
  const [reasonNote, setReasonNote] = useState("");
  const [meetingMode, setMeetingMode] = useState<MeetingMode>("in_person");
  const [meetingLink, setMeetingLink] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  // Load the teacher's parent list once
  useEffect(() => {
    if (!profile?.id) return;
    setLoadingParents(true);
    getTeacherParents(profile.id)
      .then(setParents)
      .catch(() => toast({ title: "Couldn't load your parents list", variant: "destructive" }))
      .finally(() => setLoadingParents(false));
  }, [profile?.id]);

  // Load children whenever the selected parent changes
  useEffect(() => {
    if (!profile?.id || !selectedParentId) {
      setChildren([]);
      setSelectedChild(null);
      return;
    }
    setLoadingChildren(true);
    setSelectedChild(null);
    setSlots([]);
    setSelectedSlot(null);
    getChildrenForParentByTeacher(profile.id, selectedParentId)
      .then((data) => {
        setChildren(data);
        if (data.length > 0) setSelectedChild(data[0]);
      })
      .catch(() => toast({ title: "Couldn't load this parent's children", variant: "destructive" }))
      .finally(() => setLoadingChildren(false));
  }, [profile?.id, selectedParentId]);

  // Load the teacher's own available slots once a child is picked
  useEffect(() => {
    if (!profile?.id || !selectedChild) return;
    setLoadingSlots(true);
    setSelectedSlot(null);
    getTeacherAvailableSlots(profile.id, new Date(), 14)
      .then(setSlots)
      .catch(() => toast({ title: "Couldn't load your available slots", variant: "destructive" }))
      .finally(() => setLoadingSlots(false));
  }, [profile?.id, selectedChild]);

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

  async function handleBookWithParent() {
    if (!profile?.id || !selectedParentId || !selectedChild || !selectedSlot) return;
    setSubmitting(true);
    try {
      await createAppointment({
        schoolId: selectedChild.schoolId,
        parentId: selectedParentId,
        studentId: selectedChild.studentId,
        teacherId: profile.id,
        appointmentDate: selectedSlot.date,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        reasonCategory,
        reasonNote: reasonNote || undefined,
        meetingMode,
        meetingLink: meetingMode === "virtual" ? meetingLink || undefined : undefined,
        requestedBy: "teacher",
      });
      toast({
        title: "Meeting requested",
        description: "Waiting for the parent to confirm.",
      });
      setSelectedSlot(null);
      setReasonNote("");
      setMeetingLink("");
      loadData();
      setActiveTab("upcoming");
      getTeacherAvailableSlots(profile.id, new Date(), 14).then(setSlots);
    } catch (err: any) {
      if (err?.code === "23505") {
        toast({ title: "That slot was just taken — pick another", variant: "destructive" });
      } else {
        toast({ title: "Couldn't book the appointment. Try again.", variant: "destructive" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-violet-500 to-indigo-500 p-6 md:p-8 text-white">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <CalendarCheck className="h-6 w-6" />
              <h1 className="text-2xl font-bold">Appointments</h1>
            </div>
            <p className="text-violet-100">
              Manage schedule requests from parents, or book a meeting yourself.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border">
          {(
            [
              { key: "book", label: "Book New" },
              { key: "upcoming", label: `Pending & Upcoming${upcoming.length ? ` (${upcoming.length})` : ""}` },
              { key: "history", label: "History" },
            ] as { key: TabKey; label: string }[]
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.key
                  ? "bg-violet-600 text-white"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* BOOK NEW TAB */}
        {activeTab === "book" && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-5">
            {navState.parentName && (
              <p className="text-sm text-muted-foreground">
                Prefilled from Communication — talking with <strong>{navState.parentName}</strong>
                {navState.context ? ` (${navState.context})` : ""}. Change below if needed.
              </p>
            )}

            {/* Parent selector */}
            <div className="space-y-1.5">
              <Label>Parent</Label>
              {loadingParents ? (
                <LoadingRow label="Loading parents..." />
              ) : parents.length === 0 ? (
                <EmptyState text="No parents found for your classes yet." />
              ) : (
                <Select value={selectedParentId} onValueChange={setSelectedParentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select parent" />
                  </SelectTrigger>
                  <SelectContent>
                    {parents.map((p) => (
                      <SelectItem key={p.parentId} value={p.parentId}>
                        {p.parentName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Child selector */}
            {selectedParentId && (
              <div className="space-y-1.5">
                <Label>Child</Label>
                {loadingChildren ? (
                  <LoadingRow label="Loading children..." />
                ) : children.length === 0 ? (
                  <EmptyState text="This parent has no children in your classes." />
                ) : (
                  <Select
                    value={selectedChild?.studentId}
                    onValueChange={(id) =>
                      setSelectedChild(children.find((c) => c.studentId === id) ?? null)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select child" />
                    </SelectTrigger>
                    <SelectContent>
                      {children.map((c) => (
                        <SelectItem key={c.studentId} value={c.studentId}>
                          {c.fullName} — {c.className} {c.section}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Slot picker (teacher's own availability) */}
            {selectedChild && (
              <div className="space-y-1.5">
                <Label>Your available slots (next 14 days)</Label>
                {loadingSlots ? (
                  <LoadingRow label="Loading available slots..." />
                ) : slots.length === 0 ? (
                  <EmptyState text="You have no open slots in the next 14 days. Add availability first." />
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
                    {slots.map((slot) => {
                      const isSelected =
                        selectedSlot?.date === slot.date &&
                        selectedSlot?.startTime === slot.startTime;
                      return (
                        <button
                          key={`${slot.date}_${slot.startTime}`}
                          onClick={() => setSelectedSlot(slot)}
                          className={`rounded-lg border px-2 py-2 text-xs text-left transition-colors ${
                            isSelected
                              ? "border-violet-500 bg-violet-50 text-violet-900"
                              : "border-border hover:border-violet-300 hover:bg-violet-50/50"
                          }`}
                        >
                          <div className="font-medium">{formatDateShort(slot.date)}</div>
                          <div className="text-muted-foreground">{slot.startTime}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Reason + mode */}
            {selectedSlot && (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Select value={reasonCategory} onValueChange={(v) => setReasonCategory(v as ReasonCategory)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(REASON_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={reasonNote}
                    onChange={(e) => setReasonNote(e.target.value)}
                    placeholder="What you'd like to discuss with the parent"
                    rows={3}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Meeting mode</Label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMeetingMode("in_person")}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                        meetingMode === "in_person"
                          ? "border-violet-500 bg-violet-50 text-violet-900"
                          : "border-border"
                      }`}
                    >
                      <MapPin className="h-4 w-4" /> In person
                    </button>
                    <button
                      onClick={() => setMeetingMode("virtual")}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                        meetingMode === "virtual"
                          ? "border-violet-500 bg-violet-50 text-violet-900"
                          : "border-border"
                      }`}
                    >
                      <Video className="h-4 w-4" /> Virtual
                    </button>
                  </div>
                </div>

                {meetingMode === "virtual" && (
                  <div className="space-y-1.5">
                    <Label>Meeting link (optional)</Label>
                    <Textarea
                      value={meetingLink}
                      onChange={(e) => setMeetingLink(e.target.value)}
                      placeholder="https://meet.google.com/..."
                      rows={1}
                    />
                  </div>
                )}

                <Button
                  onClick={handleBookWithParent}
                  disabled={submitting}
                  className="w-full bg-violet-600 hover:bg-violet-700"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending request...
                    </>
                  ) : (
                    `Request meeting — ${formatDateShort(selectedSlot.date)} at ${selectedSlot.startTime}`
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* PENDING & UPCOMING TAB */}
        {activeTab === "upcoming" && (
          loading ? (
            <div className="p-6 text-center">Loading appointments...</div>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground border border-dashed p-6 rounded-lg bg-card text-center">
              No active appointment requests right now.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {upcoming.map((appt) => {
                const awaitingParent = appt.requestedBy === "teacher" && appt.status === "pending";
                const awaitingTeacher = appt.requestedBy === "parent" && appt.status === "pending";
                return (
                  <div key={appt.id} className="p-4 border rounded-xl shadow-sm bg-card flex flex-col justify-between">
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                          {appt.parentName || `Parent ID: ${appt.parentId?.slice(0, 8)}...`}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                            appt.status === "confirmed"
                              ? "bg-green-100 text-green-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {appt.status}
                        </span>
                      </div>
                      <h3 className="font-semibold text-base">Student: {appt.studentName || "Linked Student"}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        📅 {appt.appointmentDate} | ⏰ {appt.startTime?.slice(0, 5)} - {appt.endTime?.slice(0, 5)}
                      </p>
                      <p className="text-xs mt-2 bg-muted p-2 border rounded italic">
                        <strong>Reason:</strong> {appt.reasonCategory?.replace("_", " ")}
                        {appt.reasonNote && ` — "${appt.reasonNote}"`}
                      </p>
                      {awaitingParent && (
                        <p className="text-xs mt-2 text-amber-700">
                          You requested this meeting — waiting for the parent to confirm.
                        </p>
                      )}
                    </div>

                    {awaitingTeacher && decliningId !== appt.id && (
                      <div className="flex gap-2 border-t pt-3 mt-2">
                        <button
                          onClick={() => handleAccept(appt.id)}
                          className="flex-1 flex items-center justify-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium py-2 px-3 rounded-lg"
                        >
                          <Check className="h-3.5 w-3.5" /> Accept
                        </button>
                        <button
                          onClick={() => {
                            setDecliningId(appt.id);
                            setDeclineReason("");
                          }}
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
                            onClick={() => {
                              setDecliningId(null);
                              setDeclineReason("");
                            }}
                            className="flex-1 bg-muted hover:bg-muted/70 text-xs font-medium py-2 px-3 rounded-lg border"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          loading ? (
            <div className="p-6 text-center">Loading history...</div>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No historical logs found.</p>
          ) : (
            <div className="grid gap-2 bg-muted border rounded-xl p-4">
              {history.map((appt) => (
                <div key={appt.id} className="flex flex-col text-xs py-2 border-b last:border-none text-muted-foreground">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium text-foreground">{appt.studentName || "Student"}</span> •{" "}
                      {appt.appointmentDate} at {appt.startTime?.slice(0, 5)}
                    </div>
                    <span
                      className={`font-semibold uppercase text-[10px] px-2 py-0.5 rounded ${
                        appt.status === "completed" ? "bg-gray-200 text-gray-700" : "bg-red-50 text-red-700"
                      }`}
                    >
                      {appt.status}
                    </span>
                  </div>
                  {appt.status === "rejected" && appt.rejectionReason && (
                    <p className="mt-1 italic text-red-600">Reason given: "{appt.rejectionReason}"</p>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </AppLayout>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
      {text}
    </div>
  );
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}