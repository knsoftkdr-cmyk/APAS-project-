import { Flame, Snowflake, Loader2, Check, Gift, Target } from "lucide-react";
import type { G2Awarded, G2Badge, G2Mission, G2State } from "@/lib/gamification2";

// Gamification 2.0 panels for the existing Gamification page (no new route, no new sidebar entry).
// Styled to match that page's dark glass look.

export type HubTab = "play" | "missions" | "badges" | "progress";

const TXT = "#F1F5F9";
const MUTED = "rgba(241,245,249,0.55)";

function Glass({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-4 text-left ${className}`}
      style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)" }}>
      {children}
    </div>
  );
}

function Bar({ pct, color = "linear-gradient(90deg,#6366F1,#A855F7,#F472B6)" }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-2 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

const BADGE_EMOJI: Record<string, string> = {
  gamepad: "🎮", target: "🎯", flame: "🔥", flag: "🚩", rocket: "🚀", trophy: "🏆", "trending-up": "📈", compass: "🧭",
};
const CATEGORY_LABEL: Record<string, string> = {
  g2_rounds: "Rounds", g2_accuracy: "Accuracy", g2_streak: "Streaks", g2_missions: "Missions", g2_adaptive: "Made for you",
};
const TIER = ["Bronze", "Silver", "Gold"];

/* ── header: streak + level, always visible above the tabs ───────────────────────────────────────── */

export function Gamification2Header({ state }: { state: G2State | null }) {
  if (!state) return null;
  const { streak, progression: p } = state;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Glass>
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5" style={{ color: streak.current > 0 ? "#F59E0B" : MUTED }} />
          <span className="text-2xl font-black tabular-nums" style={{ color: TXT }}>{streak.current}</span>
          <span className="text-xs font-medium" style={{ color: MUTED }}>day streak</span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: MUTED }}>
          <Snowflake className="h-3.5 w-3.5" style={{ color: "#38BDF8" }} />
          <span>{streak.freezes} freeze{streak.freezes === 1 ? "" : "s"}</span>
          {streak.at_risk && <span className="font-bold" style={{ color: "#F59E0B" }}>· play today to keep it</span>}
          {streak.played_today && <span className="font-bold" style={{ color: "#22C55E" }}>· done today</span>}
        </div>
      </Glass>
      <Glass>
        <div className="flex items-center justify-between">
          <span className="text-sm font-black" style={{ color: TXT }}>{p.emoji} Lv {p.level} · {p.title}</span>
          <span className="text-xs tabular-nums" style={{ color: MUTED }}>{p.xp_to_next_level} XP to go</span>
        </div>
        <div className="mt-2"><Bar pct={p.level_progress_pct} /></div>
      </Glass>
    </div>
  );
}

/* ── tab strip ─────────────────────────────────────────────────────────────────────────────────── */

export function Gamification2Tabs({ tab, onChange, claimable }: { tab: HubTab; onChange: (t: HubTab) => void; claimable: number }) {
  const items: { id: HubTab; label: string }[] = [
    { id: "play", label: "Play" }, { id: "missions", label: "Missions" }, { id: "badges", label: "Badges" }, { id: "progress", label: "Progress" },
  ];
  return (
    <div role="tablist" className="flex gap-1 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => onChange(t.id)}
          className="relative flex-1 py-2 rounded-xl text-sm font-bold transition-all"
          style={tab === t.id
            ? { background: "linear-gradient(135deg,#6366F1,#A855F7)", color: TXT }
            : { color: MUTED }}>
          {t.label}
          {t.id === "missions" && claimable > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center"
              style={{ background: "#F59E0B", color: "#0F172A" }}>{claimable}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── missions ─────────────────────────────────────────────────────────────────────────────────── */

function MissionCard({ m, onClaim, claiming }: { m: G2Mission; onClaim: (id: string) => void; claiming: boolean }) {
  const isAccuracy = m.metric === "accuracy_round";
  const pct = isAccuracy ? (m.progress / m.target) * 100 : (Math.min(m.progress, m.target) / m.target) * 100;
  const done = m.status !== "active";
  return (
    <Glass>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black" style={{ color: TXT }}>{m.title}</p>
          <p className="text-xs mt-0.5" style={{ color: MUTED }}>{m.description}</p>
        </div>
        <span className="shrink-0 text-xs font-black px-2 py-1 rounded-full" style={{ background: "rgba(245,158,11,0.15)", color: "#F59E0B" }}>+{m.xp_reward} XP</span>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <div className="flex-1"><Bar pct={pct} color={done ? "#22C55E" : undefined} /></div>
        <span className="text-xs tabular-nums w-20 text-right" style={{ color: MUTED }}>
          {isAccuracy ? `best ${m.progress}% / ${m.target}%` : `${Math.min(m.progress, m.target)} / ${m.target}`}
        </span>
      </div>
      {m.status === "completed" && (
        <button onClick={() => onClaim(m.id)} disabled={claiming}
          className="mt-3 w-full py-2 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-transform hover:scale-[1.02] disabled:opacity-60"
          style={{ background: "linear-gradient(135deg,#F59E0B,#F472B6)", color: "#0F172A" }}>
          {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />} Claim reward
        </button>
      )}
      {m.status === "claimed" && (
        <p className="mt-3 text-xs font-bold flex items-center gap-1" style={{ color: "#22C55E" }}><Check className="h-3.5 w-3.5" /> Claimed</p>
      )}
    </Glass>
  );
}

function MissionsPanel({ state, onClaim, claimingId }: { state: G2State; onClaim: (id: string) => void; claimingId: string | null }) {
  const { daily, weekly } = state.missions;
  const weak = state.insights.weak_subject;
  return (
    <div className="space-y-5">
      <Glass>
        <div className="flex items-start gap-2 text-xs" style={{ color: MUTED }}>
          <Target className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#A855F7" }} />
          <p>
            Missions are set from your last two weeks of play.
            {state.insights.avg_accuracy != null && <> Your recent accuracy is <b style={{ color: TXT }}>{state.insights.avg_accuracy}%</b>.</>}
            {weak && <> <b style={{ color: TXT }}>{weak.subject}</b> is your toughest subject right now.</>}
            {state.insights.rounds_14d === 0 && <> Play a few rounds and they will start to fit you.</>}
          </p>
        </div>
      </Glass>
      <section className="space-y-3">
        <h3 className="text-sm font-black" style={{ color: TXT }}>Today</h3>
        {daily.map((m) => <MissionCard key={m.id} m={m} onClaim={onClaim} claiming={claimingId === m.id} />)}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-black" style={{ color: TXT }}>This week</h3>
        {weekly.map((m) => <MissionCard key={m.id} m={m} onClaim={onClaim} claiming={claimingId === m.id} />)}
      </section>
    </div>
  );
}

/* ── badges ───────────────────────────────────────────────────────────────────────────────────── */

function BadgeTile({ b, tierLabel }: { b: G2Badge; tierLabel?: string }) {
  const pct = b.progress ? (b.progress.current / b.progress.target) * 100 : 0;
  return (
    <div className="rounded-2xl p-3 text-center"
      style={{
        background: b.earned ? "linear-gradient(135deg,rgba(99,102,241,0.25),rgba(168,85,247,0.25))" : "rgba(255,255,255,0.04)",
        border: `1px solid ${b.earned ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.08)"}`,
        opacity: b.earned ? 1 : 0.8,
      }}>
      <div className="text-3xl" style={{ filter: b.earned ? "none" : "grayscale(1)" }}>{BADGE_EMOJI[b.icon] ?? "🏅"}</div>
      <p className="text-xs font-black mt-1" style={{ color: TXT }}>{b.title}</p>
      {tierLabel && <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#A855F7" }}>{tierLabel}</p>}
      <p className="text-[11px] mt-1 leading-snug" style={{ color: MUTED }}>{b.description}</p>
      {b.earned ? (
        <p className="text-[11px] font-bold mt-2" style={{ color: "#22C55E" }}>Earned{b.earned_at ? ` ${new Date(b.earned_at).toLocaleDateString()}` : ""}</p>
      ) : b.progress ? (
        <div className="mt-2 space-y-1">
          <Bar pct={pct} />
          <p className="text-[10px] tabular-nums" style={{ color: MUTED }}>{b.progress.current} / {b.progress.target}</p>
        </div>
      ) : null}
    </div>
  );
}

