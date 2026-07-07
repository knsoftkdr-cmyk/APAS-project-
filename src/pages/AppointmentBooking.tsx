import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import {
  getMyChildren,
  getTeachersForChild,
  getTeacherAvailableSlots,
  createAppointment,
  getMyAppointments,
  cancelAppointment,
  type ChildOption,
  type TeacherOption,
  type AvailableSlot,
  type Appointment,
  type ReasonCategory,
  type MeetingMode,
} from "@/lib/appointments";
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
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, Clock, MapPin, Video, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

type TabKey = "book" | "upcoming" | "history";

const REASON_LABELS: Record<ReasonCategory, string> = {
  academic_concern: "Academic concern",
  behaviour_discussion: "Behaviour discussion",
  general_checkin: "General check-in",
  other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  confirmed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
  completed: "bg-blue-100 text-blue-800 border-blue-200",
  no_show: "bg-red-100 text-red-800 border-red-200",
};

export default function AppointmentBooking() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("book");

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<ChildOption | null>(null);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherOption | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);

  const [reasonCategory, setReasonCategory] = useState<ReasonCategory>("general_checkin");
  const [reasonNote, setReasonNote] = useState("");
  const [meetingMode, setMeetingMode] = useState<MeetingMode>("in_person");
  const [meetingLink, setMeetingLink] = useState("");

  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [history, setHistory] = useState<Appointment[]>([]);

  const [loadingChildren, setLoadingChildren] = useState(true);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingAppointments, setLoadingAppointments] = useState(true);

  // Load children on mount
  useEffect(() => {
    if (!profile?.id) return;
    setLoadingChildren(true);
    getMyChildren(profile.id)
      .then((data) => {
        setChildren(data);
        if (data.length > 0) setSelectedChild(data[0]);
      })
      .catch(() => toast.error("Couldn't load your children's profiles"))
      .finally(() => setLoadingChildren(false));
  }, [profile?.id]);

  // Load teachers when child changes
  useEffect(() => {
    if (!selectedChild) return;
    setLoadingTeachers(true);
    setSelectedTeacher(null);
    setSlots([]);
    setSelectedSlot(null);
    getTeachersForChild(selectedChild.className, selectedChild.section, selectedChild.schoolId)
      .then((data) => {
        setTeachers(data);
        if (data.length > 0) setSelectedTeacher(data[0]);
      })
      .catch(() => toast.error("Couldn't load teachers for this class"))
      .finally(() => setLoadingTeachers(false));
  }, [selectedChild]);

  // Load slots when teacher changes
  useEffect(() => {
    if (!selectedTeacher) return;
    setLoadingSlots(true);
    setSelectedSlot(null);
    getTeacherAvailableSlots(selectedTeacher.teacherId, new Date(), 14)
      .then(setSlots)
      .catch(() => toast.error("Couldn't load available slots"))
      .finally(() => setLoadingSlots(false));
  }, [selectedTeacher]);

  // Load appointments for Upcoming/History tabs
  const refreshAppointments = () => {
    if (!profile?.id) return;
    setLoadingAppointments(true);
    getMyAppointments(profile.id)
      .then(({ upcoming, history }) => {
        setUpcoming(upcoming);
        setHistory(history);
      })
      .catch(() => toast.error("Couldn't load your appointments"))
      .finally(() => setLoadingAppointments(false));
  };

  useEffect(() => {
    refreshAppointments();
  }, [profile?.id]);

  const handleBook = async () => {
    if (!profile?.id || !selectedChild || !selectedTeacher || !selectedSlot) return;
    setSubmitting(true);
    try {
      await createAppointment({
        schoolId: selectedChild.schoolId,
        parentId: profile.id,
        studentId: selectedChild.studentId,
        teacherId: selectedTeacher.teacherId,
        appointmentDate: selectedSlot.date,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        reasonCategory,
        reasonNote: reasonNote || undefined,
        meetingMode,
        meetingLink: meetingMode === "virtual" ? meetingLink || undefined : undefined,
      });
      toast.success("Appointment requested — waiting for teacher confirmation");
      setSelectedSlot(null);
      setReasonNote("");
      setMeetingLink("");
      refreshAppointments();
      setActiveTab("upcoming");
      // refresh slots so the booked one disappears
      getTeacherAvailableSlots(selectedTeacher.teacherId, new Date(), 14).then(setSlots);
    } catch (err: any) {
      if (err?.code === "23505") {
        toast.error("That slot was just booked by someone else — pick another");
      } else {
        toast.error("Couldn't book the appointment. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (appointmentId: string) => {
    if (!profile?.id) return;
    try {
      await cancelAppointment(appointmentId, profile.id, "Cancelled by parent");
      toast.success("Appointment cancelled");
      refreshAppointments();
    } catch {
      toast.error("Couldn't cancel the appointment");
    }
  };

  return (
    <AppLayout>
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      {/* Gradient banner header, matching Student 360 style */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-violet-500 to-indigo-500 p-6 md:p-8 text-white">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-1">
            <CalendarCheck className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Appointments</h1>
          </div>
          <p className="text-violet-100">
            Book a meeting with your child's teacher, or manage existing appointments.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {(
          [
            { key: "book", label: "Book New" },
            { key: "upcoming", label: `Upcoming${upcoming.length ? ` (${upcoming.length})` : ""}` },
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
          {loadingChildren ? (
            <LoadingRow label="Loading your children..." />
          ) : children.length === 0 ? (
            <EmptyState text="No student profile is linked to your account yet. Contact your school admin." />
          ) : (
            <>
              {/* Child selector */}
              <div className="space-y-1.5">
                <Label>Child</Label>
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
              </div>

              {/* Teacher selector */}
              <div className="space-y-1.5">
                <Label>Teacher</Label>
                {loadingTeachers ? (
                  <LoadingRow label="Loading teachers..." />
                ) : teachers.length === 0 ? (
                  <EmptyState text="No teachers found for this class yet." />
                ) : (
                  <Select
                    value={selectedTeacher?.teacherId}
                    onValueChange={(id) =>
                      setSelectedTeacher(teachers.find((t) => t.teacherId === id) ?? null)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select teacher" />
                    </SelectTrigger>
                    <SelectContent>
                      {teachers.map((t) => (
                        <SelectItem key={t.teacherId} value={t.teacherId}>
                          {t.fullName}
                          {t.subject ? ` — ${t.subject}` : ""}
                          {t.teacherRole ? ` (${t.teacherRole})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Slot picker */}
              {selectedTeacher && (
                <div className="space-y-1.5">
                  <Label>Available slots (next 14 days)</Label>
                  {loadingSlots ? (
                    <LoadingRow label="Loading available slots..." />
                  ) : slots.length === 0 ? (
                    <EmptyState text="No open slots in the next 14 days for this teacher." />
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
                            <div className="font-medium">
                              {formatDateShort(slot.date)}
                            </div>
                            <div className="text-muted-foreground">{slot.startTime}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Reason + mode, only shown once a slot is picked */}
              {selectedSlot && (
                <div className="space-y-4 border-t border-border pt-4">
                  <div className="space-y-1.5">
                    <Label>Reason</Label>
                    <Select
                      value={reasonCategory}
                      onValueChange={(v) => setReasonCategory(v as ReasonCategory)}
                    >
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
                      placeholder="Anything specific you'd like to discuss"
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
                      <Label>Meeting link (optional — teacher may add this on confirmation)</Label>
                      <Textarea
                        value={meetingLink}
                        onChange={(e) => setMeetingLink(e.target.value)}
                        placeholder="https://meet.google.com/..."
                        rows={1}
                      />
                    </div>
                  )}

                  <Button
                    onClick={handleBook}
                    disabled={submitting}
                    className="w-full bg-violet-600 hover:bg-violet-700"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Requesting...
                      </>
                    ) : (
                      `Request appointment — ${formatDateShort(selectedSlot.date)} at ${selectedSlot.startTime}`
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* UPCOMING TAB */}
      {activeTab === "upcoming" && (
        <div className="space-y-3">
          {loadingAppointments ? (
            <LoadingRow label="Loading appointments..." />
          ) : upcoming.length === 0 ? (
            <EmptyState text="No upcoming appointments. Book one from the 'Book New' tab." />
          ) : (
            upcoming.map((appt) => (
              <AppointmentCard key={appt.id} appt={appt} onCancel={handleCancel} />
            ))
          )}
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <div className="space-y-3">
          {loadingAppointments ? (
            <LoadingRow label="Loading history..." />
          ) : history.length === 0 ? (
            <EmptyState text="No past appointments yet." />
          ) : (
            history.map((appt) => <AppointmentCard key={appt.id} appt={appt} />)
          )}
        </div>
      )}
    </div>
    </AppLayout>
  );
}

function AppointmentCard({
  appt,
  onCancel,
}: {
  appt: Appointment;
  onCancel?: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{appt.teacherName ?? "Teacher"}</span>
          <Badge variant="outline" className={STATUS_STYLES[appt.status]}>
            {appt.status.replace("_", " ")}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {formatDateShort(appt.appointmentDate)} · {appt.startTime}–{appt.endTime}
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-1.5">
          {appt.meetingMode === "virtual" ? (
            <Video className="h-3.5 w-3.5" />
          ) : (
            <MapPin className="h-3.5 w-3.5" />
          )}
          {appt.meetingMode === "virtual" ? "Virtual" : "In person"}
          {" · "}
          {REASON_LABELS[appt.reasonCategory]}
        </div>
        {appt.reasonNote && (
          <p className="text-sm text-muted-foreground italic">"{appt.reasonNote}"</p>
        )}
        {appt.status === "rejected" && appt.rejectionReason && (
          <p className="text-sm text-red-600 italic">
            Teacher's reason: "{appt.rejectionReason}"
          </p>
        )}
      </div>
      {onCancel && ["pending", "confirmed"].includes(appt.status) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCancel(appt.id)}
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          <X className="h-4 w-4 mr-1" /> Cancel
        </Button>
      )}
    </div>
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