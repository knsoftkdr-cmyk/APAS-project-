import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, CircleDot, Gift, GraduationCap, Loader2, Sparkles } from "lucide-react";
import {
  claimCompetencyMission, getCompetencyMissions, CompetencyError, type CompetencyMission, type CompetencyState,
} from "@/lib/competencyMissions";
import { useGamificationTheme } from "@/components/gamification/theme/GamificationTheme";
import { playClaimSound, playLevelUpSound, playClickSound, playErrorSound } from "@/components/gamification/sounds";

// Competency Missions: goals set from the student's real mastery (BKT scores), completed only when the server verifies
// them. Lives inside the existing Gamification > Missions tab; matches that page's dark glass look.

const TIER_LABEL: Record<string, string> = { beginning: "Beginning", developing: "Developing", proficient: "Proficient", mastered: "Mastered" };

function Glass({ children }: { children: React.ReactNode }) {
  const th = useGamificationTheme();
  return <div className="p-4 text-start" style={th.card}>{children}</div>;
}

/** Mastery bar: where you started, where you are, and the goal marker. */
function MasteryBar({ m }: { m: CompetencyMission }) {
  const th = useGamificationTheme();
  const done = m.status === "completed";
  return (
    <div className="mt-3">
      <div className="relative w-full h-2.5 rounded-full" style={{ background: th.barTrack }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(2, Math.min(100, m.current_pct))}%`, background: done ? th.good : th.barFill }} />
        <div className="absolute -top-1 h-4 w-0.5 rounded" style={{ left: `${Math.min(99, m.target_pct)}%`, background: th.warn }} title="Goal" />
      </div>
      <div className="flex justify-between text-[11px] mt-1 tabular-nums" style={{ color: th.cardMuted }}>
        <span>Started {m.start_pct}%</span>
        <span style={{ color: th.cardText }}>Now {m.current_pct}%</span>
        <span style={{ color: th.warn }}>Goal {m.target_pct}%</span>
      </div>
    </div>
  );
}

function Req({ ok, label }: { ok: boolean; label: string }) {
  const th = useGamificationTheme();
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: ok ? th.good : th.cardMuted }}>
      {ok ? <Check className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}{label}
    </span>
  );
}

function CompetencyCard({ m, onClaim, claiming }: { m: CompetencyMission; onClaim: (id: string) => void; claiming: boolean }) {
  const th = useGamificationTheme();
  const r = m.requirements;
  return (
    <Glass>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: th.accent }}>
            {m.kind === "topic_quest" ? "Topic quest" : "Skill level-up"}
            {m.subject ? ` · ${m.subject}` : ""}{m.kind === "level_up" && m.topic_name ? ` · ${m.topic_name}` : ""}
          </p>
          <p className="text-sm font-black mt-0.5" style={{ color: th.cardText }}>{m.title}</p>
          <p className="text-xs mt-0.5" style={{ color: th.cardMuted }}>{m.description}</p>
        </div>
        <span className="shrink-0 text-xs font-black px-2 py-1 rounded-full" style={{ background: `${th.warn}26`, color: th.warn }}>+{m.xp_reward} XP</span>
      </div>

      <MasteryBar m={m} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        <Req ok={m.current_pct >= m.target_pct} label={`Mastery ${m.current_pct}% / ${m.target_pct}%`} />
        <Req ok={r.evidence.have >= r.evidence.need} label={`Answers ${Math.min(r.evidence.have, r.evidence.need)}/${r.evidence.need}`} />
        <Req ok={r.correct.have >= r.correct.need} label={`Correct ${Math.min(r.correct.have, r.correct.need)}/${r.correct.need}`} />
        {r.days.need > 1 && <Req ok={r.days.have >= r.days.need} label={`Days ${Math.min(r.days.have, r.days.need)}/${r.days.need}`} />}
        {r.coverage && <Req ok={r.coverage.have >= r.coverage.need} label={`Skills tried ${Math.min(r.coverage.have, r.coverage.need)}/${r.coverage.need}`} />}
      </div>
      <p className="text-xs mt-2" style={{ color: m.status === "completed" ? th.good : th.cardMuted }}>{m.hint}</p>

      {m.status === "completed" && (
        <button onClick={() => { playClickSound(); onClaim(m.id); }} disabled={claiming}
          className="mt-3 w-full py-2 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] disabled:opacity-60"
          style={{ background: "linear-gradient(135deg,#F59E0B,#F472B6)", color: "#0F172A" }}>
          {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />} Claim mastery reward
        </button>
      )}
    </Glass>
  );
}

/** `onXpChange` lets the page refresh its level / XP header after a reward is paid. */
export function CompetencyMissionsSection({ onXpChange }: { onXpChange?: () => void }) {
  const th = useGamificationTheme();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<CompetencyState, CompetencyError>({
    queryKey: ["competency-missions"],
    queryFn: getCompetencyMissions,
    staleTime: 30_000,
    retry: false,
  });

  const claim = useMutation({
    mutationFn: (id: string) => { setClaimingId(id); return claimCompetencyMission(id); },
    onSuccess: (r) => {
      if (!r.awarded.already_rewarded) { playClaimSound(); if (r.awarded.level_up) setTimeout(playLevelUpSound, 700); }
      setMessage({ ok: true, text: r.awarded.already_rewarded ? "That milestone was already rewarded." : `+${r.awarded.mission_xp} XP for verified mastery!${r.awarded.level_up ? ` Level ${r.awarded.level_up} reached.` : ""}` });
      refetch();
      onXpChange?.();
    },
    onError: (e: CompetencyError) => { playErrorSound(); setMessage({ ok: false, text: e.message }); },
    onSettled: () => setClaimingId(null),
  });

  // Not switched on (migration missing) or nothing to show: stay out of the way of the rest of the Missions tab.
  if (error?.code === "persistence_unavailable") return null;
  if (isLoading) return <Glass><div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" style={{ color: th.cardMuted }} /></div></Glass>;
  if (error) {
    return (
      <Glass>
        <p className="text-sm text-center" style={{ color: th.cardMuted }}>{error.message}</p>
        <button onClick={() => refetch()} className="mt-3 mx-auto block px-4 py-2 rounded-xl text-sm font-bold" style={{ background: `${th.cardText}1A`, color: th.cardText }}>Try again</button>
      </Glass>
    );
  }

  const s = data?.summary;
  const missions = data?.missions ?? [];

  return (
    <section className="space-y-3" aria-label="Competency missions">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black flex items-center gap-1.5" style={{ color: th.text }}>
          <GraduationCap className="h-4 w-4" style={{ color: th.text }} /> Competency missions
        </h3>
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: th.muted }} />}
      </div>

      <Glass>
        <div className="flex items-start gap-2 text-xs" style={{ color: th.cardMuted }}>
          <Sparkles className="h-4 w-4 shrink-0 mt-0.5" style={{ color: th.warn }} />
          <p>
            These reward <b style={{ color: th.cardText }}>real learning</b>, not clicking. They are set from your own mastery scores and finish only when your
            practice, worksheets and tests prove you've got the skill.
            {s && s.assessed > 0 && <> You've been assessed on <b style={{ color: th.cardText }}>{s.assessed}</b> skills: <b style={{ color: th.cardText }}>{s.mastered}</b> mastered, <b style={{ color: th.cardText }}>{s.proficient}</b> proficient.</>}
            {s && s.xp_earned_total > 0 && <> Mastery XP earned so far: <b style={{ color: th.warn }}>{s.xp_earned_total}</b>.</>}
          </p>
        </div>
      </Glass>

      {message && (
        <Glass><p className="text-sm text-center" style={{ color: message.ok ? th.good : th.warn }}>{message.text}</p></Glass>
      )}

      {missions.length === 0 ? (
        <Glass>
          <p className="text-sm text-center" style={{ color: th.cardMuted }}>
            {data?.enrolled === false
              ? "Your student record isn't linked yet, so mastery missions can't be set."
              : "No mastery missions yet. Finish a practice set, worksheet or test and missions will appear here, matched to the skills you're still building."}
          </p>
        </Glass>
      ) : (
        missions.map((m) => <CompetencyCard key={m.id} m={m} onClaim={(id) => claim.mutate(id)} claiming={claimingId === m.id} />)
      )}

      {s && (
        <p className="text-[11px] text-center" style={{ color: th.muted }}>
          Mastery XP today: {s.xp_today} / {s.xp_daily_cap}. Each skill level can be rewarded once, so every reward is a genuine step forward.
        </p>
      )}
    </section>
  );
}
