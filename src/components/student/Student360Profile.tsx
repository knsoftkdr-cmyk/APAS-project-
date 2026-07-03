// src/components/student/Student360Profile.tsx
//
// Shared component used by StudentDashboard, ParentDashboard, and
// staff panels (TeacherPanel / AdminPanel). RLS on the database
// already restricts what each role can see/edit — the `role` prop
// here only controls UI affordances (edit buttons, etc.), it is
// NOT a security boundary by itself.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User,
  GraduationCap,
  TrendingUp,
  Users,
  Stethoscope,
  Bus,
  FileText,
  Star,
  HeartHandshake,
  Phone,
  ClipboardList,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Info,
  Upload,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";


import { getStudentOverview, updateStudentCore, upsertParentProfile, deleteParentProfile, getMedicalRecord, upsertMedicalRecord, deleteMedicalRecord, getTransportAssignment, upsertTransportAssignment, deleteTransportAssignment, getBehaviourRecords, createBehaviourRecord, updateBehaviourRecord, deleteBehaviourRecord, getLearningSupportRecords, createLearningSupportRecord, updateLearningSupportRecord, deleteLearningSupportRecord, getEmergencyContacts, createEmergencyContact, updateEmergencyContact, deleteEmergencyContact, getStudentDocuments, uploadStudentDocument, deleteStudentDocument, APP_CONFIG, type StudentCore, type ParentProfile, type MedicalRecord, type TransportAssignment, type BehaviourRecord, type LearningSupportRecord, type EmergencyContact, type StudentDocument } from "@/lib/studentProfile";

export type ProfileRole = "student" | "parent" | "staff";

interface Student360ProfileProps {
  studentId: string;
  role: ProfileRole;
}

const TABS = [
  { value: "overview", label: "Overview", icon: User, color: "text-indigo-600", hint: "Personal & academic info, attendance, insights" },
  { value: "parents", label: "Parents", icon: Users, color: "text-blue-600", hint: "Parent/guardian contact details" },
  { value: "medical", label: "Medical", icon: Stethoscope, color: "text-rose-600", hint: "Blood group, allergies, medications, notes" },
  { value: "transport", label: "Transport", icon: Bus, color: "text-amber-600", hint: "Bus, route, pickup/drop details" },
  { value: "documents", label: "Documents", icon: FileText, color: "text-violet-600", hint: "Uploaded certificates & files" },
  { value: "behaviour", label: "Behaviour", icon: Star, color: "text-yellow-600", hint: "Behaviour records & score" },
  { value: "learning-support", label: "Learning Support", icon: HeartHandshake, color: "text-pink-600", hint: "IEP / support plans & accommodations" },
  { value: "emergency", label: "Emergency", icon: Phone, color: "text-red-600", hint: "Emergency contact numbers" },
] as const;


