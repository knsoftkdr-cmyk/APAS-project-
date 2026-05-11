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

type OnboardingStep = "gender" | "avatar" | "tour" | "done";

function resolveInitialStep(extProfile: any): OnboardingStep {
  if (!extProfile.gender) return "gender";
  if (!extProfile.avatar_url && !extProfile.onboarding_completed) return "avatar";
  if (!extProfile.tour_completed && extProfile.onboarding_completed) return "tour";
  return "done";
}

export function OnboardingFlow() {
  const { user, profile } = useAuth();
  const { data: extProfile, isLoading } = useStudentProfile();
  const qc = useQueryClient();

  // Local step state — drives modal visibility instantly (no waiting for DB refetch)
  const [step, setStep] = useState<OnboardingStep | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);

  // Set initial step once profile loads (only once)
  useEffect(() => {
    if (extProfile && step === null) {
      const initial = resolveInitialStep(extProfile);
      setStep(initial);
      if (extProfile.gender) {
        setGender(extProfile.gender as Gender);
      }
    }
  }, [extProfile, step]);

  const isStudent = profile?.role === "student";

  if (!isStudent || isLoading || !extProfile || !user || step === null || step === "done") {
    return null;
  }

  const refresh = async () => {
    await qc.refetchQueries({ queryKey: ["student-profile-extended", user.id] });
  };

  const saveGender = async (selectedGender: Gender) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ gender: selectedGender })
        .eq("id", user.id);
      if (error) throw error;

      // ✅ Advance step locally IMMEDIATELY — don't wait for DB refetch
      setGender(selectedGender);
      setStep("avatar");
      toast.success("Saved");

      // Refetch in background to sync cache
      refresh().catch(console.error);
    } catch (err: any) {
      console.error("Save gender error:", err);
      toast.error(err?.message || "Failed to save");
      // Do NOT advance step on error — user stays on gender modal
    }
  };

  const saveAvatar = async (avatar_url: string) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url, onboarding_completed: true })
        .eq("id", user.id);
      if (error) throw error;

      // ✅ Advance immediately
      setStep("tour");
      toast.success("Profile picture saved");

      refresh().catch(console.error);
    } catch (err: any) {
      console.error("Save avatar error:", err);
      toast.error(err?.message || "Failed to save avatar");
    }
  };

  const skipAvatar = async () => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ onboarding_completed: true })
        .eq("id", user.id);
      if (error) throw error;

      // ✅ Advance immediately
      setStep("tour");

      refresh().catch(console.error);
    } catch (err: any) {
      console.error("Skip avatar error:", err);
      toast.error(err?.message || "Failed to skip");
    }
  };

  const finishTour = async () => {
    // ✅ Close tour immediately
    setStep("done");

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ tour_completed: true })
        .eq("id", user.id);
      if (error) throw error;

      refresh().catch(console.error);
    } catch (err: any) {
      console.error("Finish tour error:", err);
      toast.error(err?.message || "Failed to finish tour");
    }
  };

  return (
    <>
      <GenderStep
        open={step === "gender"}
        onSave={saveGender}
      />
      <AvatarStep
        open={step === "avatar"}
        gender={gender || "prefer_not_to_say"}
        userId={user.id}
        onSave={saveAvatar}
        onSkip={skipAvatar}
      />
      <GuidedTour
        open={step === "tour"}
        onFinish={finishTour}
        onSkip={finishTour}
      />
    </>
  );
}