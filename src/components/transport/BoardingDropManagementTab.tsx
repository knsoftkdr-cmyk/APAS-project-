import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ClipboardList, ArrowDownCircle, ArrowUpCircle, AlertTriangle, ShieldAlert,
} from "lucide-react";

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

interface MissedRow {
  id: string;
  student_id: string;
  route_id: string;
  stop_id: string;
  direction: "pickup" | "drop";
  trip_date: string;
  created_at: string;
  students: { full_name: string } | null;
  route_stops: { stop_name: string } | null;
  transport_routes: { route_name: string } | null;
}

interface UnauthorizedRow {
  id: string;
  student_id: string;
  route_id: string;
  stop_id: string;
  direction: "pickup" | "drop";
  trip_date: string;
  reason: string;
  created_at: string;
  students: { full_name: string } | null;
  route_stops: { stop_name: string } | null;
  transport_routes: { route_name: string } | null;
}

function LogList({ schoolId, fixedDirection }: { schoolId?: string; fixedDirection: "pickup" | "drop" }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
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
      .eq("direction", fixedDirection)
      .order("boarded_at", { ascending: false })
      .limit(200);
    if (dateFilter) query = query.eq("trip_date", dateFilter);
    const { data, error } = await query;
    if (!error) setLogs((data as any as LogRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, dateFilter]);

  const filteredLogs = studentSearch.trim()
    ? logs.filter((l) => l.students?.full_name?.toLowerCase().includes(studentSearch.trim().toLowerCase()))
    : logs;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </p>
      ) : filteredLogs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No records match these filters.</p>
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
    </div>
  );
}

function MissedBoardingList({ schoolId }: { schoolId?: string }) {
  const [rows, setRows] = useState<MissedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = async () => {
    if (!schoolId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("missed_boarding_alerts")
      .select(
        "id, student_id, route_id, stop_id, direction, trip_date, created_at, students(full_name), route_stops(stop_name), transport_routes(route_name)"
      )
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error) setRows((data as any as MissedRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchRows();
    const channel = supabase
      .channel("missed-boarding-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "missed_boarding_alerts", filter: `school_id=eq.${schoolId}` }, () => fetchRows())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  if (loading) {
    return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No missed boarding alerts.</p>;
  }
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{row.students?.full_name || "Student"}</p>
              <p className="text-xs text-muted-foreground truncate">
                {row.route_stops?.stop_name || "Stop"} · {row.transport_routes?.route_name || "Route"} · {row.direction} · {row.trip_date}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-100 shrink-0">Missed</Badge>
        </div>
      ))}
    </div>
  );
}

function UnauthorizedBoardingList({ schoolId }: { schoolId?: string }) {
  const [rows, setRows] = useState<UnauthorizedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = async () => {
    if (!schoolId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("unauthorized_boarding_alerts")
      .select(
        "id, student_id, route_id, stop_id, direction, trip_date, reason, created_at, students(full_name), route_stops(stop_name), transport_routes(route_name)"
      )
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error) setRows((data as any as UnauthorizedRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchRows();
    const channel = supabase
      .channel("unauthorized-boarding-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "unauthorized_boarding_alerts", filter: `school_id=eq.${schoolId}` }, () => fetchRows())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  if (loading) {
    return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No unauthorized boarding alerts.</p>;
  }
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldAlert className="h-4 w-4 text-red-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{row.students?.full_name || "Student"}</p>
              <p className="text-xs text-muted-foreground truncate">
                {row.route_stops?.stop_name || "Stop"} · {row.transport_routes?.route_name || "Route"} · {row.direction} · {row.trip_date}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-red-700 border-red-300 bg-red-100 shrink-0">Unauthorized</Badge>
        </div>
      ))}
    </div>
  );
}

export function BoardingDropManagementTab({ schoolId }: { schoolId?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> Boarding & Drop Management
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="boarding" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="boarding">Boarding Logs</TabsTrigger>
            <TabsTrigger value="drop">Drop Logs</TabsTrigger>
            <TabsTrigger value="missed">Missed Boarding</TabsTrigger>
            <TabsTrigger value="unauthorized">Unauthorized Alerts</TabsTrigger>
          </TabsList>
          <TabsContent value="boarding">
            <LogList schoolId={schoolId} fixedDirection="pickup" />
          </TabsContent>
          <TabsContent value="drop">
            <LogList schoolId={schoolId} fixedDirection="drop" />
          </TabsContent>
          <TabsContent value="missed">
            <MissedBoardingList schoolId={schoolId} />
          </TabsContent>
          <TabsContent value="unauthorized">
            <UnauthorizedBoardingList schoolId={schoolId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