export default function Student360Profile({ studentId, role }: Student360ProfileProps) {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const canEdit = role === "student" || role === "parent";
  const canDelete = role === "parent";

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["student-overview", studentId],
    queryFn: () => getStudentOverview(studentId),
    enabled: !!studentId,
  });

  if (isLoading) return <ProfileSkeleton />;

  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <p className="text-destructive font-medium">Couldn't load this profile.</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <ProfileHeader student={data.core} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1.5 bg-slate-100/70 p-1.5 rounded-xl">
          {TABS.map((tab) => (
            <div key={tab.value} className="relative group">
              <TabsTrigger
                value={tab.value}
                className="gap-1.5 rounded-lg data-[state=active]:shadow-sm data-[state=active]:bg-white"
              >
                <tab.icon className={`h-4 w-4 ${tab.color}`} />
                {tab.label}
              </TabsTrigger>
              <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-48 -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                {tab.hint}
                <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-800" />
              </div>
            </div>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab data={data} canEdit={canEdit} studentId={studentId} />
        </TabsContent>

        <TabsContent value="parents" className="mt-4">
          <ParentsTab
            parents={data.parentProfiles}
            studentId={studentId}
            schoolId={data.core.school_id ?? ""}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>
        <TabsContent value="medical" className="mt-4">
          <MedicalTab
            studentId={studentId}
            schoolId={data.core.school_id ?? ""}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>
        <TabsContent value="transport" className="mt-4">
          <TransportTab
            studentId={studentId}
            schoolId={data.core.school_id ?? ""}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>
        <TabsContent value="documents" className="mt-4">
          <DocumentsTab
            studentId={studentId}
            schoolId={data.core.school_id ?? ""}
            canUpload={role === "parent"}
            canDelete={canDelete}
          />
        </TabsContent>
        <TabsContent value="behaviour" className="mt-4">
          <BehaviourTab
            studentId={studentId}
            schoolId={data.core.school_id ?? ""}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>
        <TabsContent value="learning-support" className="mt-4">
          <LearningSupportTab
            studentId={studentId}
            schoolId={data.core.school_id ?? ""}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>
        <TabsContent value="emergency" className="mt-4">
          <EmergencyTab
            studentId={studentId}
            schoolId={data.core.school_id ?? ""}
            parents={data.parentProfiles}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Header — photo, name, class, roll no, status
// ============================================================

function ProfileHeader({ student }: { student: Awaited<ReturnType<typeof getStudentOverview>>["core"] }) {
  return (
    <Card className="overflow-hidden border-0 shadow-md">
      <div className="h-16 bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400" />
      <CardContent className="pt-0 pb-5">
        <div className="flex items-center gap-4 -mt-8">
          <Avatar className="h-20 w-20 ring-4 ring-white shadow-lg">
            <AvatarImage src={undefined} alt={student.full_name ?? "Student"} />
            <AvatarFallback className="text-xl bg-indigo-100 text-indigo-700 font-semibold">
              {(student.full_name ?? "S").slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <div className="pb-1">
            <h2 className="text-xl font-bold text-slate-800">{student.full_name ?? "Unnamed Student"}</h2>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {student.class && (
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50 font-normal">
                  Class {student.class}
                </Badge>
              )}
              {student.section && (
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-50 font-normal">
                  Section {student.section}
                </Badge>
              )}
              {student.roll_number && (
                <Badge variant="secondary" className="bg-cyan-50 text-cyan-700 hover:bg-cyan-50 font-normal">
                  Roll No. {student.roll_number}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Overview tab
// ============================================================

function OverviewTab({
  data,
  canEdit,
  studentId,
}: {
  data: Awaited<ReturnType<typeof getStudentOverview>>;
  canEdit: boolean;
  studentId: string;
}) {
  const { core, behaviourScore, attendancePercentage, attendanceRecords, gpa, recentAssessments, behaviourRecords, aiInsights } = data;

  const personalFields: EditableField[] = [
    { key: "full_name", label: "Full Name", value: core.full_name },
    { key: "roll_number", label: "Roll No.", value: core.roll_number },
    { key: "date_of_birth", label: "Date of Birth", value: core.date_of_birth, type: "date" },
    { key: "parent_phone", label: "Parent Phone", value: core.parent_phone, type: "tel" },
    { key: "parent_email", label: "Parent Email", value: core.parent_email, type: "email" },
  ];

  const academicFields: EditableField[] = [
    { key: "class", label: "Class", value: core.class },
    { key: "section", label: "Section", value: core.section },
    { key: "grade", label: "Grade", value: core.grade },
    { key: "curriculum", label: "Curriculum", value: core.curriculum },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <EditableInfoCard
        title="Personal Information"
        icon={User}
        canEdit={canEdit}
        fields={personalFields}
        studentId={studentId}
      />

      <EditableInfoCard
        title="Academic Information"
        icon={GraduationCap}
        canEdit={canEdit}
        fields={academicFields}
        studentId={studentId}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> Summary Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2">
          <StatBox
            label="Attendance"
            value={attendancePercentage !== null ? `${attendancePercentage}%` : "No data"}
            status={
              attendancePercentage === null
                ? undefined
                : attendancePercentage >= APP_CONFIG.attendance.targetPercent
                ? "good"
                : "warning"
            }
          />
          <StatBox
            label="Performance (GPA)"
            value={gpa !== null ? `${gpa} / ${APP_CONFIG.gpa.scale}` : "No data"}
            status={gpa === null ? undefined : gpa >= 3.0 ? "good" : "warning"}
          />
          <StatBox label="Behaviour Score" value={`${behaviourScore} / 100`} status={behaviourScore >= 70 ? "good" : "warning"} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Attendance Trend (Last 6 Months)</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {attendanceRecords.length === 0 ? (
            <EmptyState message="No attendance data yet. This will populate once the attendance module is in use." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={toMonthlyTrend(attendanceRecords)}>
                <defs>
                  <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={12} unit="%" />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="percentage"
                  stroke="hsl(var(--primary))"
                  fill="url(#attendanceFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {aiInsights.length === 0 ? (
            <EmptyState message="No insights generated yet." />
          ) : (
            aiInsights.map((insight) => <InsightCard key={insight.id} insight={insight} />)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="h-4 w-4" /> Recent Behaviour Records
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {behaviourRecords.length === 0 ? (
            <EmptyState message="No behaviour records yet." />
          ) : (
            behaviourRecords.map((record) => (
              <div key={record.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                <div>
                  <p className="font-medium">{record.title}</p>
                  <p className="text-muted-foreground text-xs">{record.recorded_date}</p>
                </div>
                <Badge variant={record.category === "positive" ? "default" : record.category === "negative" ? "destructive" : "secondary"}>
                  {record.points > 0 ? `+${record.points}` : record.points}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Recent Assessments
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentAssessments.length === 0 ? (
            <EmptyState message="No assessments recorded yet." />
          ) : (
            recentAssessments.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                <p className="font-medium">{a.student_name ?? "Assessment"}</p>
                <span className="text-muted-foreground text-xs">{a.created_at?.slice(0, 10)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Editable Info Card — used for Personal Information and
// Academic Information on the Overview tab.
// ============================================================

interface EditableField {
  key: keyof StudentCore;
  label: string;
  value: string | null;
  type?: "text" | "date" | "tel" | "email";
}

function EditableInfoCard({
  title,
  icon: Icon,
  canEdit,
  fields,
  studentId,
}: {
  title: string;
  icon: React.ElementType;
  canEdit: boolean;
  fields: EditableField[];
  studentId: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: Partial<StudentCore>) => updateStudentCore(studentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-overview", studentId] });
      setIsEditing(false);
    },
  });

  const startEditing = () => {
    const initial: Record<string, string> = {};
    fields.forEach((f) => {
      initial[f.key as string] = f.value ?? "";
    });
    setFormValues(initial);
    mutation.reset();
    setIsEditing(true);
  };

  const handleSave = () => {
    mutation.mutate(formValues as Partial<StudentCore>);
  };

  const handleCancel = () => {
    setIsEditing(false);
    mutation.reset();
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4" /> {title}
        </CardTitle>
        {canEdit && !isEditing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isEditing ? (
          <>
            {fields.map((f) => (
              <div key={f.key as string} className="space-y-1">
                <label className="text-xs text-muted-foreground">{f.label}</label>
                <Input
                  type={f.type ?? "text"}
                  value={formValues[f.key as string] ?? ""}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [f.key as string]: e.target.value }))
                  }
                />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={mutation.isPending}>
                Cancel
              </Button>
            </div>
            {mutation.isError && (
              <p className="text-xs text-destructive pt-1">
                {mutation.error instanceof Error ? mutation.error.message : "Failed to save"}
              </p>
            )}
          </>
        ) : (
          fields.map((f) => <InfoRow key={f.key as string} label={f.label} value={f.value} />)
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Parents tab
// ============================================================

function ParentsTab({
  parents,
  studentId,
  schoolId,
  canEdit,
  canDelete,
}: {
  parents: ParentProfile[];
  studentId: string;
  schoolId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [addingNew, setAddingNew] = useState(false);

  return (
    <div className="space-y-4">
      {parents.length === 0 && !addingNew && (
        <EmptyState message="No parent/guardian details added yet." />
      )}
      {parents.map((parent) => (
        <ParentCard
          key={parent.id}
          parent={parent}
          studentId={studentId}
          schoolId={schoolId}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      ))}
      {addingNew && (
        <ParentCard
          studentId={studentId}
          schoolId={schoolId}
          canEdit={canEdit}
          canDelete={canDelete}
          onDoneAdding={() => setAddingNew(false)}
        />
      )}
      {canEdit && !addingNew && (
        <Button variant="outline" size="sm" onClick={() => setAddingNew(true)}>
          + Add Parent / Guardian
        </Button>
      )}
    </div>
  );
}

const PARENT_FIELD_DEFS: { key: keyof ParentProfile; label: string; type?: string }[] = [
  { key: "full_name", label: "Full Name" },
  { key: "occupation", label: "Occupation" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "alternate_phone", label: "Alternate Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "whatsapp_number", label: "WhatsApp Number", type: "tel" },
  { key: "address", label: "Address" },
];

function ParentCard({
  parent,
  studentId,
  schoolId,
  canEdit,
  canDelete,
  onDoneAdding,
}: {
  parent?: ParentProfile;
  studentId: string;
  schoolId: string;
  canEdit: boolean;
  canDelete: boolean;
  onDoneAdding?: () => void;
}) {
  const isNew = !parent;
  const [isEditing, setIsEditing] = useState(isNew);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const buildInitial = () => ({
    full_name: parent?.full_name ?? "",
    relation: parent?.relation ?? "father",
    occupation: parent?.occupation ?? "",
    phone: parent?.phone ?? "",
    alternate_phone: parent?.alternate_phone ?? "",
    email: parent?.email ?? "",
    whatsapp_number: parent?.whatsapp_number ?? "",
    address: parent?.address ?? "",
    is_primary_contact: parent?.is_primary_contact ?? false,
    pickup_authorized: parent?.pickup_authorized ?? false,
  });

  const [formValues, setFormValues] = useState<Record<string, any>>(buildInitial);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: Partial<ParentProfile> & { school_id: string; student_id: string }) =>
      upsertParentProfile(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-overview", studentId] });
      setIsEditing(false);
      if (isNew && onDoneAdding) onDoneAdding();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteParentProfile(parent!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-overview", studentId] });
      setConfirmingDelete(false);
    },
  });

  const handleSave = () => {
    mutation.mutate({
      ...(parent?.id ? { id: parent.id } : {}),
      school_id: schoolId,
      student_id: studentId,
      ...formValues,
    });
  };

  const handleCancel = () => {
    if (isNew && onDoneAdding) {
      onDoneAdding();
      return;
    }
    setFormValues(buildInitial());
    setIsEditing(false);
    mutation.reset();
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2 capitalize">
          <Users className="h-4 w-4" />
          {isNew ? "New Parent / Guardian" : parent!.relation}
          {parent?.is_primary_contact && <Badge variant="default" className="ml-1">Primary</Badge>}
        </CardTitle>
        <div className="flex gap-1">
          {canEdit && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
          {canDelete && !isNew && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Delete this parent/guardian record? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-destructive">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete"}
              </p>
            )}
          </div>
        ) : isEditing ? (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Relation</label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={formValues.relation}
                onChange={(e) => setFormValues((p) => ({ ...p, relation: e.target.value }))}
              >
                <option value="father">Father</option>
                <option value="mother">Mother</option>
                <option value="guardian">Guardian</option>
                <option value="other">Other</option>
              </select>
            </div>
            {PARENT_FIELD_DEFS.map((f) => (
              <div key={f.key as string} className="space-y-1">
                <label className="text-xs text-muted-foreground">{f.label}</label>
                <Input
                  type={f.type ?? "text"}
                  value={formValues[f.key as string] ?? ""}
                  onChange={(e) => setFormValues((p) => ({ ...p, [f.key as string]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formValues.is_primary_contact}
                  onChange={(e) => setFormValues((p) => ({ ...p, is_primary_contact: e.target.checked }))}
                />
                Primary Contact
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formValues.pickup_authorized}
                  onChange={(e) => setFormValues((p) => ({ ...p, pickup_authorized: e.target.checked }))}
                />
                Pickup Authorized
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={mutation.isPending}>
                Cancel
              </Button>
            </div>
            {mutation.isError && (
              <p className="text-xs text-destructive pt-1">
                {mutation.error instanceof Error ? mutation.error.message : "Failed to save"}
              </p>
            )}
          </>
        ) : (
          <>
            <InfoRow label="Full Name" value={parent?.full_name} />
            <InfoRow label="Occupation" value={parent?.occupation} />
            <InfoRow label="Phone" value={parent?.phone} />
            <InfoRow label="Alternate Phone" value={parent?.alternate_phone} />
            <InfoRow label="Email" value={parent?.email} />
            <InfoRow label="WhatsApp" value={parent?.whatsapp_number} />
            <InfoRow label="Address" value={parent?.address} />
            <InfoRow label="Pickup Authorized" value={parent?.pickup_authorized ? "Yes" : "No"} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Medical tab
// ============================================================

function TagInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  const addTag = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInputValue("");
  };

  const removeTag = (tag: string) => {
    onChange(values.filter((v) => v !== tag));
  };

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {values.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-1 hover:text-destructive"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addTag();
          }
        }}
        placeholder="Type and press Enter to add"
      />
    </div>
  );
}

function MedicalTab({
  studentId,
  schoolId,
  canEdit,
  canDelete,
}: {
  studentId: string;
  schoolId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: record, isLoading } = useQuery({
    queryKey: ["medical-record", studentId],
    queryFn: () => getMedicalRecord(studentId),
    enabled: !!studentId,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const buildInitial = () => ({
    blood_group: record?.blood_group ?? "",
    allergies: record?.allergies ?? [],
    chronic_conditions: record?.chronic_conditions ?? [],
    current_medications: record?.current_medications ?? [],
    disabilities: record?.disabilities ?? "",
    emergency_medical_notes: record?.emergency_medical_notes ?? "",
  });

  const [formValues, setFormValues] = useState<any>(buildInitial);

  const mutation = useMutation({
    mutationFn: (payload: Partial<MedicalRecord> & { school_id: string; student_id: string }) =>
      upsertMedicalRecord(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["medical-record", studentId] });
      setIsEditing(false);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteMedicalRecord(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["medical-record", studentId] });
      setConfirmingDelete(false);
    },
  });

  const startEditing = () => {
    setFormValues(buildInitial());
    mutation.reset();
    setIsEditing(true);
  };

  const handleSave = () => {
    mutation.mutate({
      school_id: schoolId,
      student_id: studentId,
      ...formValues,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    mutation.reset();
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Stethoscope className="h-4 w-4" /> Medical Information
        </CardTitle>
        <div className="flex gap-1">
          {canEdit && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" onClick={startEditing}>
              {record ? "Edit" : "Add Medical Info"}
            </Button>
          )}
          {canDelete && record && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Delete all medical information for this student? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-destructive">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete"}
              </p>
            )}
          </div>
        ) : isEditing ? (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Blood Group</label>
              <Input
                value={formValues.blood_group}
                onChange={(e) => setFormValues((p: any) => ({ ...p, blood_group: e.target.value }))}
                placeholder="e.g. O+"
              />
            </div>

            <TagInput
              label="Allergies"
              values={formValues.allergies}
              onChange={(v) => setFormValues((p: any) => ({ ...p, allergies: v }))}
            />
            <TagInput
              label="Chronic Conditions"
              values={formValues.chronic_conditions}
              onChange={(v) => setFormValues((p: any) => ({ ...p, chronic_conditions: v }))}
            />
            <TagInput
              label="Current Medications"
              values={formValues.current_medications}
              onChange={(v) => setFormValues((p: any) => ({ ...p, current_medications: v }))}
            />

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Disabilities</label>
              <Input
                value={formValues.disabilities}
                onChange={(e) => setFormValues((p: any) => ({ ...p, disabilities: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Emergency Medical Notes</label>
              <Input
                value={formValues.emergency_medical_notes}
                onChange={(e) => setFormValues((p: any) => ({ ...p, emergency_medical_notes: e.target.value }))}
              />
            </div>

            <div className="flex gap-2 pt-2"></div>

            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={mutation.isPending}>
                Cancel
              </Button>
            </div>
            {mutation.isError && (
              <p className="text-xs text-destructive pt-1">
                {mutation.error instanceof Error ? mutation.error.message : "Failed to save"}
              </p>
            )}
          </>
        ) : record ? (
          <>
            <InfoRow label="Blood Group" value={record.blood_group} />
            <InfoRow label="Allergies" value={record.allergies?.join(", ")} />
            <InfoRow label="Chronic Conditions" value={record.chronic_conditions?.join(", ")} />
            <InfoRow label="Current Medications" value={record.current_medications?.join(", ")} />
            <InfoRow label="Disabilities" value={record.disabilities} />
            <InfoRow label="Emergency Medical Notes" value={record.emergency_medical_notes} />
          </>
        ) : (
          <EmptyState message="No medical information added yet." />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Transport tab
// ============================================================

function TransportTab({
  studentId,
  schoolId,
  canEdit,
  canDelete,
}: {
  studentId: string;
  schoolId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: record, isLoading } = useQuery({
    queryKey: ["transport-assignment", studentId],
    queryFn: () => getTransportAssignment(studentId),
    enabled: !!studentId,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const buildInitial = () => ({
    bus_number: record?.bus_number ?? "",
    route_name: record?.route_name ?? "",
    pickup_point: record?.pickup_point ?? "",
    pickup_time: record?.pickup_time ?? "",
    drop_point: record?.drop_point ?? "",
    drop_time: record?.drop_time ?? "",
    driver_name: record?.driver_name ?? "",
    driver_phone: record?.driver_phone ?? "",
    vehicle_registration_number: record?.vehicle_registration_number ?? "",
    transport_fee: record?.transport_fee ?? "",
    fee_status: record?.fee_status ?? "pending",
    status: record?.status ?? "active",
  });

  const [formValues, setFormValues] = useState<any>(buildInitial);

  const mutation = useMutation({
    mutationFn: (payload: Partial<TransportAssignment> & { school_id: string; student_id: string }) =>
      upsertTransportAssignment(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transport-assignment", studentId] });
      setIsEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransportAssignment(studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transport-assignment", studentId] });
      setConfirmingDelete(false);
    },
  });

  const startEditing = () => {
    setFormValues(buildInitial());
    mutation.reset();
    setIsEditing(true);
  };

  const handleSave = () => {
    mutation.mutate({
      school_id: schoolId,
      student_id: studentId,
      ...formValues,
      transport_fee: formValues.transport_fee === "" ? null : Number(formValues.transport_fee),
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    mutation.reset();
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Bus className="h-4 w-4" /> Transport Details
        </CardTitle>
        <div className="flex gap-1">
          {canEdit && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" onClick={startEditing}>
              {record ? "Edit" : "Add Transport Info"}
            </Button>
          )}
          {canDelete && record && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Delete transport information for this student? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-destructive">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete"}
              </p>
            )}
          </div>
        ) : isEditing ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Bus Number</label>
                <Input
                  value={formValues.bus_number}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, bus_number: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Route Name</label>
                <Input
                  value={formValues.route_name}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, route_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Pickup Point</label>
                <Input
                  value={formValues.pickup_point}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, pickup_point: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Pickup Time</label>
                <Input
                  type="time"
                  value={formValues.pickup_time}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, pickup_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Drop Point</label>
                <Input
                  value={formValues.drop_point}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, drop_point: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Drop Time</label>
                <Input
                  type="time"
                  value={formValues.drop_time}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, drop_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Driver Name</label>
                <Input
                  value={formValues.driver_name}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, driver_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Driver Phone</label>
                <Input
                  type="tel"
                  value={formValues.driver_phone}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, driver_phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Vehicle Registration Number</label>
                <Input
                  value={formValues.vehicle_registration_number}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, vehicle_registration_number: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Transport Fee</label>
                <Input
                  type="number"
                  value={formValues.transport_fee}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, transport_fee: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Fee Status</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={formValues.fee_status}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, fee_status: e.target.value }))}
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="waived">Waived</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Status</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={formValues.status}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={mutation.isPending}>
                Cancel
              </Button>
            </div>
            {mutation.isError && (
              <p className="text-xs text-destructive pt-1">
                {mutation.error instanceof Error ? mutation.error.message : "Failed to save"}
              </p>
            )}
          </>
        ) : record ? (
          <>
            <InfoRow label="Bus Number" value={record.bus_number} />
            <InfoRow label="Route Name" value={record.route_name} />
            <InfoRow label="Pickup Point" value={record.pickup_point} />
            <InfoRow label="Pickup Time" value={record.pickup_time} />
            <InfoRow label="Drop Point" value={record.drop_point} />
            <InfoRow label="Drop Time" value={record.drop_time} />
            <InfoRow label="Driver Name" value={record.driver_name} />
            <InfoRow label="Driver Phone" value={record.driver_phone} />
            <InfoRow label="Vehicle Registration Number" value={record.vehicle_registration_number} />
            <InfoRow label="Transport Fee" value={record.transport_fee != null ? String(record.transport_fee) : null} />
            <InfoRow label="Fee Status" value={record.fee_status} />
            <InfoRow label="Status" value={record.status} />
          </>
        ) : (
          <EmptyState message="No transport information added yet." />
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Behaviour tab
// ============================================================

function BehaviourTab({
  studentId,
  schoolId,
  canEdit,
  canDelete,
}: {
  studentId: string;
  schoolId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [addingNew, setAddingNew] = useState(false);

  const { data: records, isLoading } = useQuery({
    queryKey: ["behaviour-records-full", studentId],
    queryFn: () => getBehaviourRecords(studentId, { page: 0, pageSize: 100 }),
    enabled: !!studentId,
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {(!records || records.length === 0) && !addingNew && (
        <EmptyState message="No behaviour records yet." />
      )}
      {records?.map((record) => (
        <BehaviourRecordCard
          key={record.id}
          record={record}
          studentId={studentId}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      ))}
      {addingNew && (
        <BehaviourRecordCard
          studentId={studentId}
          schoolId={schoolId}
          canEdit={canEdit}
          canDelete={canDelete}
          onDoneAdding={() => setAddingNew(false)}
        />
      )}
      {canEdit && !addingNew && (
        <Button variant="outline" size="sm" onClick={() => setAddingNew(true)}>
          + Add Behaviour Record
        </Button>
      )}
    </div>
  );
}

function BehaviourRecordCard({
  record,
  studentId,
  schoolId,
  canEdit,
  canDelete,
  onDoneAdding,
}: {
  record?: BehaviourRecord;
  studentId: string;
  schoolId?: string;
  canEdit: boolean;
  canDelete: boolean;
  onDoneAdding?: () => void;
}) {
  const isNew = !record;
  const [isEditing, setIsEditing] = useState(isNew);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const buildInitial = () => ({
    category: record?.category ?? "positive",
    title: record?.title ?? "",
    description: record?.description ?? "",
    points: record?.points ?? 0,
    recorded_date: record?.recorded_date ?? new Date().toISOString().slice(0, 10),
    action_taken: record?.action_taken ?? "",
  });

  const [formValues, setFormValues] = useState<any>(buildInitial);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (isNew) {
        return createBehaviourRecord({
          school_id: schoolId!,
          student_id: studentId,
          ...formValues,
          points: Number(formValues.points),
        });
      }
      return updateBehaviourRecord(record!.id, {
        ...formValues,
        points: Number(formValues.points),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["behaviour-records-full", studentId] });
      queryClient.invalidateQueries({ queryKey: ["student-overview", studentId] });
      setIsEditing(false);
      if (isNew && onDoneAdding) onDoneAdding();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteBehaviourRecord(record!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["behaviour-records-full", studentId] });
      queryClient.invalidateQueries({ queryKey: ["student-overview", studentId] });
      setConfirmingDelete(false);
    },
  });

  const handleCancel = () => {
    if (isNew && onDoneAdding) {
      onDoneAdding();
      return;
    }
    setFormValues(buildInitial());
    setIsEditing(false);
    saveMutation.reset();
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Star className="h-4 w-4" />
          {isNew ? "New Behaviour Record" : record!.title}
          {!isNew && (
            <Badge variant={record!.category === "positive" ? "default" : record!.category === "negative" ? "destructive" : "secondary"}>
              {record!.points > 0 ? `+${record!.points}` : record!.points}
            </Badge>
          )}
        </CardTitle>
        <div className="flex gap-1">
          {canEdit && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
          {canDelete && !isNew && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Delete this behaviour record? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-destructive">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete"}
              </p>
            )}
          </div>
        ) : isEditing ? (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Category</label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={formValues.category}
                onChange={(e) => setFormValues((p: any) => ({ ...p, category: e.target.value }))}
              >
                <option value="positive">Positive</option>
                <option value="negative">Negative</option>
                <option value="neutral">Neutral</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Title</label>
              <Input
                value={formValues.title}
                onChange={(e) => setFormValues((p: any) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Description</label>
              <Input
                value={formValues.description}
                onChange={(e) => setFormValues((p: any) => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Points</label>
                <Input
                  type="number"
                  value={formValues.points}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, points: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date</label>
                <Input
                  type="date"
                  value={formValues.recorded_date}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, recorded_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Action Taken</label>
              <Input
                value={formValues.action_taken}
                onChange={(e) => setFormValues((p: any) => ({ ...p, action_taken: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={saveMutation.isPending}>
                Cancel
              </Button>
            </div>
            {saveMutation.isError && (
              <p className="text-xs text-destructive pt-1">
                {saveMutation.error instanceof Error ? saveMutation.error.message : "Failed to save"}
              </p>
            )}
          </>
        ) : (
          <>
            <InfoRow label="Category" value={record?.category} />
            <InfoRow label="Description" value={record?.description} />
            <InfoRow label="Date" value={record?.recorded_date} />
            <InfoRow label="Action Taken" value={record?.action_taken} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Learning Support tab — IEP/support plan records: type,
// diagnosis, goals, accommodations, dates, status.
// ============================================================

function LearningSupportTab({
  studentId,
  schoolId,
  canEdit,
  canDelete,
}: {
  studentId: string;
  schoolId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [addingNew, setAddingNew] = useState(false);

  const { data: records, isLoading } = useQuery({
    queryKey: ["learning-support-records", studentId],
    queryFn: () => getLearningSupportRecords(studentId),
    enabled: !!studentId,
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {(!records || records.length === 0) && !addingNew && (
        <EmptyState message="No learning support records yet." />
      )}
      {records?.map((record) => (
        <LearningSupportCard
          key={record.id}
          record={record}
          studentId={studentId}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      ))}
      {addingNew && (
        <LearningSupportCard
          studentId={studentId}
          schoolId={schoolId}
          canEdit={canEdit}
          canDelete={canDelete}
          onDoneAdding={() => setAddingNew(false)}
        />
      )}
      {canEdit && !addingNew && (
        <Button variant="outline" size="sm" onClick={() => setAddingNew(true)}>
          + Add Learning Support Record
        </Button>
      )}
    </div>
  );
}

function LearningSupportCard({
  record,
  studentId,
  schoolId,
  canEdit,
  canDelete,
  onDoneAdding,
}: {
  record?: LearningSupportRecord;
  studentId: string;
  schoolId?: string;
  canEdit: boolean;
  canDelete: boolean;
  onDoneAdding?: () => void;
}) {
  const isNew = !record;
  const [isEditing, setIsEditing] = useState(isNew);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const buildInitial = () => ({
    support_type: record?.support_type ?? "",
    diagnosis: record?.diagnosis ?? "",
    goals: record?.goals ?? "",
    accommodations: record?.accommodations ?? "",
    start_date: record?.start_date ?? new Date().toISOString().slice(0, 10),
    review_date: record?.review_date ?? "",
    status: record?.status ?? "active",
  });

  const [formValues, setFormValues] = useState<any>(buildInitial);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (isNew) {
        return createLearningSupportRecord({
          school_id: schoolId!,
          student_id: studentId,
          ...formValues,
        });
      }
      return updateLearningSupportRecord(record!.id, formValues);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-support-records", studentId] });
      setIsEditing(false);
      if (isNew && onDoneAdding) onDoneAdding();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLearningSupportRecord(record!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-support-records", studentId] });
      setConfirmingDelete(false);
    },
  });

  const handleCancel = () => {
    if (isNew && onDoneAdding) {
      onDoneAdding();
      return;
    }
    setFormValues(buildInitial());
    setIsEditing(false);
    saveMutation.reset();
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2 capitalize">
          <HeartHandshake className="h-4 w-4" />
          {isNew ? "New Learning Support Record" : record!.support_type || "Support Record"}
          {!isNew && (
            <Badge variant={record!.status === "active" ? "default" : record!.status === "completed" ? "secondary" : "destructive"}>
              {record!.status}
            </Badge>
          )}
        </CardTitle>
        <div className="flex gap-1">
          {canEdit && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
          {canDelete && !isNew && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Delete this learning support record? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-destructive">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete"}
              </p>
            )}
          </div>
        ) : isEditing ? (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Support Type</label>
              <Input
                value={formValues.support_type}
                onChange={(e) => setFormValues((p: any) => ({ ...p, support_type: e.target.value }))}
                placeholder="e.g. Speech Therapy, ADHD Support, Dyslexia Accommodation"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Diagnosis</label>
              <Input
                value={formValues.diagnosis}
                onChange={(e) => setFormValues((p: any) => ({ ...p, diagnosis: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Goals</label>
              <Input
                value={formValues.goals}
                onChange={(e) => setFormValues((p: any) => ({ ...p, goals: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Accommodations</label>
              <Input
                value={formValues.accommodations}
                onChange={(e) => setFormValues((p: any) => ({ ...p, accommodations: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Start Date</label>
                <Input
                  type="date"
                  value={formValues.start_date}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Review Date</label>
                <Input
                  type="date"
                  value={formValues.review_date}
                  onChange={(e) => setFormValues((p: any) => ({ ...p, review_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Status</label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={formValues.status}
                onChange={(e) => setFormValues((p: any) => ({ ...p, status: e.target.value }))}
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="discontinued">Discontinued</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={saveMutation.isPending}>
                Cancel
              </Button>
            </div>
            {saveMutation.isError && (
              <p className="text-xs text-destructive pt-1">
                {saveMutation.error instanceof Error ? saveMutation.error.message : "Failed to save"}
              </p>
            )}
          </>
        ) : (
          <>
            <InfoRow label="Diagnosis" value={record?.diagnosis} />
            <InfoRow label="Goals" value={record?.goals} />
            <InfoRow label="Accommodations" value={record?.accommodations} />
            <InfoRow label="Start Date" value={record?.start_date} />
            <InfoRow label="Review Date" value={record?.review_date} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Emergency Contacts tab — simple list: Relation, Name, Phone
// only (Father / Mother / Sibling / Other).
// ============================================================

function EmergencyTab({
  studentId,
  schoolId,
  parents,
  canEdit,
  canDelete,
}: {
  studentId: string;
  schoolId: string;
  parents: ParentProfile[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [addingNew, setAddingNew] = useState(false);
  const queryClient = useQueryClient();

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["emergency-contacts", studentId],
    queryFn: () => getEmergencyContacts(studentId),
    enabled: !!studentId,
  });

  const quickAddMutation = useMutation({
    mutationFn: (parent: ParentProfile) =>
      createEmergencyContact({
        school_id: schoolId,
        student_id: studentId,
        relation: parent.relation === "guardian" || parent.relation === "other" ? "other" : parent.relation,
        full_name: parent.full_name,
        phone: parent.phone ?? "",
        priority_order: (contacts?.length ?? 0) + 1,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emergency-contacts", studentId] });
    },
  });

  const existingNames = new Set((contacts ?? []).map((c) => c.full_name.trim().toLowerCase()));
  const availableParents = parents.filter((p) => !existingNames.has(p.full_name.trim().toLowerCase()));

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {(!contacts || contacts.length === 0) && !addingNew && (
        <EmptyState message="No emergency contacts added yet." />
      )}
      {contacts?.map((contact) => (
        <EmergencyContactCard
          key={contact.id}
          contact={contact}
          studentId={studentId}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      ))}
      {addingNew && (
        <EmergencyContactCard
          studentId={studentId}
          schoolId={schoolId}
          nextPriority={(contacts?.length ?? 0) + 1}
          canEdit={canEdit}
          canDelete={canDelete}
          onDoneAdding={() => setAddingNew(false)}
        />
      )}

      {canEdit && availableParents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Quick add from Parents tab
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {availableParents.map((parent) => (
              <Button
                key={parent.id}
                variant="outline"
                size="sm"
                onClick={() => quickAddMutation.mutate(parent)}
                disabled={quickAddMutation.isPending}
              >
                + {parent.full_name || parent.relation} ({parent.relation})
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {canEdit && !addingNew && (
        <Button variant="outline" size="sm" onClick={() => setAddingNew(true)}>
          + Add Emergency Contact
        </Button>
      )}
    </div>
  );
}

function EmergencyContactCard({
  contact,
  studentId,
  schoolId,
  nextPriority,
  canEdit,
  canDelete,
  onDoneAdding,
}: {
  contact?: EmergencyContact;
  studentId: string;
  schoolId?: string;
  nextPriority?: number;
  canEdit: boolean;
  canDelete: boolean;
  onDoneAdding?: () => void;
}) {
  const isNew = !contact;
  const [isEditing, setIsEditing] = useState(isNew);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const buildInitial = () => ({
    relation: contact?.relation ?? "father",
    full_name: contact?.full_name ?? "",
    phone: contact?.phone ?? "",
  });

  const [formValues, setFormValues] = useState<any>(buildInitial);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (isNew) {
        return createEmergencyContact({
          school_id: schoolId!,
          student_id: studentId,
          priority_order: nextPriority ?? 1,
          ...formValues,
        });
      }
      return updateEmergencyContact(contact!.id, formValues);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emergency-contacts", studentId] });
      setIsEditing(false);
      if (isNew && onDoneAdding) onDoneAdding();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEmergencyContact(contact!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emergency-contacts", studentId] });
      setConfirmingDelete(false);
    },
  });

  const handleCancel = () => {
    if (isNew && onDoneAdding) {
      onDoneAdding();
      return;
    }
    setFormValues(buildInitial());
    setIsEditing(false);
    saveMutation.reset();
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2 capitalize">
          <Phone className="h-4 w-4" />
          {isNew ? "New Emergency Contact" : contact!.relation}
        </CardTitle>
        <div className="flex gap-1">
          {canEdit && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
          {canDelete && !isNew && !isEditing && !confirmingDelete && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Delete this emergency contact? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-destructive">
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete"}
              </p>
            )}
          </div>
        ) : isEditing ? (
          <>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Relation</label>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={formValues.relation}
                onChange={(e) => setFormValues((p: any) => ({ ...p, relation: e.target.value }))}
              >
                <option value="father">Father</option>
                <option value="mother">Mother</option>
                <option value="sibling">Sibling</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={formValues.full_name}
                onChange={(e) => setFormValues((p: any) => ({ ...p, full_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Phone Number</label>
              <Input
                type="tel"
                value={formValues.phone}
                onChange={(e) => setFormValues((p: any) => ({ ...p, phone: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={saveMutation.isPending}>
                Cancel
              </Button>
            </div>
            {saveMutation.isError && (
              <p className="text-xs text-destructive pt-1">
                {saveMutation.error instanceof Error ? saveMutation.error.message : "Failed to save"}
              </p>
            )}
          </>
        ) : (
          <>
            <InfoRow label="Name" value={contact?.full_name} />
            <InfoRow label="Phone Number" value={contact?.phone} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Documents tab — upload any file type, list uploaded documents
// with preview (images/PDFs open inline) or download link.
// ============================================================

function DocumentsTab({
  studentId,
  schoolId,
  canUpload,
  canDelete,
}: {
  studentId: string;
  schoolId: string;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["student-documents", studentId],
    queryFn: () => getStudentDocuments(studentId),
    enabled: !!studentId,
  });

  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("");

  const uploadMutation = useMutation({
    mutationFn: () => uploadStudentDocument(file!, studentId, schoolId, documentType || "Document"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-documents", studentId] });
      setFile(null);
      setDocumentType("");
    },
  });

  const documents = data?.records ?? [];

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {canUpload && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" /> Upload Document
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Document Type</label>
              <Input
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                placeholder="e.g. Birth Certificate, Aadhar Card, Transfer Certificate"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">File</label>
              <Input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button
              size="sm"
              onClick={() => uploadMutation.mutate()}
              disabled={!file || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
            {uploadMutation.isError && (
              <p className="text-xs text-destructive">
                {uploadMutation.error instanceof Error ? uploadMutation.error.message : "Failed to upload"}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Uploaded Documents
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {documents.length === 0 ? (
            <EmptyState message="No documents uploaded yet." />
          ) : (
            documents.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} studentId={studentId} canDelete={canDelete} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentRow({
  doc,
  studentId,
  canDelete,
}: {
  doc: StudentDocument;
  studentId: string;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteStudentDocument(doc.id, doc.file_url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-documents", studentId] });
      setConfirmingDelete(false);
    },
  });

  const ext = doc.document_name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
  const isPdf = ext === "pdf";

  return (
    <div className="flex items-center justify-between gap-3 border-b pb-3 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        {isImage ? (
          <img src={doc.file_url} alt={doc.document_name} className="h-12 w-12 rounded object-cover shrink-0 border" />
        ) : (
          <div className="h-12 w-12 rounded border flex items-center justify-center shrink-0 bg-muted">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{doc.document_type}</p>
          <p className="text-xs text-muted-foreground truncate">{doc.document_name}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline px-2 py-1">
          {isImage || isPdf ? "Preview" : "Download"}
        </a>
        {canDelete && !confirmingDelete && (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        )}
        {confirmingDelete && (
          <>
            <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "..." : "Confirm"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
// ============================================================
// Small shared pieces
// ============================================================

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between items-center text-sm py-1.5 px-2 -mx-2 rounded-md hover:bg-slate-50 transition-colors">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value || "—"}</span>
    </div>
  );
}

function StatBox({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: "good" | "warning";
}) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p
        className={
          status === "good"
            ? "text-lg font-semibold text-green-600"
            : status === "warning"
            ? "text-lg font-semibold text-amber-600"
            : "text-lg font-semibold"
        }
      >
        {value}
      </p>
    </div>
  );
}

function InsightCard({ insight }: { insight: { insight_type: string; title: string; description: string } }) {
  const config = {
    positive: { icon: CheckCircle2, className: "bg-green-50 text-green-800 border-green-200" },
    warning: { icon: AlertTriangle, className: "bg-amber-50 text-amber-800 border-amber-200" },
    info: { icon: Info, className: "bg-blue-50 text-blue-800 border-blue-200" },
  }[insight.insight_type] ?? { icon: Info, className: "bg-muted" };

  const Icon = config.icon;

  return (
    <div className={`rounded-lg border p-3 text-sm ${config.className}`}>
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{insight.title}</p>
          <p className="text-xs opacity-90">{insight.description}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[80px] text-sm text-muted-foreground text-center px-4">
      {message}
    </div>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        {label} tab — coming next.
      </CardContent>
    </Card>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function toMonthlyTrend(records: { attendance_date: string; status: string }[]) {
  const byMonth: Record<string, { present: number; total: number }> = {};

  for (const r of records) {
    const month = new Date(r.attendance_date).toLocaleString("default", { month: "short" });
    if (!byMonth[month]) byMonth[month] = { present: 0, total: 0 };
    byMonth[month].total += 1;
    if (r.status === "present" || (r.status === "late" && APP_CONFIG.attendance.countLateAsPresent)) {
      byMonth[month].present += 1;
    }
  }

  return Object.entries(byMonth).map(([month, { present, total }]) => ({
    month,
    percentage: total > 0 ? Math.round((present / total) * 100) : 0,
  }));
}