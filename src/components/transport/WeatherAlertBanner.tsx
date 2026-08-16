import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CloudRain, Zap, CloudFog, CloudSnow, Cloud, X } from "lucide-react";

interface WeatherSnapshotRow {
  id: string;
  route_id: string;
  condition: string | null;
  severity: string;
  temp_c: number | null;
  precipitation_mm: number | null;
  wind_speed_kmh: number | null;
  raw_alerts: { event?: string }[] | null;
  captured_at: string;
}

function conditionIcon(condition: string | null) {
  switch (condition) {
    case "rain":
      return <CloudRain className="h-5 w-5" />;
    case "storm":
      return <Zap className="h-5 w-5" />;
    case "fog":
      return <CloudFog className="h-5 w-5" />;
    case "snow":
      return <CloudSnow className="h-5 w-5" />;
    default:
      return <Cloud className="h-5 w-5" />;
  }
}

const SEVERITY_STYLE: Record<string, string> = {
  moderate: "border-orange-400 bg-orange-50",
  severe: "border-red-400 bg-red-50",
};

// Polls for the latest weather snapshot on this driver's assigned route.
// Only surfaces the banner when severity is moderate or worse — calm
// conditions stay silent. Matches RouteSuggestionBanner's 15s poll pattern.
export function WeatherAlertBanner({ driverId }: { driverId: string }) {
  const [snapshot, setSnapshot] = useState<WeatherSnapshotRow | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const { data: route } = await supabase
        .from("transport_routes")
        .select("id")
        .eq("driver_id", driverId)
        .eq("status", "active")
        .maybeSingle();

      if (!route) {
        if (!cancelled) setSnapshot(null);
        return;
      }

      const { data, error } = await supabase
        .from("transport_weather_snapshots")
        .select(
          "id, route_id, condition, severity, temp_c, precipitation_mm, wind_speed_kmh, raw_alerts, captured_at"
        )
        .eq("route_id", route.id)
        .in("severity", ["moderate", "severe"])
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled && !error) setSnapshot(data as WeatherSnapshotRow | null);
    }

    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [driverId]);

  if (!snapshot || snapshot.id === dismissedId) return null;

  const alertMessage = snapshot.raw_alerts?.[0]?.event ?? snapshot.condition ?? "Adverse weather";

  return (
    <Card className={`border-2 ${SEVERITY_STYLE[snapshot.severity] ?? "border-orange-400 bg-orange-50"}`}>
      <CardContent className="flex items-start gap-3 p-4">
        {conditionIcon(snapshot.condition)}
        <div className="flex-1">
          <p className="font-semibold text-sm">
            {snapshot.severity === "severe" ? "Severe Weather Alert" : "Weather Advisory"}
          </p>
          <p className="text-sm text-muted-foreground">
            {alertMessage}
            {snapshot.temp_c != null && ` — ${snapshot.temp_c.toFixed(0)}°C`}
            {snapshot.wind_speed_kmh != null && `, ${snapshot.wind_speed_kmh.toFixed(0)} km/h wind`}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Drive carefully and allow extra time on your route.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setDismissedId(snapshot.id)}>
          <X className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
