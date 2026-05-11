import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useStudentProfile } from "@/hooks/useProfileCompletion";
import { GenderStep } from "./GenderStep";
import { AvatarStep } from "./AvatarStep";
import { GuidedTour } from "./GuidedTour";
import type { Gender } from "./avatars";
import { toast } from "sonner";

export function OnboardingFlow() {
  const { user, profile } = useAuth();
  const { data: extProfile, isLoading } = useStudentProfile();
  const qc = useQueryClient();
  const [tourOpen, setTourOpen] = useState(false);

  // Only run for students
  if (profile?.role !== "student") return null;
  if (isLoading || !extProfile || !user) return null;

  const needsGender = !extProfile.gender;
  const needsAvatar = !needsGender && !extProfile.avatar_url && !extProfile.onboarding_completed;
  const needsTour = !needsGender && !needsAvatar && !extProfile.tour_completed && extProfile.onboarding_completed;

  // Auto-open tour once onboarding is done
  useEffect(() => {
    if (needsTour) {
      const t = setTimeout(() => setTourOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, [needsTour]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["student-profile-extended", user.id] });

  const saveGender = async (gender: Gender) => {
    const { error } = await supabase.from("profiles").update({ gender }).eq("id", user.id);
    if (error) {
      toast.error("Failed to save");
      return;
    }
    toast.success("Saved");
    await refresh();
  };

  const saveAvatar = async (avatar_url: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url, onboarding_completed: true })
      .eq("id", user.id);
    if (error) {
      toast.error("Failed to save avatar");
      return;
    }
    toast.success("Profile picture saved");
    await refresh();
  };

  const skipAvatar = async () => {
    await supabase.from("profiles").update({ onboarding_completed: true }).eq("id", user.id);
    await refresh();
  };

  const finishTour = async () => {
    setTourOpen(false);
    await supabase.from("profiles").update({ tour_completed: true }).eq("id", user.id);
    await refresh();
  };

  return (
    <>
      <GenderStep open={needsGender} onSave={saveGender} />
      <AvatarStep
        open={needsAvatar}
        gender={(extProfile.gender as Gender) || "prefer_not_to_say"}
        userId={user.id}
        onSave={saveAvatar}
        onSkip={skipAvatar}
      />
      <GuidedTour open={tourOpen} onFinish={finishTour} onSkip={finishTour} />
    </>
  );
}
