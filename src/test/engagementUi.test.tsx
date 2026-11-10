import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MeResponse, EngagementScore, ActivityResult, ActivityKey } from "@/lib/engagement";

const fetchMy = vi.fn();
vi.mock("@/lib/engagement", async (orig) => ({ ...(await orig<typeof import("@/lib/engagement")>()), fetchMyEngagement: (...a: unknown[]) => fetchMy(...a) }));

import StudentEngagementCard from "@/components/engagement/StudentEngagementCard";
import { ScoreRing, ActivityBars, CategoryBadge, DeltaBadge } from "@/components/engagement/EngagementParts";

const act = (key: ActivityKey, score: number | null, extra: Partial<ActivityResult> = {}): ActivityResult => ({
  key, available: score !== null, score, opportunities: score === null ? 0 : 3, credit: 2, weight: 20, effective_weight: score === null ? 0 : 25, points: 10, ...extra,
});
const base: EngagementScore = {
  student_id: "s", status: "ok", score: 73.8, category: "moderately_engaged", category_label: "Moderately Engaged", opportunities: 8,
  activities: { video: act("video", 50), quiz: act("quiz", 83.3), assignment: act("assignment", 100), live_class: act("live_class", null), interaction: act("interaction", 60) },
  previous_score: 60, delta: 13.8, trend: "up", declining: false, period_start: null, period_end: null, window_days: 30, computed_at: null,
  tips: [{ key: "video", text: "Watch your assigned videos to the end - opening a video without watching it does not count." }], not_participating: [],
};
const respond = (score: EngagementScore | null, history: MeResponse["history"] = []): MeResponse => ({ config: { window_days: 30, weights: { video: 20, quiz: 25, assignment: 25, live_class: 20, interaction: 10 } }, score, history, sources_unavailable: [] });
const renderCard = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StudentEngagementCard /></QueryClientProvider>);

beforeEach(() => { fetchMy.mockReset(); });

describe("StudentEngagementCard", () => {
  it("shows the score, category, comparison and tips", async () => {
    fetchMy.mockResolvedValue(respond(base));
    renderCard();
    expect(await screen.findByText("74")).toBeInTheDocument(); // 73.8 rounded in the ring
    expect(screen.getByText("Moderately Engaged")).toBeInTheDocument();
    expect(screen.getByText(/\+13.8 vs previous period/)).toBeInTheDocument();
    expect(screen.getByText(/Watch your assigned videos/)).toBeInTheDocument();
  });
  it("shows an unassigned activity as 'not counted', never as zero", async () => {
    fetchMy.mockResolvedValue(respond(base));
    renderCard();
    await screen.findByText("74");
    expect(screen.getByText(/Not assigned - not counted/)).toBeInTheDocument();
  });
  it("shows 'Not enough data' with no score or category when there is too little activity", async () => {
    fetchMy.mockResolvedValue(respond({ ...base, status: "insufficient", score: null, category: null, category_label: null, activities: null, tips: [] }));
    renderCard();
    expect(await screen.findAllByText(/Not enough/i)).not.toHaveLength(0);
    expect(screen.queryByText("Moderately Engaged")).not.toBeInTheDocument();
    expect(screen.queryByText("74")).not.toBeInTheDocument();
  });
  it("shows a friendly message before any score exists", async () => {
    fetchMy.mockResolvedValue(respond(null));
    renderCard();
    expect(await screen.findByText(/will appear here once you have some learning activity/i)).toBeInTheDocument();
  });
  it("shows the server's error instead of a blank card", async () => {
    fetchMy.mockImplementation(async () => { throw new Error("No student record found for this account"); });
    renderCard();
    await waitFor(() => expect(screen.getByText(/No student record found/)).toBeInTheDocument());
  });
});

describe("shared visuals", () => {
  it("ScoreRing exposes the score to assistive tech", () => {
    render(<ScoreRing score={82} category="highly_engaged" />);
    expect(screen.getByRole("img", { name: "Engagement score 82 out of 100" })).toBeInTheDocument();
  });
  it("ScoreRing says 'Not enough data' for a null score", () => {
    render(<ScoreRing score={null} category={null} />);
    expect(screen.getByRole("img", { name: "Not enough data" })).toBeInTheDocument();
  });
  it("CategoryBadge has no category without data", () => {
    render(<CategoryBadge category={null} />);
    expect(screen.getByText("Not enough data")).toBeInTheDocument();
  });
  it("DeltaBadge flags a decline", () => {
    render(<DeltaBadge delta={-14} trend="down" declining />);
    expect(screen.getByText(/Declining/)).toBeInTheDocument();
  });
  it("ActivityBars renders one labelled progress bar per activity", () => {
    render(<ActivityBars activities={base.activities!} />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(5);
  });
});
