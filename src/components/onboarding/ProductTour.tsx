import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useStudentProfile, type ProfileExtended } from "@/hooks/useProfileCompletion";
import { GuidedTour } from "./GuidedTour";
import { getTourSteps, resolveSteps, tourRoleFor, type TourStep } from "./tourSteps";
import { START_TOUR_EVENT } from "./tourEvents";

// Completion is stored on the signed-in user's own profiles row (profiles.tour_completed, an existing column
// that the student tour already used), so it follows the user across devices and needs no new table.
// Skip and Finish both mark it done: either way the tour stops opening by itself. The help button in the
// header replays it on demand and never changes the saved value.

interface Props {
  /** Phones: open/close the sidebar drawer so sidebar steps have something to point at. */
  onNeedSidebar?: (open: boolean) => void;
}

/** Wait until the sidebar has rendered (it is empty while permissions load), then give the page a moment to fill in. */
function waitForUi(isCancelled: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (isCancelled()) return resolve(false);
      if (document.querySelector("[data-tour-nav]")) return void setTimeout(() => resolve(!isCancelled()), 900);
      if (Date.now() - startedAt > 10000) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });
}

export function ProductTour({ onNeedSidebar }: Props) {
  const { user, profile } = useAuth();
  const { data: ext } = useStudentProfile();
  const qc = useQueryClient();
  const [steps, setSteps] = useState<TourStep[] | null>(null);

  const tourRole = tourRoleFor(profile?.role);
  const startingRef = useRef(false);
  const unmountedRef = useRef(false);
  const doneFlag = user ? `apas_tour_closed_${user.id}` : "";

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const start = useCallback(async () => {
    if (!tourRole || startingRef.current) return;
    startingRef.current = true;
    try {
      const ready = await waitForUi(() => unmountedRef.current);
      if (!ready) return;
      const list = resolveSteps(getTourSteps(tourRole));
      if (list.length > 0) setSteps(list);
    } finally {
      startingRef.current = false;
    }
  }, [tourRole]);

  // First-time users: open once. Students wait until their profile setup (gender, class, photo) is finished,
  // because that flow shows its own dialogs first.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !user || !tourRole || !ext) return;
    if (ext.tour_completed) return;
    if (tourRole === "student" && !(ext.onboarding_completed && ext.gender && ext.class_grade)) return;
    if (sessionStorage.getItem(doneFlag)) return; // closed already this session (e.g. the save failed): do not nag
    autoStarted.current = true;
    void start();
  }, [user, tourRole, ext, start, doneFlag]);

  // "Take a tour again"
  useEffect(() => {
    if (!tourRole) return;
    const onStart = () => void start();
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, [tourRole, start]);

  const close = useCallback(async () => {
    setSteps(null);
    onNeedSidebar?.(false);
    if (!user) return;
    sessionStorage.setItem(doneFlag, "1");
    if (ext?.tour_completed) return; // a replay: nothing to save

    const { error } = await supabase.from("profiles").update({ tour_completed: true }).eq("id", user.id);
    if (error) {
      console.error("Could not save tour completion:", error);
      toast.error("We could not save your tour progress. It may show again next time you sign in.");
      return;
    }
    qc.setQueryData<ProfileExtended | null>(["student-profile-extended", user.id], (old) =>
      old ? { ...old, tour_completed: true } : old
    );
  }, [user, ext?.tour_completed, onNeedSidebar, qc, doneFlag]);

  if (!steps) return null;
  return <GuidedTour open steps={steps} onFinish={close} onSkip={close} onNeedSidebar={onNeedSidebar} />;
}
