import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client"; // adjust path to match your existing client import
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertCircle, BookOpen, CalendarCheck, GraduationCap, RefreshCw } from "lucide-react";

// ---------------------------------------------------------------------------
// Types matching the school-quality-index edge function response shape
// ---------------------------------------------------------------------------
interface ComponentResult {
  score: number | null;
  available: boolean;
  details: Record<string, unknown> | null;
}

interface SchoolQualityIndexResponse {
  school_id: string;
  index_score: number | null;
  components: {
    attendance: ComponentResult;
    coverage: ComponentResult;
    academic: ComponentResult;
  };
  meta: {
    weighting: string;
    components_used: number;
    computed_at: string;
  };
}

interface SchoolQualityIndexProps {
  schoolId: string;
}

// ---------------------------------------------------------------------------
// Score band → color + label. Bands chosen to match a principal's actual
// read of the number, not evenly-spaced quartiles.
// ---------------------------------------------------------------------------
function getScoreBand(score: number) {
  if (score >= 85) return { label: "Excellent", color: "#0d9488", ring: "#14b8a6" }; // teal-600 / teal-500
  if (score >= 70) return { label: "Strong", color: "#0891b2", ring: "#22d3ee" }; // cyan-600 / cyan-400
  if (score >= 50) return { label: "Developing", color: "#ca8a04", ring: "#eab308" }; // amber
  return { label: "Needs attention", color: "#dc2626", ring: "#f87171" }; // red
}

const COMPONENT_META = {
  attendance: {
    label: "Attendance",
    icon: CalendarCheck,
    unavailableCopy: "No attendance records logged yet",
  },
  coverage: {
    label: "Syllabus Coverage",
    icon: BookOpen,
    unavailableCopy: "No syllabus progress logged yet",
  },
  academic: {
    label: "Academic Performance",
    icon: GraduationCap,
    unavailableCopy: "No exam marks entered this semester",
  },
} as const;

export default function SchoolQualityIndex({ schoolId }: SchoolQualityIndexProps) {
  const [data, setData] = useState<SchoolQualityIndexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIndex = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke(
        "school-quality-index",
        { body: { school_id: schoolId } }
      );
      if (fnError) throw fnError;
      setData(result as SchoolQualityIndexResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load School Quality Index");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) fetchIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  if (loading) {
    return (
      <Card className="border-0 shadow-md">
        <CardContent className="flex items-center justify-center py-16">
          <div className="flex items-center gap-2 text-slate-400">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm">Calculating school quality index…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-0 shadow-md">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertCircle className="h-6 w-6 text-red-400" />
          <p className="text-sm text-slate-500">{error}</p>
          <button
            onClick={fetchIndex}
            className="text-sm font-medium text-teal-600 hover:text-teal-700"
          >
            Try again
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.index_score === null) {
    return (
      <Card className="border-0 shadow-md">
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium text-slate-600">Not enough data yet</p>
          <p className="text-xs text-slate-400">
            The index needs at least one of attendance, syllabus, or academic data logged.
          </p>
        </CardContent>
      </Card>
    );
  }

  const band = getScoreBand(data.index_score);
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - data.index_score / 100);

  return (
    <Card className="overflow-hidden border-0 shadow-md">
      <CardHeader className="bg-gradient-to-r from-teal-600 to-cyan-500 pb-20 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium uppercase tracking-wide text-teal-50">
              School Quality Index
            </h3>
            <p className="mt-1 text-xs text-teal-100">
              {data.meta.components_used} of 3 components available
              <br className="sm:hidden" />
              <span className="hidden sm:inline"> · </span>
              updated {new Date(data.meta.computed_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={fetchIndex}
            className="shrink-0 rounded-full bg-white/15 p-2 text-white transition hover:bg-white/25"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>

      <CardContent className="-mt-16 space-y-6 pt-0">
        {/* Score ring */}
        <div className="flex justify-center">
          <div className="relative rounded-full bg-white p-3 shadow-lg">
            <svg width="140" height="140" viewBox="0 0 120 120" className="-rotate-90">
              <circle cx="60" cy="60" r="54" fill="none" stroke="#f1f5f9" strokeWidth="10" />
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke={band.ring}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: "stroke-dashoffset 0.8s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold" style={{ color: band.color }}>
                {Math.round(data.index_score)}
              </span>
              <span className="text-[11px] font-medium text-slate-400">/ 100</span>
            </div>
          </div>
        </div>

        <div className="text-center">
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${band.color}1a`, color: band.color }}
          >
            {band.label}
          </span>
        </div>

        {/* Component breakdown */}
        <div className="space-y-3">
          {(Object.keys(COMPONENT_META) as Array<keyof typeof COMPONENT_META>).map((key) => {
            const meta = COMPONENT_META[key];
            const comp = data.components[key];
            const Icon = meta.icon;

            return (
              <div
                key={key}
                className="flex items-center gap-3 rounded-xl border-l-4 bg-slate-50 px-4 py-3"
                style={{
                  borderLeftColor: comp.available ? getScoreBand(comp.score!).ring : "#e2e8f0",
                }}
              >
                <div className="rounded-lg bg-white p-2 shadow-sm">
                  <Icon className="h-4 w-4 text-slate-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">{meta.label}</p>
                  {comp.available ? (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${comp.score}%`,
                          backgroundColor: getScoreBand(comp.score!).ring,
                        }}
                      />
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs italic text-slate-400">{meta.unavailableCopy}</p>
                  )}
                </div>
                <div className="w-12 text-right">
                  {comp.available ? (
                    <span className="text-sm font-semibold text-slate-700">
                      {Math.round(comp.score!)}%
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
