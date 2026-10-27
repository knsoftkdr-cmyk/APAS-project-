// Pushes drafts that were saved offline (and whose form is no longer open) once the connection returns.
// Safe by construction: the RPC never overwrites a newer server draft, and a conflict is simply left alone.
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { listUnsyncedDrafts, readLocalDraft, writeLocalDraft } from "@/lib/drafts/draftStorage";
import { purgeExpiredServerDrafts, saveServerDraft } from "@/lib/drafts/draftApi";

export function useDraftBackgroundSync() {
  const { user } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const run = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      for (const env of listUnsyncedDrafts(userId)) {
        if (cancelled) return;
        const res = await saveServerDraft({ formType: env.formType, recordKey: env.recordKey, payload: env.payload, baseHash: env.baseHash, clientUpdatedMs: env.updatedAt });
        if (res.status === "saved") {
          const cur = readLocalDraft(userId, env.formType, env.recordKey);
          if (cur && cur.updatedAt === env.updatedAt) writeLocalDraft({ ...cur, syncedAt: env.updatedAt });
        }
        if (res.status === "unavailable" || res.status === "network") return;
      }
    };
    void run();
    void purgeExpiredServerDrafts(userId);
    window.addEventListener("online", run);
    return () => { cancelled = true; window.removeEventListener("online", run); };
  }, [userId]);
}
