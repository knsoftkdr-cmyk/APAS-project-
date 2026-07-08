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

  const [activeTab, setActiveTab] = useState<string>('mark');
  useEffect(() => {
    if (!role) return;
    setActiveTab(role === 'student' || role === 'parent' ? 'mine' : 'mark');
  }, [role]);

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {canMark && <TabsTrigger value="mark">Student Attendance</TabsTrigger>}
            {canMark && <TabsTrigger value="view">Student Attendance View</TabsTrigger>}
            {isSelfView && <TabsTrigger value="mine">My Attendance</TabsTrigger>}
            {canManageTeacherAttendance && <TabsTrigger value="teacher-mark">Teacher Attendance</TabsTrigger>}
            {canManageTeacherAttendance && <TabsTrigger value="teacher-view">Teacher Attendance View</TabsTrigger>}
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
        </Tabs>
      </div>
    </AppLayout>
  );
}

function MyAttendanceTab({ schoolId, role, userId }: { schoolId: string | null; role: string | null; userId: string | null; }) {
  interface ChildRow { id: string; full_name: string; profile_id: string | null; }
  const [linkedChildren, setLinkedChildren] = useState<ChildRow[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [myStudentRow, setMyStudentRow] = useState<ChildRow | null>(null);
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<{ date: string; status: AttendanceStatus }[]>([]);

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
    if (!schoolId || !month) return;
    if (role === 'teacher') {
      if (!userId) return;
      setLoading(true);
      const start = `${month}-01`;
      const [y, m] = month.split('-').map(Number);
      const endDate = new Date(y, m, 0).toISOString().slice(0, 10);
      supabase
        .from('teacher_attendance')
        .select('date, status')
        .eq('school_id', schoolId)
        .eq('teacher_id', userId)
        .gte('date', start)
        .lte('date', endDate)
        .then(({ data }) => {
          setRecords((data || []) as { date: string; status: AttendanceStatus }[]);
          setLoading(false);
        });
      return;
    }
    if (!activeStudentId) return;
    setLoading(true);
    const start = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const endDate = new Date(y, m, 0).toISOString().slice(0, 10); // last day of month

    supabase
      .from('attendance_records')
      .select('date, status')
      .eq('school_id', schoolId)
      .eq('student_id', activeStudentId)
      .gte('date', start)
      .lte('date', endDate)
      .then(({ data }) => {
        setRecords((data || []) as { date: string; status: AttendanceStatus }[]);
        setLoading(false);
      });
  }, [schoolId, activeStudentId, month, role, userId]);

  const counts = STATUS_OPTIONS.reduce((acc, opt) => {
    acc[opt.value] = records.filter((r) => r.status === opt.value).length;
    return acc;
  }, {} as Record<AttendanceStatus, number>);
  const totalMarked = records.length;
  const presentLike = counts.present + counts.late + counts.half_day;
  const attendancePct = totalMarked > 0 ? Math.round((presentLike / totalMarked) * 100) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
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
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm"
          />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        )}

        {role === 'parent' && linkedChildren.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">No linked children found.</p>
        )}

        {!loading && (role === 'teacher' || activeStudentId) && (
          <>
            {totalMarked > 0 && (
              <div className={`flex flex-col md:flex-row items-center gap-6 p-5 bg-white border border-gray-100 ${CARD_SHADOW}`}>
                <div className="w-full md:w-56 h-56 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={STATUS_OPTIONS.map((opt) => ({ name: opt.label, value: counts[opt.value] })).filter((d) => d.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {STATUS_OPTIONS.filter((opt) => counts[opt.value] > 0).map((opt) => (
                          <Cell key={opt.value} fill={opt.hex} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-3 text-center md:text-left">
                  {attendancePct !== null && (
                    <div className="text-3xl font-bold text-gray-800">
                      {attendancePct}%
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        attendance ({totalMarked} days marked this month)
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-center md:justify-start gap-2">
                    {STATUS_OPTIONS.map((opt) => (
                      <div key={opt.value} className={`text-sm font-semibold px-4 py-2 ${CARD_SHADOW} ${opt.soft}`}>
                        {counts[opt.value]} {opt.label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {totalMarked === 0 && (
              <p className="text-sm text-muted-foreground">No attendance records for this month yet.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Mark Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="w-48">
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
            className="border rounded-md px-3 py-2 text-sm"
          />

          {settings?.mode === 'period' && (
            <Select value={String(selectedPeriod)} onValueChange={(v) => setSelectedPeriod(Number(v))}>
              <SelectTrigger className="w-32">
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
            <Button variant="outline" size="sm" onClick={markAllPresent}>
              Mark all present
            </Button>
          )}

          {students.length > 0 && (
            <div className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 bg-white ${CARD_SHADOW} border border-gray-100`}>
              <span className="text-green-600">{presentCount} present</span>
              <span className="text-muted-foreground">/ {students.length} total</span>
              {unmarkedCount > 0 && <span className="text-amber-600">· {unmarkedCount} unmarked</span>}
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
          <div className="space-y-2">
            {students.map((s) => (
              <div key={s.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                <div>
                  <div className="font-medium text-sm">{s.full_name}</div>
                  {s.roll_number && (
                    <div className="text-xs text-muted-foreground">Roll No. {s.roll_number}</div>
                  )}
                </div>
                <div className="flex gap-1">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(s.id, opt.value)}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        marks[s.id] === opt.value ? opt.color : 'bg-transparent text-muted-foreground'
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
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSubmit} disabled={saving}>
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
    <Card>
      <CardHeader>
        <CardTitle>View Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger className="w-48">
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
            className="border rounded-md px-3 py-2 text-sm"
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
            <div className="flex flex-wrap gap-3">
              {STATUS_OPTIONS.map((opt) => (
                <div key={opt.value} className={`text-sm font-semibold px-4 py-2.5 ${CARD_SHADOW} ${opt.soft}`}>
                  {counts[opt.value]} {opt.label}
                </div>
              ))}
              {notMarked > 0 && (
                <div className={`text-sm font-semibold px-4 py-2.5 ${CARD_SHADOW} bg-gray-50 text-gray-500 border border-gray-200`}>
                  {notMarked} Not marked
                </div>
              )}
            </div>

            <div className="space-y-2">
              {rows.map((r) => {
                const opt = STATUS_OPTIONS.find((o) => o.value === r.status);
                return (
                  <div key={r.student_id} className={`flex items-center justify-between px-4 py-3 bg-white border border-gray-100 ${CARD_SHADOW}`}>
                    <div>
                      <div className="font-medium text-sm">{r.full_name}</div>
                      {r.roll_number && (
                        <div className="text-xs text-muted-foreground">Roll No. {r.roll_number}</div>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-3 py-1 rounded-full ${opt ? opt.soft : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
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
    <Card>
      <CardHeader>
        <CardTitle>Teacher Attendance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm"
          />
          {teachers.length > 0 && (
            <div className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 bg-white ${CARD_SHADOW} border border-gray-100`}>
              <span className="text-green-600">{presentCount} present</span>
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
          <div className="space-y-2">
            {teachers.map((t) => (
              <div key={t.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                <div>
                  <div className="font-medium text-sm">{t.full_name}</div>
                  {(t.employee_id || t.designation) && (
                    <div className="text-xs text-muted-foreground">
                      {t.employee_id ? `ID ${t.employee_id}` : ''}{t.employee_id && t.designation ? ' · ' : ''}{t.designation ?? ''}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStatus(t.id, opt.value)}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        marks[t.id] === opt.value ? opt.color : 'bg-transparent text-muted-foreground'
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
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : 'Save Attendance'}
            </Button>
            {saveMessage && <span className="text-sm text-muted-foreground">{saveMessage}</span>}
          </div>
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
    <Card>
      <CardHeader>
        <CardTitle>Teacher Attendance View</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm"
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
            <div className="flex flex-wrap gap-3">
              {STATUS_OPTIONS.map((opt) => (
                <div key={opt.value} className={`text-sm font-semibold px-4 py-2.5 ${CARD_SHADOW} ${opt.soft}`}>
                  {counts[opt.value]} {opt.label}
                </div>
              ))}
              {notMarked > 0 && (
                <div className={`text-sm font-semibold px-4 py-2.5 ${CARD_SHADOW} bg-gray-50 text-gray-500 border border-gray-200`}>
                  {notMarked} Not marked
                </div>
              )}
            </div>

            <div className="space-y-2">
              {rows.map((r) => {
                const opt = STATUS_OPTIONS.find((o) => o.value === r.status);
                return (
                  <div key={r.teacher_id} className={`flex items-center justify-between px-4 py-3 bg-white border border-gray-100 ${CARD_SHADOW}`}>
                    <div>
                      <div className="font-medium text-sm">{r.full_name}</div>
                      {r.employee_id && (
                        <div className="text-xs text-muted-foreground">ID {r.employee_id}</div>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-3 py-1 rounded-full ${opt ? opt.soft : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
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