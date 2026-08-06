import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import AttendanceRiskView from '@/components/attendance/AttendanceRiskView';

type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'excused';

interface ClassRow { id: string; name: string; section: string; }
interface StudentRow { id: string; full_name: string; roll_number: string | null; profile_id: string | null; }
interface AttendanceSettings { mode: 'daily' | 'period'; periods_per_day: number | null; }
interface ExistingRecord { id: string; student_id: string; status: AttendanceStatus; }

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; color: string; soft: string; hex: string }[] = [
  { value: 'present', label: 'Present', color: 'bg-green-500 text-white', soft: 'bg-green-50 text-green-700 border border-green-200', hex: '#22c55e' },
  { value: 'absent', label: 'Absent', color: 'bg-red-500 text-white', soft: 'bg-red-50 text-red-700 border border-red-200', hex: '#ef4444' },
  { value: 'late', label: 'Late', color: 'bg-yellow-500 text-white', soft: 'bg-yellow-50 text-yellow-700 border border-yellow-200', hex: '#eab308' },
  { value: 'half_day', label: 'Half Day', color: 'bg-blue-500 text-white', soft: 'bg-blue-50 text-blue-700 border border-blue-200', hex: '#3b82f6' },
  { value: 'excused', label: 'Excused', color: 'bg-gray-400 text-white', soft: 'bg-gray-50 text-gray-600 border border-gray-200', hex: '#9ca3af' },
];

const CARD_SHADOW = 'shadow-sm rounded-2xl';

interface TeacherRow { id: string; full_name: string; employee_id: string | null; designation: string | null; }

type DriverAttendanceStatus = 'present' | 'absent' | 'on_leave' | 'half_day';

const DRIVER_STATUS_OPTIONS: { value: DriverAttendanceStatus; label: string; color: string; soft: string }[] = [
  { value: 'present', label: 'Present', color: 'bg-green-500 text-white', soft: 'bg-green-50 text-green-700 border border-green-200' },
  { value: 'absent', label: 'Absent', color: 'bg-red-500 text-white', soft: 'bg-red-50 text-red-700 border border-red-200' },
  { value: 'half_day', label: 'Half Day', color: 'bg-blue-500 text-white', soft: 'bg-blue-50 text-blue-700 border border-blue-200' },
  { value: 'on_leave', label: 'On Leave', color: 'bg-gray-400 text-white', soft: 'bg-gray-50 text-gray-600 border border-gray-200' },
];

interface AttendanceDriverRow { id: string; name: string; phone: string | null; license_number: string | null; }

type AttendantAttendanceStatus = 'present' | 'absent' | 'on_leave' | 'half_day';

const ATTENDANT_STATUS_OPTIONS: { value: AttendantAttendanceStatus; label: string; color: string; soft: string }[] = [
  { value: 'present', label: 'Present', color: 'bg-green-500 text-white', soft: 'bg-green-50 text-green-700 border border-green-200' },
  { value: 'absent', label: 'Absent', color: 'bg-red-500 text-white', soft: 'bg-red-50 text-red-700 border border-red-200' },
  { value: 'half_day', label: 'Half Day', color: 'bg-blue-500 text-white', soft: 'bg-blue-50 text-blue-700 border border-blue-200' },
  { value: 'on_leave', label: 'On Leave', color: 'bg-gray-400 text-white', soft: 'bg-gray-50 text-gray-600 border border-gray-200' },
];

interface AttendanceAttendantRow { id: string; name: string; phone: string | null; certificate_number: string | null; }

