import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import settingsBanner from "@/assets/settings-banner.png";
import { TeacherRepeatableList } from "@/components/TeacherRepeatableList";
import { format } from "date-fns";
import {
  GraduationCap as GradIcon, Award, Languages as LangIcon, Target,
  BookOpen, Laptop, FileBadge, Briefcase as BriefIcon,
} from "lucide-react";
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
  GraduationCap, Trophy,
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
    <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl shrink-0 shadow-sm" style={{background:"linear-gradient(135deg, #eef2f8, #dbe6f4)", color:"#1e3a5f"}}>
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
import { createPortal } from "react-dom";

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
}) => {
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 overscroll-contain",
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
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-blue-50/60 to-white">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <X className="h-4 w-4 text-gray-600" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 pb-24 md:pb-5 space-y-5">
          {children}
        </div>

        <div className="border-t border-gray-100 px-6 py-4 pb-20 md:pb-4 bg-white">
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
    </>,
    document.body
  );
};

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
<div className="bg-white rounded-2xl border border-gray-100 shadow-md shadow-gray-200/50 overflow-hidden transition-shadow hover:shadow-lg hover:shadow-gray-200/60">
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50/80 to-white">
      <div className="flex items-center gap-2.5">
      <div className={`h-6 w-1.5 rounded-full`} style={{background:"linear-gradient(to bottom, #1e3a5f, #3b82c4)"}} />
        <h3 className="font-bold text-gray-800 text-base">{title}</h3>
      </div>
      {onEdit && (
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 text-sm font-semibold transition-colors px-2.5 py-1 rounded-lg hover:bg-blue-50"
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

  useEffect(() => {
    if (activeDrawer) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = original; };
    }
  }, [activeDrawer]);

  // Personal info state
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [personalSaving, setPersonalSaving] = useState(false);
  const [rollNumber, setRollNumber] = useState("");
  const [section, setSection] = useState("");
  const [classGrade, setClassGrade] = useState("");
  const [houseInfo, setHouseInfo] = useState<{ name: string; color: string } | null>(null);
  const [houseLoading, setHouseLoading] = useState(true);

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
const isTeacher = profile?.role === "teacher";

  useEffect(() => {
    const fetchHouse = async () => {
      if (profile?.role !== "student" || !profile?.id) { setHouseLoading(false); return; }
      const { data: studentRow } = await supabase
        .from("students")
        .select("house_id")
        .eq("profile_id", profile.id)
        .maybeSingle();
      if (studentRow?.house_id) {
        const { data: houseRow } = await supabase
          .from("houses")
          .select("name, color")
          .eq("id", studentRow.house_id)
          .maybeSingle();
        if (houseRow) setHouseInfo({ name: houseRow.name, color: houseRow.color });
      }
      setHouseLoading(false);
    };
    fetchHouse();
  }, [profile?.id, profile?.role]);

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
      await refreshProfile();
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
      invalidate();
      await refreshProfile();
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

      try {
        const dateTime = new Date().toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        });
        await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "single_by_user_id",
              payload: {
                user_id: user!.id,
                title: "Password Changed",
                body: `Your password was changed successfully on ${dateTime}.`,
                data: { type: "password_changed" },
              },
            }),
          }
        );
      } catch (notifError) {
        console.error("Password change notification failed:", notifError);
      }
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
const [activeCareerTab, setActiveCareerTab] = useState("qualifications");
const careerTabs = [
  {
    id: "qualifications",
    label: "Qualifications",
    content: (
      <TeacherRepeatableList
        title="Qualifications"
        icon={GradIcon}
        emptyText="No qualifications added yet."
        tableName="teacher_qualifications"
        fields={[
          { key: "degree", label: "Degree", type: "text", placeholder: "e.g. B.Ed, M.Sc Mathematics" },
          { key: "institution", label: "Institution", type: "text" },
          { key: "year_of_completion", label: "Year of Completion", type: "text", placeholder: "e.g. 2018" },
        ]}
        renderRow={(r) => ({ primary: r.degree, secondary: r.institution, meta: r.year_of_completion })}
      />
    ),
  },
  {
    id: "certifications",
    label: "Certifications",
    content: (
      <TeacherRepeatableList
        title="Certifications"
        icon={FileBadge}
        emptyText="No certifications added yet."
        tableName="teacher_certifications"
        fields={[
          { key: "certificate_name", label: "Certificate Name", type: "text" },
          { key: "issuing_organization", label: "Issuing Organization", type: "text" },
          { key: "issue_date", label: "Issue Date", type: "date" },
          { key: "certificate_url", label: "Certificate Upload", type: "file", bucket: "teacher-certificates" },
        ]}
        renderRow={(r) => ({
          primary: r.certificate_name,
          secondary: r.issuing_organization,
          meta: r.issue_date ? format(new Date(r.issue_date), "d MMM yyyy") : undefined,
          fileUrl: r.certificate_url,
        })}
      />
    ),
  },
  {
    id: "experience",
    label: "Experience",
    content: (
      <TeacherRepeatableList
        title="Teaching Experience"
        icon={BriefIcon}
        emptyText="No previous experience added yet."
        tableName="teacher_experience"
        fields={[
          { key: "previous_school", label: "Previous School", type: "text" },
          { key: "position", label: "Position", type: "text", placeholder: "e.g. TGT Science" },
          { key: "years_of_experience", label: "Years of Experience", type: "text", placeholder: "e.g. 3 years" },
        ]}
        renderRow={(r) => ({ primary: r.previous_school, secondary: r.position, meta: r.years_of_experience })}
      />
    ),
  },
  {
    id: "expertise",
    label: "Subject Expertise",
    content: (
      <TeacherRepeatableList
        title="Subject Expertise"
        icon={BookOpen}
        emptyText="No subjects added yet."
        tableName="teacher_subject_expertise"
        fields={[{ key: "subject", label: "Subject", type: "text", placeholder: "e.g. Mathematics" }]}
        renderRow={(r) => ({ primary: r.subject })}
      />
    ),
  },
  {
    id: "training",
    label: "Training",
    content: (
      <TeacherRepeatableList
        title="Training History"
        icon={GradIcon}
        emptyText="No trainings recorded yet."
        tableName="teacher_training_history"
        fields={[
          { key: "training_name", label: "Training Name", type: "text", placeholder: "e.g. AI in Education" },
          { key: "completed_date", label: "Completed On", type: "date" },
        ]}
        renderRow={(r) => ({ primary: r.training_name, meta: r.completed_date ? format(new Date(r.completed_date), "d MMM yyyy") : undefined })}
      />
    ),
  },
  {
    id: "skills",
    label: "Digital Skills",
    content: (
      <TeacherRepeatableList
        title="Digital Skills"
        icon={Laptop}
        emptyText="No digital skills added yet."
        tableName="teacher_digital_skills"
        fields={[
          { key: "skill_name", label: "Skill", type: "text", placeholder: "e.g. Google Classroom, Canva, Smart Board" },
          {
            key: "proficiency", label: "Proficiency", type: "select",
            options: [
              { value: "beginner", label: "Beginner" },
              { value: "intermediate", label: "Intermediate" },
              { value: "advanced", label: "Advanced" },
            ],
          },
        ]}
        renderRow={(r) => ({ primary: r.skill_name, meta: r.proficiency })}
      />
    ),
  },
  {
    id: "goals",
    label: "Career Goals",
    content: (
      <TeacherRepeatableList
        title="Career Goals"
        icon={Target}
        emptyText="No career goals added yet."
        tableName="teacher_career_goals"
        fields={[
          { key: "goal", label: "Goal", type: "text", placeholder: "e.g. Complete AI Certification" },
          {
            key: "status", label: "Status", type: "select",
            options: [
              { value: "in_progress", label: "In Progress" },
              { value: "achieved", label: "Achieved" },
            ],
          },
        ]}
        renderRow={(r) => ({ primary: r.goal, meta: r.status === "achieved" ? "✓ Achieved" : "In Progress" })}
      />
    ),
  },
  {
    id: "publications",
    label: "Publications",
    content: (
      <TeacherRepeatableList
        title="Research Publications"
        icon={BookOpen}
        emptyText="No publications added yet."
        tableName="teacher_publications"
        fields={[
          { key: "title", label: "Title", type: "text" },
          { key: "journal", label: "Journal", type: "text" },
          { key: "year", label: "Year", type: "text", placeholder: "e.g. 2025" },
        ]}
        renderRow={(r) => ({ primary: r.title, secondary: r.journal, meta: r.year })}
      />
    ),
  },
  {
    id: "awards",
    label: "Awards",
    content: (
      <TeacherRepeatableList
        title="Awards & Recognition"
        icon={Award}
        emptyText="No awards added yet."
        tableName="teacher_awards"
        fields={[
          { key: "title", label: "Award Title", type: "text", placeholder: "e.g. Best Teacher Award" },
          { key: "year", label: "Year", type: "text" },
          { key: "certificate_url", label: "Certificate Upload (optional)", type: "file", bucket: "teacher-certificates" },
        ]}
        renderRow={(r) => ({ primary: `🏆 ${r.title}`, meta: r.year, fileUrl: r.certificate_url })}
      />
    ),
  },
  {
    id: "languages",
    label: "Languages",
    content: (
      <TeacherRepeatableList
        title="Languages Known"
        icon={LangIcon}
        emptyText="No languages added yet."
        tableName="teacher_languages"
        fields={[
          { key: "language", label: "Language", type: "text", placeholder: "e.g. English, Telugu, Hindi" },
          { key: "can_read", label: "Can Read", type: "checkbox" },
          { key: "can_write", label: "Can Write", type: "checkbox" },
          { key: "can_speak", label: "Can Speak", type: "checkbox" },
        ]}
        renderRow={(r) => ({
          primary: r.language,
          meta: [r.can_read && "Read", r.can_write && "Write", r.can_speak && "Speak"].filter(Boolean).join(" · "),
        })}
      />
    ),
  },
];
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-300 to-blue-300 p-8 relative min-h-[220px] shadow-lg shadow-blue-200/50">

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

      <div className="w-full max-w-7xl space-y-5 pb-16">

        {/* ── Profile Hero Card ─────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-md shadow-gray-200/60 overflow-hidden">
          <div className="h-28 relative" style={{background: "linear-gradient(120deg, #1e3a5f 0%, #2563a8 55%, #3b82c4 100%)"}}>
            <div className="absolute top-4 right-8 w-10 h-10 rounded-full border border-white/25"></div>
            <div className="absolute bottom-4 right-24 w-6 h-6 rounded-full border border-white/25"></div>
          </div>
          <div className="px-6 pb-6">
            <div className="flex items-end justify-between -mt-14 mb-4">
              {/* Avatar */}
              <div className="relative">
                <div className="h-28 w-28 rounded-2xl p-1 shadow-lg" style={{background: "linear-gradient(135deg, #1e3a5f, #3b82c4)"}}>
                  <div className="h-full w-full rounded-xl border-2 border-white bg-blue-50 overflow-hidden flex items-center justify-center">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-3xl font-bold text-blue-900">{initials}</span>
                    )}
                  </div>
                </div>
                {/* completion ring hint */}
                <div className="absolute -bottom-1.5 -right-1.5 text-white text-[9px] font-bold px-2 py-1 rounded-full shadow-md border-2 border-white" style={{background:"#1e3a5f"}}>
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
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border shadow-sm" style={{background:"linear-gradient(120deg, #eef2f8, #e0eaf6)", color:"#1e3a5f", borderColor:"#b8cce4"}}>
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
              {isStudent && !houseLoading && houseInfo && (
                <span className="flex items-center gap-1.5">
                  <Trophy className="h-4 w-4" style={{ color: houseInfo.color }} />
                  House: {houseInfo.name}
                </span>
              )}
              {isStudent && !houseLoading && !houseInfo && (
                <span className="flex items-center gap-1.5 text-gray-400">
                  <Trophy className="h-4 w-4 text-gray-300" />
                  House not assigned
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
            className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-md shadow-gray-200/50 px-5 py-4 hover:border-blue-200 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group text-left"
          >
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl flex items-center justify-center text-white shadow-sm" style={{background:"linear-gradient(135deg, #1e3a5f, #3b82c4)"}}>
                <Globe className="h-5.5 w-5.5" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">Language</p>
                <p className="text-xs text-gray-400 capitalize">{language}</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-900 group-hover:translate-x-0.5 transition-all" />
          </button>

          {/* Password */}
          <button
            onClick={() => setActiveDrawer("password")}
            className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-md shadow-gray-200/50 px-5 py-4 hover:border-orange-200 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group text-left"
          >
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl flex items-center justify-center text-white shadow-sm" style={{background:"linear-gradient(135deg, #f97316, #fb923c)"}}>
                <Lock className="h-5.5 w-5.5" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">Change Password</p>
                <p className="text-xs text-gray-400">Update your password</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
          </button>
        </div>

{isTeacher && (
  <div className="pt-2">
    <div className="flex items-center gap-2.5 mb-4">
      <div className="h-6 w-1.5 rounded-full" style={{ background: "linear-gradient(to bottom, #1e3a5f, #3b82c4)" }} />
      <h2 className="text-lg font-bold text-gray-900">Career & Professional Development</h2>
    </div>

    {/* Tab bar */}
    <div className="bg-gray-50/80 rounded-2xl p-2 mb-0 overflow-x-auto scrollbar-hide">
      <div className="flex gap-1.5 w-max">
        {careerTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveCareerTab(tab.id)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap",
              activeCareerTab === tab.id
                ? "text-white shadow-md"
                : "text-gray-500 hover:text-gray-800 hover:bg-white"
            )}
            style={
              activeCareerTab === tab.id
                ? { background: "linear-gradient(120deg, #1e3a5f, #3b82c4)" }
                : undefined
            }
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>

    {/* Accent underline */}
    <div className="h-1 rounded-full my-3" style={{ background: "linear-gradient(90deg, #1e3a5f, #3b82c4)" }} />

    {/* Active panel */}
    <div className="bg-white rounded-2xl border border-gray-100 shadow-md shadow-gray-200/50 overflow-hidden">
      {careerTabs.find((t) => t.id === activeCareerTab)?.content}
    </div>
  </div>
)}
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
            <div className="h-24 w-24 rounded-2xl p-1 shadow-md" style={{background: "linear-gradient(135deg, #1e3a5f, #3b82c4)"}}>
              <div className="h-full w-full rounded-xl bg-blue-50 border-2 border-white overflow-hidden flex items-center justify-center">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold" style={{color:"#1e3a5f"}}>{initials}</span>
                )}
              </div>
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