function BadgesPanel({ state }: { state: G2State }) {
  const groups = new Map<string, G2Badge[]>();
  for (const b of state.badges) groups.set(b.category, [...(groups.get(b.category) ?? []), b]);
  const earned = state.badges.filter((b) => b.earned).length;
  if (!state.badges.length) {
    return <Glass><p className="text-sm text-center" style={{ color: MUTED }}>Badges aren't available yet.</p></Glass>;
  }
  return (
    <div className="space-y-5">
      <p className="text-xs text-center" style={{ color: MUTED }}>{earned} of {state.badges.length} badges earned</p>
      {[...groups.entries()].map(([cat, list]) => (
        <section key={cat} className="space-y-3">
          <h3 className="text-sm font-black" style={{ color: TXT }}>{CATEGORY_LABEL[cat] ?? cat}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {list.map((b, i) => <BadgeTile key={b.key} b={b} tierLabel={cat !== "g2_adaptive" ? TIER[i] : undefined} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── progress ─────────────────────────────────────────────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Glass className="text-center">
      <p className="text-2xl font-black tabular-nums" style={{ color: TXT }}>{value}</p>
      <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{label}</p>
    </Glass>
  );
}

function ProgressPanel({ state }: { state: G2State }) {
  const { progression: p, streak, insights } = state;
  return (
    <div className="space-y-4">
      <Glass>
        <div className="text-center">
          <div className="text-5xl">{p.emoji}</div>
          <p className="text-lg font-black mt-1" style={{ color: TXT }}>{p.title} · Level {p.level}</p>
          <p className="text-xs" style={{ color: MUTED }}>{p.total_xp} XP total</p>
        </div>
        <div className="mt-3"><Bar pct={p.level_progress_pct} /></div>
        <p className="text-xs mt-2 text-center" style={{ color: MUTED }}>
          {p.xp_to_next_level} XP to level {p.level + 1}
          {p.next_title && <> · <b style={{ color: TXT }}>{p.next_title.title}</b> at level {p.next_title.at_level}</>}
        </p>
      </Glass>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="XP this week" value={insights.xp_this_week} />
        <Stat label="Rounds this week" value={insights.rounds_this_week} />
        <Stat label="Avg accuracy" value={insights.avg_accuracy == null ? "-" : `${insights.avg_accuracy}%`} />
      </div>
      <Glass>
        <div className="flex items-center gap-2"><Flame className="h-4 w-4" style={{ color: "#F59E0B" }} />
          <p className="text-sm font-black" style={{ color: TXT }}>Streak: {streak.current} day{streak.current === 1 ? "" : "s"} (best {streak.longest})</p>
        </div>
        <p className="text-xs mt-2 flex items-start gap-2" style={{ color: MUTED }}>
          <Snowflake className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "#38BDF8" }} />
          <span>You earn a streak freeze every 7 days of streak (hold up to 2). A freeze automatically covers one missed day. Next one in {streak.next_freeze_in_days} day{streak.next_freeze_in_days === 1 ? "" : "s"}.</span>
        </p>
      </Glass>
    </div>
  );
}

/* ── tab body ─────────────────────────────────────────────────────────────────────────────────── */

export function Gamification2Panel({
  tab, state, loading, unavailable, error, onClaim, claimingId, onRetry,
}: {
  tab: Exclude<HubTab, "play">; state: G2State | null; loading: boolean; unavailable: boolean; error: string | null;
  onClaim: (id: string) => void; claimingId: string | null; onRetry: () => void;
}) {
  if (loading && !state) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" style={{ color: MUTED }} /></div>;
  if (unavailable) {
    return <Glass><p className="text-sm text-center" style={{ color: MUTED }}>Missions and badges aren't switched on for your school yet. Games and XP still work as usual.</p></Glass>;
  }
  if (error || !state) {
    return (
      <Glass>
        <p className="text-sm text-center" style={{ color: MUTED }}>{error ?? "Couldn't load your missions."}</p>
        <button onClick={onRetry} className="mt-3 mx-auto block px-4 py-2 rounded-xl text-sm font-bold" style={{ background: "rgba(255,255,255,0.08)", color: TXT }}>Try again</button>
      </Glass>
    );
  }
  if (tab === "missions") return <MissionsPanel state={state} onClaim={onClaim} claimingId={claimingId} />;
  if (tab === "badges") return <BadgesPanel state={state} />;
  return <ProgressPanel state={state} />;
}

/* ── results-screen summary of what this session earned ─────────────────────────────────────────── */

export function RoundRewardsCard({ rewards }: { rewards: G2Awarded[] }) {
  if (!rewards.length) return null;
  const xp = rewards.reduce((s, r) => s + (r.round_xp ?? 0) + r.badge_bonus_xp, 0);
  const missions = rewards.flatMap((r) => r.missions_completed ?? []);
  const badges = rewards.flatMap((r) => r.badges_unlocked);
  const last = rewards[rewards.length - 1];
  return (
    <Glass>
      <p className="text-sm font-black text-center" style={{ color: TXT }}>Rewards from this round</p>
      <div className="grid grid-cols-3 gap-3 mt-3 text-center">
        <div><p className="text-xl font-black" style={{ color: "#F59E0B" }}>+{xp}</p><p className="text-[11px]" style={{ color: MUTED }}>XP</p></div>
        <div><p className="text-xl font-black" style={{ color: TXT }}>{last.streak?.current ?? 0}🔥</p><p className="text-[11px]" style={{ color: MUTED }}>day streak</p></div>
        <div><p className="text-xl font-black" style={{ color: TXT }}>{missions.length}</p><p className="text-[11px]" style={{ color: MUTED }}>missions done</p></div>
      </div>
      {badges.length > 0 && <p className="text-xs mt-3 text-center" style={{ color: TXT }}>🏅 New: {badges.map((b) => b.title).join(", ")}</p>}
      {missions.length > 0 && <p className="text-xs mt-1 text-center" style={{ color: MUTED }}>Claim mission rewards in Missions.</p>}
      {rewards.some((r) => r.capped) && <p className="text-[11px] mt-2 text-center" style={{ color: MUTED }}>Daily round XP limit reached - badges and missions still count.</p>}
    </Glass>
  );
}
