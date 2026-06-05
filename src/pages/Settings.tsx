import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import settingsBanner from "@/assets/settings-banner.png";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  User,
  Lock,
  Loader2,
  Globe,
  Upload,
  Briefcase,
  Mail,
  Phone,
  X,
  Pencil,
  BadgeCheck,
  Calendar,
  Building2,
  GraduationCap,
  Clock,
  Hash,
  ChevronRight,
} from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { languages, Language } from "@/i18n/translations";
import { useStudentProfile } from "@/hooks/useProfileCompletion";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
type DrawerSection = "personal" | "professional" | "password" | "language" | null;

// ─── Reusable info row ────────────────────────────────────────────────────────
const InfoRow = ({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
}) => (
  <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg shrink-0" style={{background:"#eef2f8", color:"#1e3a5f"}}>
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-gray-800 mt-0.5 break-words">
        {value || <span className="text-gray-300 font-normal italic">Not set</span>}
      </p>
    </div>
  </div>
);

// ─── Drawer wrapper ───────────────────────────────────────────────────────────
const EditDrawer = ({
  open,
  title,
  onClose,
  children,
  onSave,
  saving,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
}) => (
  <>
    {/* Backdrop */}
    <div
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      )}
    />
    {/* Panel */}
    <div
      className={cn(
        "fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <X className="h-4 w-4 text-gray-600" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">{children}</div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-6 py-4">
        <Button
          onClick={onSave}
          disabled={saving}
          className="w-full bg-gray-900 hover:bg-gray-800 text-white font-semibold py-3 rounded-xl text-base"
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  </>
);

// ─── Field wrapper ────────────────────────────────────────────────────────────
const Field = ({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) => (
  <div className="space-y-1.5">
    <Label className="text-sm font-semibold text-gray-700">
      {label}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </Label>
    {children}
    {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
  </div>
);

// ─── Section Card ─────────────────────────────────────────────────────────────
const SectionCard = ({
  title,
  icon: Icon,
  accentColor = "teal",
  onEdit,
  children,
}: {
  title: string;
  icon: React.ElementType;
  accentColor?: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
      <div className="flex items-center gap-2">
      <div className={`h-1 w-5 rounded-full`} style={{background:"#1e3a5f"}} />
        <h3 className="font-bold text-gray-800 text-base">{title}</h3>
      </div>
      {onEdit && (
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 text-sm font-semibold transition-colors"
          style={{color:"#1e3a5f"}}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
      )}
    </div>
    <div className="px-6 py-2">{children}</div>
  </div>
);

// ─── Main Page ────────────────────────────────────────────────────────────────
const SettingsPage = () => {
  const { user, profile } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { data: ext } = useStudentProfile();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [activeDrawer, setActiveDrawer] = useState<DrawerSection>(null);

  // Personal info state
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [personalSaving, setPersonalSaving] = useState(false);
  const [rollNumber, setRollNumber] = useState("");
  const [section, setSection] = useState("");
  const [classGrade, setClassGrade] = useState("");

  // Professional info state
  const [mobileNumber, setMobileNumber] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [qualification, setQualification] = useState("");
  const [experience, setExperience] = useState("");
  const [proSaving, setProSaving] = useState(false);

  // Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // Language state
  const [langSaving, setLangSaving] = useState(false);

  const isStudent = profile?.role === "student";
  const isTeacher = !isStudent;

  useEffect(() => {
    if (ext) {
      setAvatarUrl((ext as any).avatar_url ?? "");
      setMobileNumber((ext as any).mobile_number ?? "");
      setEmployeeId((ext as any).employee_id ?? "");
      setDesignation((ext as any).designation ?? "");
      setDepartment((ext as any).department ?? "");
      setQualification((ext as any).qualification ?? "");
      setExperience((ext as any).experience ?? "");
    }
    if (profile?.full_name) setFullName(profile.full_name);
    if ((profile as any)?.roll_number) setRollNumber((profile as any).roll_number ?? "");
    if ((profile as any)?.section) setSection((profile as any).section ?? "");
    if ((profile as any)?.class_grade) setClassGrade((profile as any).class_grade ?? "");
  }, [ext, profile]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["student-profile-extended", user!.id] });

  // Handlers
  const handleUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be under 5MB");
    setUploading(true);
    try {
      const ext2 = file.name.split(".").pop() || "png";
      const path = `${user!.id}/${Date.now()}.${ext2}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
      toast.success("Photo ready — click Save to apply");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handlePersonalSave = async () => {
    if (!fullName.trim()) return toast.error("Name cannot be empty");
    setPersonalSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), avatar_url: avatarUrl || null, ...(isStudent ? { roll_number: rollNumber.trim() || null, section: section.trim() || null, class_grade: classGrade.trim() || null } : {}) } as any)
      .eq("id", user!.id);
    setPersonalSaving(false);
    if (error) toast.error("Failed to save");
    else {
      toast.success("Personal information saved");
      invalidate();
      setActiveDrawer(null);
    }
  };

  const handleProSave = async () => {
    setProSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        mobile_number: mobileNumber.trim() || null,
        employee_id: employeeId.trim() || null,
        designation: designation || null,
        department: department.trim() || null,
        qualification: qualification.trim() || null,
        experience: experience.trim() || null,
      } as any)
      .eq("id", user!.id);
    setProSaving(false);
    if (error) toast.error("Failed to save");
    else {
      toast.success("Professional information saved");
      invalidate();
      setActiveDrawer(null);
    }
  };

  const handlePasswordSave = async () => {
    if (!newPassword || !confirmPassword) return toast.error("Please fill in all fields");
    if (newPassword.length < 6) return toast.error("Password must be at least 6 characters");
    if (newPassword !== confirmPassword) return toast.error("Passwords do not match");
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Password changed successfully");
      setNewPassword("");
      setConfirmPassword("");
      setActiveDrawer(null);
    }
  };

  const handleLanguageSave = async () => {
    setLangSaving(true);
    await setLanguage(language as Language);
    setLangSaving(false);
    toast.success("Language updated");
    setActiveDrawer(null);
  };

  const initials = (profile?.full_name || "U").charAt(0).toUpperCase();

  const designationLabel: Record<string, string> = {
    teacher: "Teacher",
    senior_teacher: "Senior Teacher",
    hod: "Head of Department",
    coordinator: "Coordinator",
    vice_principal: "Vice Principal",
    principal: "Principal",
    admin: "Administrator",
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-300 p-8 relative min-h-[220px]">

          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/80"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>

<div className="hidden md:block">
          <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>
          <div className="max-w-xl">
            <h1 className="text-5xl font-bold text-slate-900">
              {t.settings}
            </h1>

            <p className="mt-3 text-slate-700 text-lg">
              Manage your account and preferences
            </p>
          </div>

          <img
            src={settingsBanner}
            alt="Settings Banner"
            className="hidden md:block absolute right-10 bottom-6 w-32"
          />
        </div>

      <div className="max-w-3xl space-y-5 pb-16">

        {/* ── Profile Hero Card ─────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-navy-800 to-navy-700 relative" style={{background: "linear-gradient(to right, #1e3a5f, #1e4d8c)"}} />
          <div className="px-6 pb-6">
            <div className="flex items-end justify-between -mt-12 mb-4">
              {/* Avatar */}
              <div className="relative">
                <div className="h-24 w-24 rounded-2xl border-4 border-white shadow-md bg-blue-50 overflow-hidden flex items-center justify-center">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-3xl font-bold text-blue-900">{initials}</span>
                  )}
                </div>
                {/* completion ring hint */}
                <div className="absolute -bottom-1 -right-1 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow" style={{background:"#1e3a5f"}}>
                  100%
                </div>
              </div>
              <button
                onClick={() => setActiveDrawer("personal")}
                className="flex items-center gap-1.5 text-sm font-semibold border px-3 py-1.5 rounded-lg transition-all"
                style={{color:"#1e3a5f", borderColor:"#b8cce4"}}
                onMouseEnter={e => (e.currentTarget.style.borderColor="#1e3a5f")}
                onMouseLeave={e => (e.currentTarget.style.borderColor="#b8cce4")}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            </div>

            {/* Name + ID badge */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="text-xl font-bold text-gray-900">{profile?.full_name || "—"}</h2>
              {employeeId && (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border" style={{background:"#eef2f8", color:"#1e3a5f", borderColor:"#b8cce4"}}>
                  <BadgeCheck className="h-3 w-3" />
                  ID: {employeeId}
                </span>
              )}
            </div>

            {/* Info pills row */}
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <Mail className="h-4 w-4 text-gray-400" />
                {user?.email}
              </span>
              <span className="flex items-center gap-1.5 capitalize">
                <User className="h-4 w-4 text-gray-400" />
                {profile?.role}
              </span>
              {mobileNumber && (
                <span className="flex items-center gap-1.5">
                  <Phone className="h-4 w-4 text-gray-400" />
                  {mobileNumber}
                </span>
              )}
              {isStudent && classGrade && (
                <span className="flex items-center gap-1.5">
                  <GraduationCap className="h-4 w-4 text-gray-400" />
                  Class {classGrade}
                </span>
              )}
              {isStudent && section && (
                <span className="flex items-center gap-1.5">
                  <Hash className="h-4 w-4 text-gray-400" />
                  Section {section}
                </span>
              )}
              {isStudent && rollNumber && (
                <span className="flex items-center gap-1.5">
                  <BadgeCheck className="h-4 w-4 text-gray-400" />
                  Roll No: {rollNumber}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Professional Information ──────────────────────── */}
        {isTeacher && (
          <SectionCard
            title="Professional Information"
            icon={Briefcase}
            onEdit={() => setActiveDrawer("professional")}
          >
            <div className="grid sm:grid-cols-2 gap-x-8">
              <InfoRow icon={Phone} label="Mobile Number" value={mobileNumber} />
              <InfoRow icon={Hash} label="Employee ID" value={employeeId} />
              <InfoRow icon={Briefcase} label="Designation" value={designationLabel[designation] || designation} />
              <InfoRow icon={Building2} label="Department" value={department} />
              <InfoRow icon={GraduationCap} label="Qualification" value={qualification} />
              <InfoRow icon={Clock} label="Experience" value={experience} />
            </div>
          </SectionCard>
        )}

        {/* ── Quick Actions ─────────────────────────────────── */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Language */}
          <button
            onClick={() => setActiveDrawer("language")}
            className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 hover:border-blue-900 hover:shadow-md transition-all group text-left"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center" style={{color:"#1e3a5f"}}>
                <Globe className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">Language</p>
                <p className="text-xs text-gray-400 capitalize">{language}</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-900 transition-colors" />
          </button>

          {/* Password */}
          <button
            onClick={() => setActiveDrawer("password")}
            className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 hover:border-blue-900 hover:shadow-md transition-all group text-left"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-500">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">Change Password</p>
                <p className="text-xs text-gray-400">Update your password</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-900 transition-colors" />
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════
          DRAWERS
      ════════════════════════════════════════════════════ */}

      {/* Personal Information Drawer */}
      <EditDrawer
        open={activeDrawer === "personal"}
        title="Personal Information"
        onClose={() => setActiveDrawer(null)}
        onSave={handlePersonalSave}
        saving={personalSaving}
      >
        {/* Avatar upload */}
        <div className="flex flex-col items-center gap-3 pb-2">
          <div className="relative h-24 w-24">
            <div className="h-24 w-24 rounded-2xl bg-blue-50 border-2 overflow-hidden flex items-center justify-center shadow-md" style={{borderColor:"#b8cce4"}}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
              ) : (
                <span className="text-3xl font-bold" style={{color:"#1e3a5f"}}>{initials}</span>
              )}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full text-white flex items-center justify-center shadow-md transition-colors"
              style={{background:"#1e3a5f"}}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="flex gap-2">
            <p className="text-xs text-gray-400">Click the icon to upload a photo</p>
            {avatarUrl && (
              <button onClick={() => setAvatarUrl("")} className="text-xs text-red-500 hover:text-red-700 font-medium">Remove photo</button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
        </div>

        <Field label="Full Name" required>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter your full name"
            className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
          />
        </Field>

        <Field label="Email">
          <Input value={user?.email ?? ""} disabled className="rounded-xl bg-gray-50 text-gray-400" />
        </Field>

        <Field label="Role">
          <Input value={profile?.role ?? ""} disabled className="rounded-xl bg-gray-50 text-gray-400 capitalize" />
        </Field>

        {isStudent && (
          <>
            <Field label="Roll Number">
              <Input
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                placeholder="e.g. 2024001"
                className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
              />
            </Field>
            <Field label="Class">
              <Input
                value={classGrade}
                onChange={(e) => setClassGrade(e.target.value)}
                placeholder="e.g. 10"
                className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
              />
            </Field>
            <Field label="Section">
              <Input
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="e.g. A"
                className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
              />
            </Field>
          </>
        )}
      </EditDrawer>

      {/* Professional Information Drawer */}
      {isTeacher && (
        <EditDrawer
          open={activeDrawer === "professional"}
          title="Professional Information"
          onClose={() => setActiveDrawer(null)}
          onSave={handleProSave}
          saving={proSaving}
        >
          <Field label="Mobile Number" hint="Used for SMS alerts, OTP verification, and urgent communications.">
            <Input
              type="tel"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              placeholder="e.g. +91 98765 43210"
              maxLength={15}
              className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
            />
          </Field>

          <Field label="Employee ID" hint="Unique staff identifier linked to HR and school records.">
            <Input
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="e.g. EMP-2024-001"
              className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
            />
          </Field>

          <Field label="Designation" hint="Indicates your position within the school hierarchy.">
            <Select value={designation || undefined} onValueChange={setDesignation}>
              <SelectTrigger className="rounded-xl border-gray-200 focus:border-blue-900">
                <SelectValue placeholder="Select designation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="teacher">Teacher</SelectItem>
                <SelectItem value="senior_teacher">Senior Teacher</SelectItem>
                <SelectItem value="hod">Head of Department (HOD)</SelectItem>
                <SelectItem value="coordinator">Coordinator</SelectItem>
                <SelectItem value="vice_principal">Vice Principal</SelectItem>
                <SelectItem value="principal">Principal</SelectItem>
                <SelectItem value="admin">Administrator</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Department" hint="Maps to your academic department for analytics and reporting.">
            <Input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Mathematics, Science"
              className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
            />
          </Field>

          <Field label="Qualification" hint="Professional qualifications for HR and accreditation purposes.">
            <Input
              value={qualification}
              onChange={(e) => setQualification(e.target.value)}
              placeholder="e.g. B.Ed, M.Sc, PhD"
              className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
            />
          </Field>

          <Field label="Experience" hint="Helps in teacher profiling and professional development planning.">
            <Input
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              placeholder="e.g. 5 years"
              className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
            />
          </Field>
        </EditDrawer>
      )}

      {/* Password Drawer */}
      <EditDrawer
        open={activeDrawer === "password"}
        title="Change Password"
        onClose={() => setActiveDrawer(null)}
        onSave={handlePasswordSave}
        saving={pwSaving}
      >
        <Field label="New Password" required>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
            className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
          />
        </Field>
        <Field label="Confirm Password" required>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="rounded-xl border-gray-200 focus:border-blue-900 focus:ring-blue-900"
          />
        </Field>
        <p className="text-xs text-gray-400">Password must be at least 6 characters.</p>
      </EditDrawer>

      {/* Language Drawer */}
      <EditDrawer
        open={activeDrawer === "language"}
        title="Language Preference"
        onClose={() => setActiveDrawer(null)}
        onSave={handleLanguageSave}
        saving={langSaving}
      >
        <Field label="Display Language">
          <Select
            value={language}
            onValueChange={(v) => setLanguage(v as Language)}
          >
            <SelectTrigger className="rounded-xl border-gray-200 focus:border-blue-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.nativeLabel} ({lang.label})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-xs text-gray-400">
          This changes the display language across the entire application.
        </p>
      </EditDrawer>
      </div>
    </AppLayout>
  );
};

export default SettingsPage;