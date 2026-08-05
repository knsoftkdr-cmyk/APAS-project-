import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, X, Loader2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from "date-fns";

type DriverAttendanceStatus = "present" | "absent" | "on_leave" | "half_day";

const STATUS_OPTIONS: { value: DriverAttendanceStatus; label: string; soft: string; hex: string }[] = [
  { value: "present", label: "Present", soft: "bg-green-50 text-green-700 border border-green-200", hex: "#22c55e" },
  { value: "absent", label: "Absent", soft: "bg-red-50 text-red-700 border border-red-200", hex: "#ef4444" },
  { value: "half_day", label: "Half Day", soft: "bg-blue-50 text-blue-700 border border-blue-200", hex: "#3b82f6" },
  { value: "on_leave", label: "On Leave", soft: "bg-gray-50 text-gray-600 border border-gray-200", hex: "#9ca3af" },
];

export default function DriverAttendanceView() {
  const { profile } = useAuth();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<{ date: string; status: DriverAttendanceStatus }[]>([]);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      const { data } = await supabase
        .from("drivers")
        .select("id")
        .eq("profile_id", profile.id)
        .maybeSingle();
      setDriverId(data?.id ?? null);
    })();
  }, [profile?.id]);

  useEffect(() => {
    if (!driverId) return;
    const start = format(startOfMonth(currentMonth), "yyyy-MM-dd");
    const end = format(endOfMonth(currentMonth), "yyyy-MM-dd");
    setLoading(true);
    supabase
      .from("driver_attendance")
      .select("date, status")
      .eq("driver_id", driverId)
      .gte("date", start)
      .lte("date", end)
      .then(({ data }) => {
        setRecords((data || []) as { date: string; status: DriverAttendanceStatus }[]);
        setLoading(false);
      });
  }, [driverId, currentMonth]);

  const recordsByDate = records.reduce((acc, r) => {
    acc[r.date] = r.status;
    return acc;
  }, {} as Record<string, DriverAttendanceStatus>);

  const counts = STATUS_OPTIONS.reduce((acc, opt) => {
    acc[opt.value] = records.filter((r) => r.status === opt.value).length;
    return acc;
  }, {} as Record<DriverAttendanceStatus, number>);
  const totalMarked = records.length;
  const presentLike = counts.present + counts.half_day;
  const attendancePct = totalMarked > 0 ? Math.round((presentLike / totalMarked) * 100) : null;

  const daysInMonth = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startDayOfWeek = startOfMonth(currentMonth).getDay();
  const getStatusForDay = (day: Date) => recordsByDate[format(day, "yyyy-MM-dd")];
  const selectedDayStatus = selectedDay ? getStatusForDay(selectedDay) : undefined;
  const selectedDayOpt = selectedDayStatus ? STATUS_OPTIONS.find((o) => o.value === selectedDayStatus) : undefined;

  return (
    <AppLayout>
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-emerald-300 opacity-[0.08] blur-3xl pointer-events-none" />
        <div className="absolute top-96 left-0 w-64 h-64 rounded-full bg-teal-200 opacity-[0.08] blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-6xl mx-auto space-y-5 p-3 md:p-4">
          <div className="rounded-2xl md:rounded-3xl p-5 md:p-7 relative overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 shadow-lg">
            <div className="absolute -right-8 -top-8 w-40 h-40 bg-white/10 rounded-full" />
            <div className="absolute right-24 top-10 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative">
              <h1 className="text-xl md:text-2xl font-bold text-white">My Attendance</h1>
              <p className="text-emerald-100 text-xs md:text-sm mt-0.5">Your day-by-day attendance record</p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {STATUS_OPTIONS.map((opt) => (
              <div key={opt.value} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${opt.soft}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: opt.hex }} />
                <span className="text-xs font-medium">{opt.label}</span>
              </div>
            ))}
          </div>

          {!driverId && !loading ? (
            <p className="text-sm text-muted-foreground">
              We could not find your driver profile. Ask your school admin to check your account setup.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <div className="lg:col-span-2 bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 md:p-5">
                <div className="flex items-center justify-between mb-4 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl px-2 py-2.5 shadow-sm">
                  <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-white">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <h2 className="text-base md:text-lg font-bold text-white">{format(currentMonth, "MMMM yyyy")}</h2>
                  <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-white">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-7 mb-1">
                  {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
                    <div key={d} className="text-center text-[11px] font-bold text-emerald-400 py-1.5 uppercase tracking-wide">{d}</div>
                  ))}
                </div>

                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: startDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
                    {daysInMonth.map((day) => {
                      const status = getStatusForDay(day);
                      const opt = status ? STATUS_OPTIONS.find((o) => o.value === status) : undefined;
                      const isToday = isSameDay(day, new Date());
                      const isSelected = selectedDay && isSameDay(day, selectedDay);
                      return (
                        <button
                          key={day.toISOString()}
                          onClick={() => setSelectedDay(selectedDay && isSameDay(day, selectedDay) ? null : day)}
                          className={`relative min-h-[48px] md:min-h-[58px] p-1 md:p-1.5 rounded-lg text-left transition-all border ${
                            isSelected ? "border-emerald-400 bg-emerald-50 shadow-sm" :
                            isToday ? "border-teal-200 bg-teal-50/70" :
                            "border-transparent hover:border-emerald-100 hover:bg-emerald-50/50"
                          }`}
                        >
                          <span className={`text-xs font-medium flex items-center justify-center mb-1 h-5 w-5 rounded-full ${
                            isToday ? "bg-gradient-to-br from-emerald-600 to-teal-600 text-white font-bold shadow-sm" : "text-foreground"
                          }`}>
                            {format(day, "d")}
                          </span>
                          {opt && (
                            <div className={`text-[9px] md:text-[10px] truncate px-1 py-0.5 rounded ${opt.soft} font-medium`}>
                              {opt.label}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-emerald-50">
                  <h3 className="font-bold text-sm text-emerald-900 flex items-center gap-1.5">
                    {selectedDay && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                    {selectedDay ? format(selectedDay, "EEEE, MMM d") : "Monthly Summary"}
                  </h3>
                  {selectedDay && (
                    <button onClick={() => setSelectedDay(null)} className="text-xs text-muted-foreground hover:text-emerald-600 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {selectedDay ? (
                  selectedDayOpt ? (
                    <div className={`p-3 rounded-xl border ${selectedDayOpt.soft}`}>
                      <p className="text-sm font-semibold">{selectedDayOpt.label}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No attendance marked on this day.</p>
                  )
                ) : (
                  <>
                    {totalMarked > 0 ? (
                      <div className="space-y-3">
                        {attendancePct !== null && (
                          <div className="text-3xl font-bold text-gray-800">
                            {attendancePct}%
                            <span className="text-xs font-normal text-muted-foreground ml-2 block mt-1">
                              attendance ({totalMarked} days marked this month)
                            </span>
                          </div>
                        )}
                        <div className="space-y-1.5">
                          {STATUS_OPTIONS.map((opt) => (
                            <div key={opt.value} className={`flex items-center justify-between text-xs font-semibold px-3 py-2 rounded-lg ${opt.soft}`}>
                              <span>{opt.label}</span>
                              <span>{counts[opt.value]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No attendance records for this month yet.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
