import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { User, Lock, Loader2, Globe, Image as ImageIcon, Upload } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { languages, Language } from "@/i18n/translations";
import { useStudentProfile } from "@/hooks/useProfileCompletion";
import { useQueryClient } from "@tanstack/react-query";
import { AVATAR_PRESETS, type Gender } from "@/components/onboarding/avatars";
import { cn } from "@/lib/utils";

const SettingsPage = () => {
  const { user, profile } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { data: ext } = useStudentProfile();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [nameSaving, setNameSaving] = useState(false);

  const [gender, setGender] = useState<string>("");
  const [classGrade, setClassGrade] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // Hydrate from extended profile once it loads
  useEffect(() => {
    if (ext) {
      setGender(ext.gender ?? "");
      setClassGrade(ext.class_grade ?? "");
      setSchoolName(ext.school_name ?? "");
      setAvatarUrl(ext.avatar_url ?? "");
    }
  }, [ext]);

  const isStudent = profile?.role === "student";

  const handleNameUpdate = async () => {
    if (!fullName.trim()) return toast.error("Name cannot be empty");
    setNameSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: fullName.trim() }).eq("id", user!.id);
    setNameSaving(false);
    if (error) toast.error("Failed to update name");
    else {
      toast.success("Name updated successfully");
      qc.invalidateQueries({ queryKey: ["student-profile-extended", user!.id] });
    }
  };

  const handleProfileSave = async () => {
    setProfileSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        gender: gender || null,
        class_grade: classGrade.trim() || null,
        school_name: schoolName.trim() || null,
        avatar_url: avatarUrl || null,
      })
      .eq("id", user!.id);
    setProfileSaving(false);
    if (error) toast.error("Failed to save profile");
    else {
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["student-profile-extended", user!.id] });
    }
  };

  const handleUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be under 5MB");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user!.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
      toast.success("Photo uploaded — click Save to apply");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!newPassword || !confirmPassword) return toast.error("Please fill in all password fields");
    if (newPassword.length < 6) return toast.error("Password must be at least 6 characters");
    if (newPassword !== confirmPassword) return toast.error("New passwords do not match");
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Password changed successfully");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  const handleLanguageChange = async (lang: string) => {
    await setLanguage(lang as Language);
    toast.success("Language updated");
  };

  const presets = AVATAR_PRESETS[(gender as Gender) || "prefer_not_to_say"];

  return (
    <AppLayout>
      <PageHeader title={t.settings} subtitle={t.updateDisplayName} />

      <div className="grid gap-6 max-w-2xl">
        {/* Profile Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="h-5 w-5" /> {t.profileInformation}
            </CardTitle>
            <CardDescription>{t.updateDisplayName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t.email}</Label>
              <Input value={user?.email ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>{t.role}</Label>
              <Input value={profile?.role ?? ""} disabled className="capitalize" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">{t.fullName}</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your name"
              />
            </div>
            <Button onClick={handleNameUpdate} disabled={nameSaving}>
              {nameSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t.saveName}
            </Button>
          </CardContent>
        </Card>

        {/* Student profile completion */}
        {isStudent && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ImageIcon className="h-5 w-5" /> Profile details
              </CardTitle>
              <CardDescription>Complete your profile for a personalized experience.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Gender */}
              <div className="space-y-2">
                <Label>Gender</Label>
                <Select value={gender || undefined} onValueChange={setGender}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Class / School */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="classGrade">Class / Grade</Label>
                  <Input
                    id="classGrade"
                    value={classGrade}
                    onChange={(e) => setClassGrade(e.target.value)}
                    placeholder="e.g. Class 5"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schoolName">School</Label>
                  <Input
                    id="schoolName"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="School name"
                  />
                </div>
              </div>

              {/* Avatar */}
              <div className="space-y-2">
                <Label>Profile picture</Label>
                <div className="grid grid-cols-4 gap-3">
                  {presets.map((p) => {
                    const isSel = avatarUrl === p.src;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setAvatarUrl(p.src)}
                        className={cn(
                          "aspect-square rounded-xl border-2 bg-muted/30 p-1 transition-all",
                          isSel ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
                        )}
                      >
                        <img src={p.src} alt="" className="h-full w-full object-contain" loading="lazy" />
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-all",
                      avatarUrl && !presets.some((p) => p.src === avatarUrl)
                        ? "border-primary bg-primary/5"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
                    )}
                  >
                    {uploading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : avatarUrl && !presets.some((p) => p.src === avatarUrl) ? (
                      <img src={avatarUrl} alt="" className="h-full w-full rounded-lg object-cover" />
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        <span className="text-[10px] font-medium">Upload</span>
                      </>
                    )}
                  </button>
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

              <Button onClick={handleProfileSave} disabled={profileSaving}>
                {profileSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save profile
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Language */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-5 w-5" /> {t.language}
            </CardTitle>
            <CardDescription>{t.selectLanguage}</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={language} onValueChange={handleLanguageChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map(lang => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.nativeLabel} ({lang.label})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lock className="h-5 w-5" /> {t.changePassword}
            </CardTitle>
            <CardDescription>{t.updatePassword}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t.newPassword}</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t.confirmPassword}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
            <Button onClick={handlePasswordChange} disabled={pwSaving}>
              {pwSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t.changePassword}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default SettingsPage;