export default function AttendanceMarking() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('school_id, role')
        .eq('id', user.id)
        .single();
      if (!profile?.school_id) return;
      setSchoolId(profile.school_id);
      setRole(profile.role ?? null);

      if (profile.role === 'teacher') {
        const { data: assignedRows } = await supabase
          .from('class_teachers')
          .select('class_id, classes(id, name, section)')
          .eq('teacher_id', user.id);

        const seen = new Set<string>();
        const assignedClasses: ClassRow[] = [];
        (assignedRows || []).forEach((row: any) => {
          const c = row.classes;
          if (c && !seen.has(c.id)) {
            seen.add(c.id);
            assignedClasses.push({ id: c.id, name: c.name, section: c.section });
          }
        });
        assignedClasses.sort((a, b) => a.name.localeCompare(b.name));
        setClasses(assignedClasses);
      } else {
        const { data: classRows } = await supabase
          .from('classes')
          .select('id, name, section')
          .eq('school_id', profile.school_id)
          .order('name');
        setClasses((classRows || []) as ClassRow[]);
      }
    })();
  }, [user?.id]);

  const canMark = role === 'teacher' || role === 'principal' || role === 'admin';
  const isSelfView = role === 'student' || role === 'parent' || role === 'teacher';
  const canManageTeacherAttendance = role === 'principal' || role === 'admin';
  const canManageDriverAttendance = role === 'principal' || role === 'admin';
  const canManageAttendantAttendance = role === 'principal' || role === 'admin';
  const canViewRisk = role === 'teacher' || role === 'admin';

  const [activeTab, setActiveTab] = useState<string>('mark');
  useEffect(() => {
    if (!role) return;
    setActiveTab(role === 'student' || role === 'parent' ? 'mine' : 'mark');
  }, [role]);

  return (
    <AppLayout>
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-emerald-300 opacity-[0.08] blur-3xl pointer-events-none" />
        <div className="absolute top-96 left-0 w-64 h-64 rounded-full bg-teal-200 opacity-[0.08] blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-6xl mx-auto space-y-4 p-3 md:p-4">
          {activeTab !== 'mine' && (
            <div className="rounded-2xl p-4 md:p-6 relative overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 shadow-lg">
              <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
              <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
              <h1 className="relative text-lg md:text-2xl font-bold text-white">Attendance</h1>
              <p className="relative text-emerald-100 text-xs md:text-sm mt-0.5">Mark and review attendance records</p>
            </div>
          )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full overflow-x-auto flex-nowrap justify-start bg-white border border-emerald-100 shadow-sm rounded-xl p-1 h-auto">
            {canMark && <TabsTrigger value="mark" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Student Attendance</TabsTrigger>}
            {canMark && <TabsTrigger value="view" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Attendance View</TabsTrigger>}
            {isSelfView && <TabsTrigger value="mine" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">My Attendance</TabsTrigger>}
            {canManageTeacherAttendance && <TabsTrigger value="teacher-mark" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Teacher Attendance</TabsTrigger>}
            {canManageTeacherAttendance && <TabsTrigger value="teacher-view" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Teacher View</TabsTrigger>}
            {canManageDriverAttendance && <TabsTrigger value="driver-mark" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Driver Attendance</TabsTrigger>}
            {canManageDriverAttendance && <TabsTrigger value="driver-view" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Driver View</TabsTrigger>}
            {canManageAttendantAttendance && <TabsTrigger value="attendant-mark" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Attendant Attendance</TabsTrigger>}
            {canManageAttendantAttendance && <TabsTrigger value="attendant-view" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Attendant View</TabsTrigger>}
            {canViewRisk && <TabsTrigger value="risk" className="text-xs md:text-sm rounded-lg data-[state=active]:bg-emerald-600 data-[state=active]:text-white shrink-0">Attendance Risk</TabsTrigger>}
          </TabsList>
          {canMark && (
            <TabsContent value="mark">
              <MarkAttendanceTab schoolId={schoolId} classes={classes} userId={user?.id ?? null} />
            </TabsContent>
          )}
          {canMark && (
            <TabsContent value="view">
              <ViewAttendanceTab schoolId={schoolId} classes={classes} />
            </TabsContent>
          )}
          {isSelfView && (
            <TabsContent value="mine">
              <MyAttendanceTab schoolId={schoolId} role={role} userId={user?.id ?? null} />
            </TabsContent>
          )}
          {canManageTeacherAttendance && (
            <TabsContent value="teacher-mark">
              <MarkTeacherAttendanceTab schoolId={schoolId} userId={user?.id ?? null} />
            </TabsContent>
          )}
          {canManageTeacherAttendance && (
            <TabsContent value="teacher-view">
              <ViewTeacherAttendanceTab schoolId={schoolId} />
            </TabsContent>
          )}
          {canManageDriverAttendance && (
            <TabsContent value="driver-mark">
              <MarkDriverAttendanceTab schoolId={schoolId} userId={user?.id ?? null} />
            </TabsContent>
          )}
          {canManageDriverAttendance && (
            <TabsContent value="driver-view">
              <ViewDriverAttendanceTab schoolId={schoolId} />
            </TabsContent>
          )}
          {canManageAttendantAttendance && (
            <TabsContent value="attendant-mark">
              <MarkAttendantAttendanceTab schoolId={schoolId} userId={user?.id ?? null} />
            </TabsContent>
          )}
          {canManageAttendantAttendance && (
            <TabsContent value="attendant-view">
              <ViewAttendantAttendanceTab schoolId={schoolId} />
            </TabsContent>
          )}
          {canViewRisk && (
            <TabsContent value="risk">
              <AttendanceRiskView schoolId={schoolId} role={role} classes={classes} />
            </TabsContent>
          )}
        </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}

function MyAttendanceTab({ schoolId, role, userId }: { schoolId: string | null; role: string | null; userId: string | null; }) {
  interface ChildRow { id: string; full_name: string; profile_id: string | null; }
  const [linkedChildren, setLinkedChildren] = useState<ChildRow[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [myStudentRow, setMyStudentRow] = useState<ChildRow | null>(null);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<{ date: string; status: AttendanceStatus }[]>([]);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    if (!schoolId || !userId || !role) return;
    if (role === 'teacher') return; // teacher attendance is looked up directly by userId, no profile lookup needed
    (async () => {
      const { data: allStudents } = await supabase
        .from('students')
        .select('id, full_name, profile_id')
        .eq('school_id', schoolId);
      const students = (allStudents || []) as ChildRow[];

      if (role === 'student') {
        const mine = students.find((s) => s.profile_id === userId) ?? null;
        setMyStudentRow(mine);
      } else if (role === 'parent') {
        const { data: linkRows } = await supabase
          .from('parent_students')
          .select('student_id')
          .eq('parent_id', userId);
        const linkedProfileIds = (linkRows || []).map((r: any) => r.student_id);
        const kids = students.filter((s) => s.profile_id && linkedProfileIds.includes(s.profile_id));
        setLinkedChildren(kids);
        if (kids.length > 0) setSelectedChildId(kids[0].id);
      }
    })();
  }, [schoolId, userId, role]);

  const activeStudentId = role === 'student' ? myStudentRow?.id : selectedChildId;

  useEffect(() => {
    if (!schoolId) return;
    const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

    if (role === 'teacher') {
      if (!userId) return;
      setLoading(true);
      supabase
        .from('teacher_attendance')
        .select('date, status')
        .eq('school_id', schoolId)
        .eq('teacher_id', userId)
        .gte('date', start)
        .lte('date', end)
        .then(({ data }) => {
          setRecords((data || []) as { date: string; status: AttendanceStatus }[]);
          setLoading(false);
        });
      return;
    }
    if (!activeStudentId) return;
    setLoading(true);
    supabase
      .from('attendance_records')
      .select('date, status')
      .eq('school_id', schoolId)
      .eq('student_id', activeStudentId)
      .gte('date', start)
      .lte('date', end)
      .then(({ data }) => {
        setRecords((data || []) as { date: string; status: AttendanceStatus }[]);
        setLoading(false);
      });
  }, [schoolId, activeStudentId, currentMonth, role, userId]);

  const recordsByDate = records.reduce((acc, r) => {
    acc[r.date] = r.status;
    return acc;
  }, {} as Record<string, AttendanceStatus>);

  const counts = STATUS_OPTIONS.reduce((acc, opt) => {
    acc[opt.value] = records.filter((r) => r.status === opt.value).length;
    return acc;
  }, {} as Record<AttendanceStatus, number>);
  const totalMarked = records.length;
  const presentLike = counts.present + counts.late + counts.half_day;
  const attendancePct = totalMarked > 0 ? Math.round((presentLike / totalMarked) * 100) : null;

  const daysInMonth = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startDayOfWeek = startOfMonth(currentMonth).getDay();
  const getStatusForDay = (day: Date) => recordsByDate[format(day, 'yyyy-MM-dd')];
  const selectedDayStatus = selectedDay ? getStatusForDay(selectedDay) : undefined;
  const selectedDayOpt = selectedDayStatus ? STATUS_OPTIONS.find((o) => o.value === selectedDayStatus) : undefined;
  const showContent = role === 'teacher' || !!activeStudentId;

  return (
    <div className="relative">
      <div className="absolute -top-10 right-0 w-72 h-72 rounded-full bg-emerald-300 opacity-[0.12] blur-3xl pointer-events-none" />
      <div className="absolute top-96 left-0 w-64 h-64 rounded-full bg-teal-200 opacity-[0.12] blur-3xl pointer-events-none" />

      <div className="relative z-10 space-y-5">
        <div className="rounded-2xl md:rounded-3xl p-5 md:p-7 relative overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 shadow-lg">
          <div className="absolute -right-8 -top-8 w-40 h-40 bg-white/10 rounded-full" />
          <div className="absolute right-24 top-10 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative">
            <h1 className="text-xl md:text-2xl font-bold text-white">My Attendance</h1>
            <p className="text-emerald-100 text-xs md:text-sm mt-0.5">Your day-by-day attendance record</p>
          </div>
        </div>

        {role === 'parent' && (
          <Select value={selectedChildId} onValueChange={setSelectedChildId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select child" />
            </SelectTrigger>
            <SelectContent>
              {linkedChildren.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {role === 'parent' && linkedChildren.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">No linked children found.</p>
        )}

        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map((opt) => (
            <div key={opt.value} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${opt.soft}`}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: opt.hex }} />
              <span className="text-xs font-medium">{opt.label}</span>
            </div>
          ))}
        </div>

        {showContent && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 md:p-5">
              <div className="flex items-center justify-between mb-4 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl px-2 py-2.5 shadow-sm">
                <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-white">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="text-base md:text-lg font-bold text-white">{format(currentMonth, 'MMMM yyyy')}</h2>
                <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-white">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 mb-1">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
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
                          isSelected ? 'border-emerald-400 bg-emerald-50 shadow-sm' :
                          isToday ? 'border-teal-200 bg-teal-50/70' :
                          'border-transparent hover:border-emerald-100 hover:bg-emerald-50/50'
                        }`}
                      >
                        <span className={`text-xs font-medium flex items-center justify-center mb-1 h-5 w-5 rounded-full ${
                          isToday ? 'bg-gradient-to-br from-emerald-600 to-teal-600 text-white font-bold shadow-sm' : 'text-foreground'
                        }`}>
                          {format(day, 'd')}
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
                  {selectedDay ? format(selectedDay, 'EEEE, MMM d') : 'Monthly Summary'}
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
  );
}

function MarkAttendanceTab({ schoolId, classes, userId }: { schoolId: string | null; classes: ClassRow[]; userId: string | null; }) {
  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<number>(1);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [existingIds, setExistingIds] = useState<Record<string, string>>({});
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      const { data: settingsRow } = await supabase
        .from('attendance_settings')
        .select('mode, periods_per_day')
        .eq('school_id', schoolId)
        .single();
      if (settingsRow) setSettings(settingsRow as AttendanceSettings);
    })();
  }, [schoolId]);

  const loadRoster = useCallback(async () => {
    if (!schoolId || !selectedClassId) return;
    const selectedClass = classes.find((c) => c.id === selectedClassId);
    if (!selectedClass) return;

    setLoadingRoster(true);
    setSaveMessage(null);

    const { data: studentRows } = await supabase
      .from('students')
      .select('id, full_name, roll_number, profile_id')
      .eq('school_id', schoolId)
      .ilike('class', selectedClass.name)
      .ilike('section', selectedClass.section)
      .eq('status', 'active')
      .order('roll_number');

    const roster = (studentRows || []) as StudentRow[];
    setStudents(roster);

    const periodFilter = settings?.mode === 'period' ? selectedPeriod : null;
    let query = supabase
      .from('attendance_records')
      .select('id, student_id, status')
      .eq('school_id', schoolId)
      .eq('class_id', selectedClassId)
      .eq('date', date);
    query = periodFilter === null ? query.is('period_number', null) : query.eq('period_number', periodFilter);
    const { data: existingRows } = await query;

    const marksMap: Record<string, AttendanceStatus> = {};
    const idsMap: Record<string, string> = {};
    (existingRows || []).forEach((r: ExistingRecord) => {
      marksMap[r.student_id] = r.status;
      idsMap[r.student_id] = r.id;
    });
    // Students with no existing record are left UNMARKED on purpose.
    // Do not default them to 'present' — the teacher must tap a status.

    setMarks(marksMap);
    setExistingIds(idsMap);
    setLoadingRoster(false);
  }, [schoolId, selectedClassId, selectedPeriod, date, settings, classes]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setMarks((prev) => ({ ...prev, [studentId]: status }));
  };

  const markAllPresent = () => {
    const all: Record<string, AttendanceStatus> = {};
    students.forEach((s) => (all[s.id] = 'present'));
    setMarks(all);
  };

  const markedCount = students.filter((s) => marks[s.id]).length;
  const presentCount = students.filter((s) => marks[s.id] === 'present').length;
  const unmarkedCount = students.length - markedCount;

  const handleSubmit = async () => {
    if (!schoolId || !selectedClassId || students.length === 0) return;
    setSaving(true);
    setSaveMessage(null);

    const periodValue = settings?.mode === 'period' ? selectedPeriod : null;
    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; status: AttendanceStatus }[] = [];

    students.forEach((s) => {
      const status = marks[s.id];
      if (!status) return; // skip unmarked students — never assume 'present'
      const existingId = existingIds[s.id];
      if (existingId) {
        toUpdate.push({ id: existingId, status });
      } else {
        toInsert.push({
          school_id: schoolId,
          class_id: selectedClassId,
          student_id: s.id,
          date,
          period_number: periodValue,
          status,
          marked_by: userId,
        });
      }
    });

    try {
      if (toInsert.length > 0) {
        const { error } = await supabase.from('attendance_records').insert(toInsert);
        if (error) throw error;
      }
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map((u) =>
            supabase.from('attendance_records').update({ status: u.status }).eq('id', u.id)
          )
        );
      }
      // Notify parents in-app, matching the convention used in TimetablePage
      const markedStudents = students.filter((s) => marks[s.id] && s.profile_id);
      const markedProfileIds = markedStudents.map((s) => s.profile_id as string);
      if (markedProfileIds.length > 0) {
        const { data: parentLinks } = await supabase
          .from('parent_students')
          .select('parent_id, student_id')
          .in('student_id', markedProfileIds); // parent_students.student_id stores profile_id, not students.id

        const STATUS_MESSAGES: Record<AttendanceStatus, (name: string) => string> = {
          present: (name) => `${name} was present in school today.`,
          absent: (name) => `${name} was absent from school today.`,
          late: (name) => `${name} arrived late to school today.`,
          half_day: (name) => `${name} attended half day today.`,
          excused: (name) => `${name} was excused from school today.`,
        };

        const notifInserts = (parentLinks || [])
          .map((link: any) => {
            const student = markedStudents.find((s) => s.profile_id === link.student_id);
            const status = student ? marks[student.id] : undefined;
            if (!student || !status) return null;
            return {
              user_id: link.parent_id,
              event_type: 'attendance_marked',
              title: 'Attendance Update',
              message: STATUS_MESSAGES[status](student.full_name),
              reference_id: student ? (existingIds[student.id] ?? null) : null,
              reference_type: 'attendance_record',
              channel: 'in_app',
              is_read: false,
            };
          })
          .filter((n): n is NonNullable<typeof n> => n !== null);

        if (notifInserts.length > 0) {
          const { error: notifError } = await supabase.from('governance_notifications').insert(notifInserts);
          if (notifError) console.error('Failed to send parent notifications:', notifError);
        }
      }

      setSaveMessage(
        unmarkedCount > 0
          ? `Saved for ${markedCount} of ${students.length} students. ${unmarkedCount} still unmarked.`
          : 'Attendance saved.'
      );
      loadRoster();
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message || 'failed to save'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
        <CardTitle className="text-emerald-900">Mark Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-center">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="w-full sm:w-48 rounded-xl border-emerald-100">
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} - {c.section}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-emerald-100 rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
          />

          {settings?.mode === 'period' && (
            <Select value={String(selectedPeriod)} onValueChange={(v) => setSelectedPeriod(Number(v))}>
              <SelectTrigger className="w-full sm:w-32 rounded-xl border-emerald-100">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: settings.periods_per_day || 8 }, (_, i) => i + 1).map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    Period {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {students.length > 0 && (
            <Button variant="outline" size="sm" onClick={markAllPresent} className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 w-full sm:w-auto">
              Mark all present
            </Button>
          )}

          {students.length > 0 && (
            <div className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 bg-white rounded-xl shadow-sm border border-emerald-100 w-full sm:w-auto">
              <span className="text-green-600 font-semibold">{presentCount} present</span>
              <span className="text-muted-foreground">/ {students.length} total</span>
              {unmarkedCount > 0 && <span className="text-amber-600 font-semibold">· {unmarkedCount} unmarked</span>}
            </div>
          )}
        </div>

        {loadingRoster && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading roster...
          </div>
        )}

        {!loadingRoster && selectedClassId && students.length === 0 && (
          <p className="text-sm text-muted-foreground">No active students found for this class/section.</p>
        )}

        {!loadingRoster && students.length > 0 && (
          <div className="space-y-2.5">
            {students.map((s) => (
              <div key={s.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border border-emerald-100 rounded-xl px-4 py-3 bg-white shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700 shrink-0">
                    {s.full_name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-slate-800">{s.full_name}</div>
                    {s.roll_number && (
                      <div className="text-xs text-muted-foreground">Roll No. {s.roll_number}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(s.id, opt.value)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition-all ${
                        marks[s.id] === opt.value ? `${opt.color} border-transparent shadow-sm` : 'bg-white text-muted-foreground border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {students.length > 0 && (
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <Button onClick={handleSubmit} disabled={saving} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 rounded-xl">
              {saving ? 'Saving...' : 'Save Attendance'}
            </Button>
            {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ViewAttendanceTab({ schoolId, classes }: { schoolId: string | null; classes: ClassRow[]; }) {
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<{ student_id: string; full_name: string; roll_number: string | null; status: AttendanceStatus | null }[]>([]);

  const loadSummary = useCallback(async () => {
    if (!schoolId || !selectedClassId) return;
    const selectedClass = classes.find((c) => c.id === selectedClassId);
    if (!selectedClass) return;

    setLoading(true);

    const { data: studentRows } = await supabase
      .from('students')
      .select('id, full_name, roll_number')
      .eq('school_id', schoolId)
      .ilike('class', selectedClass.name)
      .ilike('section', selectedClass.section)
      .eq('status', 'active')
      .order('roll_number');

    const { data: recordRows } = await supabase
      .from('attendance_records')
      .select('student_id, status')
      .eq('school_id', schoolId)
      .eq('class_id', selectedClassId)
      .eq('date', date);

    const statusMap: Record<string, AttendanceStatus> = {};
    (recordRows || []).forEach((r: any) => {
      statusMap[r.student_id] = r.status;
    });

    const combined = (studentRows || []).map((s: any) => ({
      student_id: s.id,
      full_name: s.full_name,
      roll_number: s.roll_number,
      status: statusMap[s.id] ?? null,
    }));

    setRows(combined);
    setLoading(false);
  }, [schoolId, selectedClassId, date, classes]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const counts = STATUS_OPTIONS.reduce((acc, opt) => {
    acc[opt.value] = rows.filter((r) => r.status === opt.value).length;
    return acc;
  }, {} as Record<AttendanceStatus, number>);
  const notMarked = rows.filter((r) => r.status === null).length;

  return (
    <Card className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
        <CardTitle className="text-emerald-900">View Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-center">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="w-full sm:w-48 rounded-xl border-emerald-100">
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} - {c.section}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-emerald-100 rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
          />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}

        {!loading && selectedClassId && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No active students found for this class/section.</p>
        )}

        {!loading && rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {STATUS_OPTIONS.map((opt) => (
                <div key={opt.value} className={`text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-sm ${opt.soft}`}>
                  {counts[opt.value]} {opt.label}
                </div>
              ))}
              {notMarked > 0 && (
                <div className="text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-sm bg-gray-50 text-gray-500 border border-gray-200">
                  {notMarked} Not marked
                </div>
              )}
            </div>

            <div className="space-y-2">
              {rows.map((r) => {
                const opt = STATUS_OPTIONS.find((o) => o.value === r.status);
                return (
                  <div key={r.student_id} className="flex items-center justify-between gap-2 px-4 py-3 bg-white border border-emerald-100 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700 shrink-0">
                        {r.full_name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-800 truncate">{r.full_name}</div>
                        {r.roll_number && (
                          <div className="text-xs text-muted-foreground">Roll No. {r.roll_number}</div>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-3 py-1 rounded-full shrink-0 ${opt ? opt.soft : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                      {opt ? opt.label : 'Not marked'}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MarkTeacherAttendanceTab({ schoolId, userId }: { schoolId: string | null; userId: string | null; }) {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [existingIds, setExistingIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id, designation')
        .eq('school_id', schoolId)
        .eq('role', 'teacher')
        .order('full_name');
      setTeachers((data || []) as TeacherRow[]);
    })();
  }, [schoolId]);

  const loadMarks = useCallback(async () => {
    if (!schoolId || teachers.length === 0) return;
    setLoading(true);
    setSaveMessage(null);
    const { data } = await supabase
      .from('teacher_attendance')
      .select('id, teacher_id, status')
      .eq('school_id', schoolId)
      .eq('date', date);

    const marksMap: Record<string, AttendanceStatus> = {};
    const idsMap: Record<string, string> = {};
    (data || []).forEach((r: any) => {
      marksMap[r.teacher_id] = r.status;
      idsMap[r.teacher_id] = r.id;
    });
    setMarks(marksMap);
    setExistingIds(idsMap);
    setLoading(false);
  }, [schoolId, date, teachers.length]);

  useEffect(() => {
    loadMarks();
  }, [loadMarks]);

  const setStatus = (teacherId: string, status: AttendanceStatus) => {
    setMarks((prev) => ({ ...prev, [teacherId]: status }));
  };

  const markedCount = teachers.filter((t) => marks[t.id]).length;
  const presentCount = teachers.filter((t) => marks[t.id] === 'present').length;

  const handleSubmit = async () => {
    if (!schoolId || teachers.length === 0) return;
    setSaving(true);
    setSaveMessage(null);

    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; status: AttendanceStatus }[] = [];

    teachers.forEach((t) => {
      const status = marks[t.id];
      if (!status) return;
      const existingId = existingIds[t.id];
      if (existingId) {
        toUpdate.push({ id: existingId, status });
      } else {
        toInsert.push({
          school_id: schoolId,
          teacher_id: t.id,
          date,
          status,
          marked_by: userId,
        });
      }
    });

    try {
      if (toInsert.length > 0) {
        const { error } = await supabase.from('teacher_attendance').insert(toInsert);
        if (error) throw error;
      }
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map((u) =>
            supabase.from('teacher_attendance').update({ status: u.status }).eq('id', u.id)
          )
        );
      }
      setSaveMessage(`Saved for ${markedCount} of ${teachers.length} teachers.`);
      loadMarks();
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message || 'failed to save'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
        <CardTitle className="text-emerald-900">Teacher Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-emerald-100 rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
          />
          {teachers.length > 0 && (
            <div className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 bg-white rounded-xl shadow-sm border border-emerald-100 w-full sm:w-auto">
              <span className="text-green-600 font-semibold">{presentCount} present</span>
              <span className="text-muted-foreground">/ {teachers.length} total</span>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}

        {!loading && teachers.length === 0 && (
          <p className="text-sm text-muted-foreground">No teachers found for this school.</p>
        )}

        {!loading && teachers.length > 0 && (
          <div className="space-y-2.5">
            {teachers.map((t) => (
              <div key={t.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border border-emerald-100 rounded-xl px-4 py-3 bg-white shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 shrink-0">
                    {t.full_name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-slate-800">{t.full_name}</div>
                    {(t.employee_id || t.designation) && (
                      <div className="text-xs text-muted-foreground">
                        {t.employee_id ? `ID ${t.employee_id}` : ''}{t.employee_id && t.designation ? ' · ' : ''}{t.designation ?? ''}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(t.id, opt.value)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition-all ${
                        marks[t.id] === opt.value ? `${opt.color} border-transparent shadow-sm` : 'bg-white text-muted-foreground border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {teachers.length > 0 && (
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <Button onClick={handleSubmit} disabled={saving} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 rounded-xl">
              {saving ? 'Saving...' : 'Save Attendance'}
            </Button>
            {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MarkDriverAttendanceTab({ schoolId, userId }: { schoolId: string | null; userId: string | null; }) {
  const [drivers, setDrivers] = useState<AttendanceDriverRow[]>([]);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [marks, setMarks] = useState<Record<string, DriverAttendanceStatus>>({});
  const [existingIds, setExistingIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      const { data } = await supabase
        .from('drivers')
        .select('id, name, phone, license_number')
        .eq('school_id', schoolId)
        .order('name');
      setDrivers((data || []) as AttendanceDriverRow[]);
    })();
  }, [schoolId]);

  const loadMarks = useCallback(async () => {
    if (!schoolId || drivers.length === 0) return;
    setLoading(true);
    setSaveMessage(null);
    const { data } = await supabase
      .from('driver_attendance')
      .select('id, driver_id, status')
      .eq('school_id', schoolId)
      .eq('date', date);

    const marksMap: Record<string, DriverAttendanceStatus> = {};
    const idsMap: Record<string, string> = {};
    (data || []).forEach((r: any) => {
      marksMap[r.driver_id] = r.status;
      idsMap[r.driver_id] = r.id;
    });
    setMarks(marksMap);
    setExistingIds(idsMap);
    setLoading(false);
  }, [schoolId, date, drivers.length]);

  useEffect(() => {
    loadMarks();
  }, [loadMarks]);

  const setStatus = (driverId: string, status: DriverAttendanceStatus) => {
    setMarks((prev) => ({ ...prev, [driverId]: status }));
  };

  const markedCount = drivers.filter((d) => marks[d.id]).length;
  const presentCount = drivers.filter((d) => marks[d.id] === 'present').length;

  const handleSubmit = async () => {
    if (!schoolId || drivers.length === 0) return;
    setSaving(true);
    setSaveMessage(null);

    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; status: DriverAttendanceStatus }[] = [];

    drivers.forEach((d) => {
      const status = marks[d.id];
      if (!status) return;
      const existingId = existingIds[d.id];
      if (existingId) {
        toUpdate.push({ id: existingId, status });
      } else {
        toInsert.push({
          school_id: schoolId,
          driver_id: d.id,
          date,
          status,
          marked_by: userId,
        });
      }
    });

    try {
      if (toInsert.length > 0) {
        const { error } = await supabase.from('driver_attendance').insert(toInsert);
        if (error) throw error;
      }
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map((u) =>
            supabase.from('driver_attendance').update({ status: u.status }).eq('id', u.id)
          )
        );
      }
      setSaveMessage(`Saved for ${markedCount} of ${drivers.length} drivers.`);
      loadMarks();
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message || 'failed to save'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
        <CardTitle className="text-emerald-900">Driver Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-emerald-100 rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
          />
          {drivers.length > 0 && (
            <div className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 bg-white rounded-xl shadow-sm border border-emerald-100 w-full sm:w-auto">
              <span className="text-green-600 font-semibold">{presentCount} present</span>
              <span className="text-muted-foreground">/ {drivers.length} total</span>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}

        {!loading && drivers.length === 0 && (
          <p className="text-sm text-muted-foreground">No drivers found for this school.</p>
        )}

        {!loading && drivers.length > 0 && (
          <div className="space-y-2.5">
            {drivers.map((d) => (
              <div key={d.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border border-emerald-100 rounded-xl px-4 py-3 bg-white shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 shrink-0">
                    {d.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-slate-800">{d.name}</div>
                    {(d.phone || d.license_number) && (
                      <div className="text-xs text-muted-foreground">
                        {d.phone ? d.phone : ''}{d.phone && d.license_number ? ' \u00b7 ' : ''}{d.license_number ? `License ${d.license_number}` : ''}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {DRIVER_STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(d.id, opt.value)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition-all ${
                        marks[d.id] === opt.value ? `${opt.color} border-transparent shadow-sm` : 'bg-white text-muted-foreground border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {drivers.length > 0 && (
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <Button onClick={handleSubmit} disabled={saving} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 rounded-xl">
              {saving ? 'Saving...' : 'Save Attendance'}
            </Button>
            {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MarkAttendantAttendanceTab({ schoolId, userId }: { schoolId: string | null; userId: string | null; }) {
  const [attendants, setAttendants] = useState<AttendanceAttendantRow[]>([]);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [marks, setMarks] = useState<Record<string, AttendantAttendanceStatus>>({});
  const [existingIds, setExistingIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      const { data } = await supabase
        .from('bus_attendants')
        .select('id, name, phone, certificate_number')
        .eq('school_id', schoolId)
        .order('name');
      setAttendants((data || []) as AttendanceAttendantRow[]);
    })();
  }, [schoolId]);

  const loadMarks = useCallback(async () => {
    if (!schoolId || attendants.length === 0) return;
    setLoading(true);
    setSaveMessage(null);
    const { data } = await supabase
      .from('bus_attendant_attendance')
      .select('id, attendant_id, status')
      .eq('school_id', schoolId)
      .eq('date', date);

    const marksMap: Record<string, AttendantAttendanceStatus> = {};
    const idsMap: Record<string, string> = {};
    (data || []).forEach((r: any) => {
      marksMap[r.attendant_id] = r.status;
      idsMap[r.attendant_id] = r.id;
    });
    setMarks(marksMap);
    setExistingIds(idsMap);
    setLoading(false);
  }, [schoolId, date, attendants.length]);

  useEffect(() => {
    loadMarks();
  }, [loadMarks]);

  const setStatus = (attendantId: string, status: AttendantAttendanceStatus) => {
    setMarks((prev) => ({ ...prev, [attendantId]: status }));
  };

  const markedCount = attendants.filter((a) => marks[a.id]).length;
  const presentCount = attendants.filter((a) => marks[a.id] === 'present').length;

  const handleSubmit = async () => {
    if (!schoolId || attendants.length === 0) return;
    setSaving(true);
    setSaveMessage(null);

    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; status: AttendantAttendanceStatus }[] = [];

    attendants.forEach((a) => {
      const status = marks[a.id];
      if (!status) return;
      const existingId = existingIds[a.id];
      if (existingId) {
        toUpdate.push({ id: existingId, status });
      } else {
        toInsert.push({
          school_id: schoolId,
          attendant_id: a.id,
          date,
          status,
          marked_by: userId,
        });
      }
    });

    try {
      if (toInsert.length > 0) {
        const { error } = await supabase.from('bus_attendant_attendance').insert(toInsert);
        if (error) throw error;
      }
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map((u) =>
            supabase.from('bus_attendant_attendance').update({ status: u.status }).eq('id', u.id)
          )
        );
      }
      setSaveMessage(`Saved for ${markedCount} of ${attendants.length} attendants.`);
      loadMarks();
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message || 'failed to save'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
        <CardTitle className="text-emerald-900">Attendant Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-emerald-100 rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
          />
          {attendants.length > 0 && (
            <div className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 bg-white rounded-xl shadow-sm border border-emerald-100 w-full sm:w-auto">
              <span className="text-green-600 font-semibold">{presentCount} present</span>
              <span className="text-muted-foreground">/ {attendants.length} total</span>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}

        {!loading && attendants.length === 0 && (
          <p className="text-sm text-muted-foreground">No bus attendants found for this school.</p>
        )}

        {!loading && attendants.length > 0 && (
          <div className="space-y-2.5">
            {attendants.map((a) => (
              <div key={a.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border border-emerald-100 rounded-xl px-4 py-3 bg-white shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 shrink-0">
                    {a.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-slate-800">{a.name}</div>
                    {(a.phone || a.certificate_number) && (
                      <div className="text-xs text-muted-foreground">
                        {a.phone ? a.phone : ''}{a.phone && a.certificate_number ? ' \u00b7 ' : ''}{a.certificate_number ? `Cert ${a.certificate_number}` : ''}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {ATTENDANT_STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(a.id, opt.value)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition-all ${
                        marks[a.id] === opt.value ? `${opt.color} border-transparent shadow-sm` : 'bg-white text-muted-foreground border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {attendants.length > 0 && (
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <Button onClick={handleSubmit} disabled={saving} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 rounded-xl">
              {saving ? 'Saving...' : 'Save Attendance'}
            </Button>
            {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ViewAttendantAttendanceTab({ schoolId }: { schoolId: string | null; }) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<{ attendant_id: string; name: string; certificate_number: string | null; status: AttendantAttendanceStatus | null }[]>([]);

  const loadSummary = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);

    const { data: attendantRows } = await supabase
      .from('bus_attendants')
      .select('id, name, certificate_number')
      .eq('school_id', schoolId)
      .order('name');

    const { data: recordRows } = await supabase
      .from('bus_attendant_attendance')
      .select('attendant_id, status')
      .eq('school_id', schoolId)
      .eq('date', date);

    const statusMap: Record<string, AttendantAttendanceStatus> = {};
    (recordRows || []).forEach((r: any) => {
      statusMap[r.attendant_id] = r.status;
    });

    const combined = (attendantRows || []).map((a: any) => ({
      attendant_id: a.id,
      name: a.name,
      certificate_number: a.certificate_number,
      status: statusMap[a.id] ?? null,
    }));

    setRows(combined);
    setLoading(false);
  }, [schoolId, date]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const counts = ATTENDANT_STATUS_OPTIONS.reduce((acc, opt) => {
    acc[opt.value] = rows.filter((r) => r.status === opt.value).length;
    return acc;
  }, {} as Record<AttendantAttendanceStatus, number>);
  const notMarked = rows.filter((r) => r.status === null).length;

  return (
    <Card className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
        <CardTitle className="text-emerald-900">Attendant Attendance View</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border border-emerald-100 rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
        />

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No bus attendants found for this school.</p>
        )}

        {!loading && rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {ATTENDANT_STATUS_OPTIONS.map((opt) => (
                <div key={opt.value} className={`text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-sm ${opt.soft}`}>
                  {counts[opt.value]} {opt.label}
                </div>
              ))}
              {notMarked > 0 && (
                <div className="text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-sm bg-gray-50 text-gray-500 border border-gray-200">
                  {notMarked} Not marked
                </div>
              )}
            </div>

            <div className="space-y-2">
              {rows.map((r) => {
                const opt = ATTENDANT_STATUS_OPTIONS.find((o) => o.value === r.status);
                return (
                  <div key={r.attendant_id} className="flex items-center justify-between gap-2 px-4 py-3 bg-white border border-emerald-100 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 shrink-0">
                        {r.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-800 truncate">{r.name}</div>
                        {r.certificate_number && (
                          <div className="text-xs text-muted-foreground">Cert {r.certificate_number}</div>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-3 py-1 rounded-full shrink-0 ${opt ? opt.soft : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                      {opt ? opt.label : 'Not marked'}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ViewDriverAttendanceTab({ schoolId }: { schoolId: string | null; }) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<{ driver_id: string; name: string; license_number: string | null; status: DriverAttendanceStatus | null }[]>([]);

  const loadSummary = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);

    const { data: driverRows } = await supabase
      .from('drivers')
      .select('id, name, license_number')
      .eq('school_id', schoolId)
      .order('name');

    const { data: recordRows } = await supabase
      .from('driver_attendance')
      .select('driver_id, status')
      .eq('school_id', schoolId)
      .eq('date', date);

    const statusMap: Record<string, DriverAttendanceStatus> = {};
    (recordRows || []).forEach((r: any) => {
      statusMap[r.driver_id] = r.status;
    });

    const combined = (driverRows || []).map((d: any) => ({
      driver_id: d.id,
      name: d.name,
      license_number: d.license_number,
      status: statusMap[d.id] ?? null,
    }));

    setRows(combined);
    setLoading(false);
  }, [schoolId, date]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const counts = DRIVER_STATUS_OPTIONS.reduce((acc, opt) => {
    acc[opt.value] = rows.filter((r) => r.status === opt.value).length;
    return acc;
  }, {} as Record<DriverAttendanceStatus, number>);
  const notMarked = rows.filter((r) => r.status === null).length;

  return (
    <Card className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
        <CardTitle className="text-emerald-900">Driver Attendance View</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border border-emerald-100 rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
        />

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No drivers found for this school.</p>
        )}

        {!loading && rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {DRIVER_STATUS_OPTIONS.map((opt) => (
                <div key={opt.value} className={`text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-sm ${opt.soft}`}>
                  {counts[opt.value]} {opt.label}
                </div>
              ))}
              {notMarked > 0 && (
                <div className="text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-sm bg-gray-50 text-gray-500 border border-gray-200">
                  {notMarked} Not marked
                </div>
              )}
            </div>

            <div className="space-y-2">
              {rows.map((r) => {
                const opt = DRIVER_STATUS_OPTIONS.find((o) => o.value === r.status);
                return (
                  <div key={r.driver_id} className="flex items-center justify-between gap-2 px-4 py-3 bg-white border border-emerald-100 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 shrink-0">
                        {r.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-800 truncate">{r.name}</div>
                        {r.license_number && (
                          <div className="text-xs text-muted-foreground">License {r.license_number}</div>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-3 py-1 rounded-full shrink-0 ${opt ? opt.soft : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                      {opt ? opt.label : 'Not marked'}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ViewTeacherAttendanceTab({ schoolId }: { schoolId: string | null; }) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<{ teacher_id: string; full_name: string; employee_id: string | null; status: AttendanceStatus | null }[]>([]);

  const loadSummary = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);

    const { data: teacherRows } = await supabase
      .from('profiles')
      .select('id, full_name, employee_id')
      .eq('school_id', schoolId)
      .eq('role', 'teacher')
      .order('full_name');

    const { data: recordRows } = await supabase
      .from('teacher_attendance')
      .select('teacher_id, status')
      .eq('school_id', schoolId)
      .eq('date', date);

    const statusMap: Record<string, AttendanceStatus> = {};
    (recordRows || []).forEach((r: any) => {
      statusMap[r.teacher_id] = r.status;
    });

    const combined = (teacherRows || []).map((t: any) => ({
      teacher_id: t.id,
      full_name: t.full_name,
      employee_id: t.employee_id,
      status: statusMap[t.id] ?? null,
    }));

    setRows(combined);
    setLoading(false);
  }, [schoolId, date]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const counts = STATUS_OPTIONS.reduce((acc, opt) => {
    acc[opt.value] = rows.filter((r) => r.status === opt.value).length;
    return acc;
  }, {} as Record<AttendanceStatus, number>);
  const notMarked = rows.filter((r) => r.status === null).length;

  return (
    <Card className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
        <CardTitle className="text-emerald-900">Teacher Attendance View</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border border-emerald-100 rounded-xl px-3 py-2 text-sm w-full sm:w-auto"
        />

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No teachers found for this school.</p>
        )}

        {!loading && rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {STATUS_OPTIONS.map((opt) => (
                <div key={opt.value} className={`text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-sm ${opt.soft}`}>
                  {counts[opt.value]} {opt.label}
                </div>
              ))}
              {notMarked > 0 && (
                <div className="text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl shadow-sm bg-gray-50 text-gray-500 border border-gray-200">
                  {notMarked} Not marked
                </div>
              )}
            </div>

            <div className="space-y-2">
              {rows.map((r) => {
                const opt = STATUS_OPTIONS.find((o) => o.value === r.status);
                return (
                  <div key={r.teacher_id} className="flex items-center justify-between gap-2 px-4 py-3 bg-white border border-emerald-100 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700 shrink-0">
                        {r.full_name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-800 truncate">{r.full_name}</div>
                        {r.employee_id && (
                          <div className="text-xs text-muted-foreground">ID {r.employee_id}</div>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-3 py-1 rounded-full shrink-0 ${opt ? opt.soft : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                      {opt ? opt.label : 'Not marked'}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}