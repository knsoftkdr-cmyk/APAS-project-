/**
 * TeacherProfessionalDevelopment.tsx
 *
 * Section 1 (photo, name, employee ID, designation, department, date of
 * joining) edits the teacher's own `profiles` row directly — those columns
 * already existed (employee_id, designation, department, avatar_url) except
 * date_of_joining, which this feature's migration adds.
 *
 * Sections 2–10 each use the shared TeacherRepeatableList editor.
 */
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useStudentProfile } from "@/hooks/useProfileCompletion";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TeacherRepeatableList } from "@/components/TeacherRepeatableList";
import { GraduationCap, Camera, User } from "lucide-react";
import { format } from "date-fns";

export default function TeacherProfessionalDevelopment() {
  const { user, refreshProfile } = useAuth();
  const { data: profile } = useStudentProfile(); // same cache as Settings.tsx
  const { toast } = useToast();
  const qc = useQueryClient();

  const [fullName, setFullName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name || "");
    setEmployeeId((profile as any).employee_id || "");
    setDesignation((profile as any).designation || "");
    setDepartment((profile as any).department || "");
    setDateOfJoining((profile as any).date_of_joining || "");
    setAvatarUrl((profile as any).avatar_url || "");
  }, [profile]);

  const handlePhotoUpload = async (file: File | null) => {
    if (!file || !user?.id) return;
    if (file.size > 5 * 1024 * 1024) { toast({ title: "Image must be under 5MB", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
      toast({ title: "Photo ready — click Save to apply" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          employee_id: employeeId.trim() || null,
          designation: designation.trim() || null,
          department: department.trim() || null,
          date_of_joining: dateOfJoining || null,
          avatar_url: avatarUrl || null,
        })
        .eq("id", user.id);
      if (error) throw error;
      toast({ title: "Profile updated" });
      qc.invalidateQueries({ queryKey: ["student-profile-extended", user.id] });
      await refreshProfile();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 pb-10">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Professional Development</h1>
            <p className="text-sm text-muted-foreground">Your teaching profile, qualifications, and career record</p>
          </div>
        </div>

        {/* ── Section 1: Teacher Profile ─────────────────────────────────── */}
        <Card className="border border-border/60">
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-semibold">Teacher Profile</h3>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={avatarUrl} />
                  <AvatarFallback><User className="h-8 w-8" /></AvatarFallback>
                </Avatar>
                <label className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer">
                  <Camera className="h-3.5 w-3.5" />
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoUpload(e.target.files?.[0] || null)} />
                </label>
              </div>
              {uploading && <p className="text-xs text-muted-foreground">Uploading photo...</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Employee ID</label>
                <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Designation</label>
                <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. PGT Mathematics" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Department</label>
                <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Science Department" className="mt-1" />
              </div>
              <div data-vaul-no-drag>
                <label className="text-xs font-medium text-muted-foreground">Date of Joining</label>
                <Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} className="mt-1" />
              </div>
            </div>

            <Button onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save Profile"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Sections 2–10 ──────────────────────────────────────────────── */}
        <Tabs defaultValue="qualifications" className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
            <TabsTrigger value="certifications">Certifications</TabsTrigger>
            <TabsTrigger value="experience">Experience</TabsTrigger>
            <TabsTrigger value="expertise">Subject Expertise</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="skills">Digital Skills</TabsTrigger>
            <TabsTrigger value="goals">Career Goals</TabsTrigger>
            <TabsTrigger value="publications">Publications</TabsTrigger>
            <TabsTrigger value="awards">Awards</TabsTrigger>
            <TabsTrigger value="languages">Languages</TabsTrigger>
          </TabsList>

          <TabsContent value="qualifications">
            <TeacherRepeatableList
              title="Qualifications"
              emptyText="No qualifications added yet."
              tableName="teacher_qualifications"
              fields={[
                { key: "degree", label: "Degree", type: "text", placeholder: "e.g. B.Ed, M.Sc Mathematics" },
                { key: "institution", label: "Institution", type: "text" },
                { key: "year_of_completion", label: "Year of Completion", type: "text", placeholder: "e.g. 2018" },
              ]}
              renderRow={(r) => ({ primary: r.degree, secondary: r.institution, meta: r.year_of_completion })}
            />
          </TabsContent>

          <TabsContent value="certifications">
            <TeacherRepeatableList
              title="Certifications"
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
          </TabsContent>

          <TabsContent value="experience">
            <TeacherRepeatableList
              title="Teaching Experience"
              emptyText="No previous experience added yet."
              tableName="teacher_experience"
              fields={[
                { key: "previous_school", label: "Previous School", type: "text" },
                { key: "position", label: "Position", type: "text", placeholder: "e.g. TGT Science" },
                { key: "years_of_experience", label: "Years of Experience", type: "text", placeholder: "e.g. 3 years" },
              ]}
              renderRow={(r) => ({ primary: r.previous_school, secondary: r.position, meta: r.years_of_experience })}
            />
          </TabsContent>

          <TabsContent value="expertise">
            <TeacherRepeatableList
              title="Subject Expertise"
              emptyText="No subjects added yet."
              tableName="teacher_subject_expertise"
              fields={[{ key: "subject", label: "Subject", type: "text", placeholder: "e.g. Mathematics" }]}
              renderRow={(r) => ({ primary: r.subject })}
            />
          </TabsContent>

          <TabsContent value="training">
            <TeacherRepeatableList
              title="Training History"
              emptyText="No trainings recorded yet."
              tableName="teacher_training_history"
              fields={[
                { key: "training_name", label: "Training Name", type: "text", placeholder: "e.g. AI in Education" },
                { key: "completed_date", label: "Completed On", type: "date" },
              ]}
              renderRow={(r) => ({ primary: r.training_name, meta: r.completed_date ? format(new Date(r.completed_date), "d MMM yyyy") : undefined })}
            />
          </TabsContent>

          <TabsContent value="skills">
            <TeacherRepeatableList
              title="Digital Skills"
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
          </TabsContent>

          <TabsContent value="goals">
            <TeacherRepeatableList
              title="Career Goals"
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
          </TabsContent>

          <TabsContent value="publications">
            <TeacherRepeatableList
              title="Research Publications"
              emptyText="No publications added yet."
              tableName="teacher_publications"
              fields={[
                { key: "title", label: "Title", type: "text" },
                { key: "journal", label: "Journal", type: "text" },
                { key: "year", label: "Year", type: "text", placeholder: "e.g. 2025" },
              ]}
              renderRow={(r) => ({ primary: r.title, secondary: r.journal, meta: r.year })}
            />
          </TabsContent>

          <TabsContent value="awards">
            <TeacherRepeatableList
              title="Awards & Recognition"
              emptyText="No awards added yet."
              tableName="teacher_awards"
              fields={[
                { key: "title", label: "Award Title", type: "text", placeholder: "e.g. Best Teacher Award" },
                { key: "year", label: "Year", type: "text" },
                { key: "certificate_url", label: "Certificate Upload (optional)", type: "file", bucket: "teacher-certificates" },
              ]}
              renderRow={(r) => ({ primary: `🏆 ${r.title}`, meta: r.year, fileUrl: r.certificate_url })}
            />
          </TabsContent>

          <TabsContent value="languages">
            <TeacherRepeatableList
              title="Languages Known"
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
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}