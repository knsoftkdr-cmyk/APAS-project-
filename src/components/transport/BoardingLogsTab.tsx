import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardList, ArrowDownCircle, ArrowUpCircle } from "lucide-react";

interface LogRow {
  id: string;
  student_id: string;
  route_id: string;
  stop_id: string;
  direction: "pickup" | "drop";
  trip_date: string;
  boarded_at: string;
  students: { full_name: string } | null;
  route_stops: { stop_name: string } | null;
  transport_routes: { route_name: string } | null;
}

export function BoardingLogsTab({ schoolId }: { schoolId?: string }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [directionFilter, setDirectionFilter] = useState<"all" | "pickup" | "drop">("all");
  const [dateFilter, setDateFilter] = useState<string>(new Date().toISOString().slice(0, 10));
  const [studentSearch, setStudentSearch] = useState("");

  const fetchLogs = async () => {
    if (!schoolId) return;
    setLoading(true);
    let query = supabase
      .from("boarding_confirmations")
      .select(
        "id, student_id, route_id, stop_id, direction, trip_date, boarded_at, students(full_name), route_stops(stop_name), transport_routes(route_name)"
      )
      .eq("school_id", schoolId)
      .order("boarded_at", { ascending: false })
      .limit(200);
    if (directionFilter !== "all") query = query.eq("direction", directionFilter);
    if (dateFilter) query = query.eq("trip_date", dateFilter);
    const { data, error } = await query;
    if (!error) setLogs((data as any as LogRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, directionFilter, dateFilter]);

  const filteredLogs = studentSearch.trim()
    ? logs.filter((l) => l.students?.full_name?.toLowerCase().includes(studentSearch.trim().toLowerCase()))
    : logs;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> Boarding & Drop Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <Label className="text-xs">Direction</Label>
            <Select value={directionFilter} onValueChange={(v: any) => setDirectionFilter(v)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pickup">Boarding (pickup)</SelectItem>
                <SelectItem value="drop">Drop</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-[160px]" />
          </div>
          <div>
            <Label className="text-xs">Student name</Label>
            <Input
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Search..."
              className="w-[180px]"
            />
          </div>
          {dateFilter && (
            <Button variant="ghost" size="sm" onClick={() => setDateFilter("")}>Clear date</Button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading logs...
          </p>
        ) : filteredLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No boarding/drop records match these filters.</p>
        ) : (
          <div className="space-y-1.5">
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex items-center justify-between rounded-lg border p-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  {log.direction === "pickup" ? (
                    <ArrowUpCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : (
                    <ArrowDownCircle className="h-4 w-4 text-red-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{log.students?.full_name || "Student"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {log.route_stops?.stop_name || "Stop"} · {log.transport_routes?.route_name || "Route"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={log.direction === "pickup" ? "text-emerald-700 border-emerald-200 bg-emerald-50" : "text-red-600 border-red-200 bg-red-50"}>
                    {log.direction === "pickup" ? "Boarded" : "Dropped"}
                  </Badge>
                  <span className="text-xs text-muted-foreground w-16 text-right">
                    {new Date(log.boarded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
