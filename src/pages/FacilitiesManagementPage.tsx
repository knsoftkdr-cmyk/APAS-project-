import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Building2, Plus, Pencil, Clock, CalendarClock, BarChart3, Sparkles } from "lucide-react";

interface Facility {
  id: string;
  school_id: string;
  branch_id: string | null;
  name: string;
  type: string;
  capacity: number | null;
  equipment: string[];
  is_active: boolean;
  operating_hours_per_day: number;
  operating_days: string[];
}

interface SchoolOption {
  id: string;
  name: string;
}

interface Booking {
  id: string;
  facility_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  purpose: string | null;
  notes: string | null;
  booked_by: string | null;
  booker_name?: string;
}

const FACILITY_TYPES = ["classroom", "lab", "hall", "sports", "library", "auditorium", "other"];
const ALL_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
}

function daysInRange(startDate: string, endDate: string, operatingDays: string[]): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayName = dayNames[d.getDay()];
    if (operatingDays.includes(dayName)) count++;
  }
  return count;
}

export default function FacilitiesManagementPage() {
  const { profile } = useAuth();
  const isKnsoft = profile?.role === "knsoft_admin";

  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>(profile?.school_id ?? "");

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("classroom");
  const [capacity, setCapacity] = useState("");
  const [equipmentText, setEquipmentText] = useState("");
  const [operatingHours, setOperatingHours] = useState("8");
  const [operatingDays, setOperatingDays] = useState<Set<string>>(
    new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"])
  );
  const [saving, setSaving] = useState(false);

  // Log Usage tab
  const [bookingFacilityId, setBookingFacilityId] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [savingBooking, setSavingBooking] = useState(false);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);

  // Utilization tab
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [rangeStart, setRangeStart] = useState(monthAgo);
  const [rangeEnd, setRangeEnd] = useState(today);
  const [utilBookings, setUtilBookings] = useState<Booking[]>([]);
  const [loadingUtil, setLoadingUtil] = useState(false);

  useEffect(() => {
    if (!isKnsoft) return;
    supabase
      .from("schools")
      .select("id, name")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          toast.error("Failed to load schools: " + error.message);
          return;
        }
        setSchools(data ?? []);
        if (data && data.length > 0 && !selectedSchoolId) {
          setSelectedSchoolId(data[0].id);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKnsoft]);

  const fetchFacilities = useCallback(async () => {
    if (!selectedSchoolId) return;
    setLoadingFacilities(true);
    const { data, error } = await supabase
      .from("facilities")
      .select("*")
      .eq("school_id", selectedSchoolId)
      .order("name");
    if (error) {
      toast.error("Failed to load facilities: " + error.message);
      setLoadingFacilities(false);
      return;
    }
    setFacilities(data ?? []);
    setLoadingFacilities(false);
  }, [selectedSchoolId]);

  const fetchRecentBookings = useCallback(async () => {
    if (!selectedSchoolId) return;
    setLoadingBookings(true);
    const { data, error } = await supabase
      .from("facility_bookings")
      .select("id, facility_id, booking_date, start_time, end_time, purpose, notes, booked_by")
      .eq("school_id", selectedSchoolId)
      .order("booking_date", { ascending: false })
      .order("start_time", { ascending: false })
      .limit(25);
    if (error) {
      toast.error("Failed to load bookings: " + error.message);
      setLoadingBookings(false);
      return;
    }
    const bookerIds = Array.from(new Set((data ?? []).map((b) => b.booked_by).filter(Boolean))) as string[];
    let bookerMap: Record<string, string> = {};
    if (bookerIds.length > 0) {
      const { data: bookers } = await supabase.from("profiles").select("id, full_name").in("id", bookerIds);
      (bookers ?? []).forEach((b) => { bookerMap[b.id] = b.full_name; });
    }
    setRecentBookings((data ?? []).map((b) => ({ ...b, booker_name: b.booked_by ? bookerMap[b.booked_by] ?? "Unknown" : "—" })));
    setLoadingBookings(false);
  }, [selectedSchoolId]);

  const fetchUtilBookings = useCallback(async () => {
    if (!selectedSchoolId || !rangeStart || !rangeEnd) return;
    setLoadingUtil(true);
    const { data, error } = await supabase
      .from("facility_bookings")
      .select("id, facility_id, booking_date, start_time, end_time")
      .eq("school_id", selectedSchoolId)
      .gte("booking_date", rangeStart)
      .lte("booking_date", rangeEnd);
    if (error) {
      toast.error("Failed to load utilization data: " + error.message);
      setLoadingUtil(false);
      return;
    }
    setUtilBookings(data ?? []);
    setLoadingUtil(false);
  }, [selectedSchoolId, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchFacilities();
    fetchRecentBookings();
  }, [fetchFacilities, fetchRecentBookings]);

  useEffect(() => {
    fetchUtilBookings();
  }, [fetchUtilBookings]);

  const resetForm = () => {
    setName("");
    setType("classroom");
    setCapacity("");
    setEquipmentText("");
    setOperatingHours("8");
    setOperatingDays(new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]));
  };

  const openCreateDialog = () => {
    setEditingId(null);
    resetForm();
    setFormOpen(true);
  };

  const openEditDialog = (f: Facility) => {
    setEditingId(f.id);
    setName(f.name);
    setType(f.type);
    setCapacity(f.capacity ? String(f.capacity) : "");
    setEquipmentText((f.equipment ?? []).join(", "));
    setOperatingHours(String(f.operating_hours_per_day));
    setOperatingDays(new Set(f.operating_days ?? []));
    setFormOpen(true);
  };

  const toggleDay = (day: string) => {
    setOperatingDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedSchoolId || !name.trim()) {
      toast.error("Facility name is required");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      type,
      capacity: capacity ? parseInt(capacity, 10) : null,
      equipment: equipmentText.split(",").map((e) => e.trim()).filter(Boolean),
      operating_hours_per_day: parseFloat(operatingHours) || 8,
      operating_days: Array.from(operatingDays),
    };
    if (editingId) {
      const { error } = await supabase.from("facilities").update(payload).eq("id", editingId);
      setSaving(false);
      if (error) {
        toast.error("Failed to update facility: " + error.message);
        return;
      }
      toast.success("Facility updated");
    } else {
      const { error } = await supabase.from("facilities").insert({
        school_id: selectedSchoolId,
        ...payload,
        is_active: true,
      });
      setSaving(false);
      if (error) {
        toast.error("Failed to create facility: " + error.message);
        return;
      }
      toast.success("Facility created");
    }
    resetForm();
    setEditingId(null);
    setFormOpen(false);
    fetchFacilities();
  };

  const toggleActive = async (f: Facility) => {
    const { error } = await supabase.from("facilities").update({ is_active: !f.is_active }).eq("id", f.id);
    if (error) {
      toast.error("Failed to update: " + error.message);
      return;
    }
    setFacilities((prev) => prev.map((x) => (x.id === f.id ? { ...x, is_active: !x.is_active } : x)));
  };

  const handleSaveBooking = async () => {
    if (!selectedSchoolId || !bookingFacilityId || !bookingDate || !startTime || !endTime) {
      toast.error("Facility, date, and time range are required");
      return;
    }
    if (endTime <= startTime) {
      toast.error("End time must be after start time");
      return;
    }
    setSavingBooking(true);
    const { error } = await supabase.from("facility_bookings").insert({
      facility_id: bookingFacilityId,
      school_id: selectedSchoolId,
      booked_by: profile?.id ?? null,
      booking_date: bookingDate,
      start_time: startTime,
      end_time: endTime,
      purpose: purpose.trim() || null,
      notes: notes.trim() || null,
    });
    setSavingBooking(false);
    if (error) {
      toast.error("Failed to log booking: " + error.message);
      return;
    }
    toast.success("Usage logged");
    setBookingFacilityId("");
    setBookingDate("");
    setStartTime("09:00");
    setEndTime("10:00");
    setPurpose("");
    setNotes("");
    fetchRecentBookings();
    fetchUtilBookings();
  };

  const facilityName = (id: string) => facilities.find((f) => f.id === id)?.name ?? "Unknown";

  const utilizationRows = useMemo(() => {
    return facilities.map((f) => {
      const bookedHours = utilBookings
        .filter((b) => b.facility_id === f.id)
        .reduce((sum, b) => sum + hoursBetween(b.start_time, b.end_time), 0);
      const availableDays = daysInRange(rangeStart, rangeEnd, f.operating_days ?? []);
      const availableHours = availableDays * (f.operating_hours_per_day ?? 8);
      const pct = availableHours > 0 ? Math.min(100, (bookedHours / availableHours) * 100) : 0;
      return { facility: f, bookedHours, availableHours, pct };
    });
  }, [facilities, utilBookings, rangeStart, rangeEnd]);

  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-blue-300 opacity-[0.12] blur-3xl" />
        <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-sky-300 opacity-[0.10] blur-3xl" />
        <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-blue-200 opacity-[0.10] blur-3xl" />

        <div className="relative z-10 space-y-5 p-4 md:p-6 max-w-7xl mx-auto">
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-blue-600 to-sky-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                  <Building2 className="h-5 w-5 md:h-6 md:w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-white">Resource Analytics</h1>
                  <p className="text-blue-100 text-xs md:text-sm mt-0.5">Track facilities, log usage, and monitor utilization</p>
                </div>
              </div>
              {isKnsoft && (
                <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                  <SelectTrigger className="w-56 bg-white/20 border-white/30 text-white">
                    <SelectValue placeholder="Select school" />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Tabs defaultValue="facilities">
            <TabsList>
              <TabsTrigger value="facilities">Facilities</TabsTrigger>
              <TabsTrigger value="log">Log Usage</TabsTrigger>
              <TabsTrigger value="utilization">Utilization</TabsTrigger>
            </TabsList>

            <TabsContent value="facilities" className="space-y-4 pt-4">
              <div className="flex justify-end">
                <Dialog
                  open={formOpen}
                  onOpenChange={(open) => {
                    setFormOpen(open);
                    if (!open) { resetForm(); setEditingId(null); }
                  }}
                >
                  <DialogTrigger asChild>
                    <Button onClick={openCreateDialog} className="bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700">
                      <Plus className="h-4 w-4 mr-1" /> Add Facility
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingId ? "Edit Facility" : "Add New Facility"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                      <div>
                        <Label>Name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Physics Lab" />
                      </div>
                      <div>
                        <Label>Type</Label>
                        <Select value={type} onValueChange={setType}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FACILITY_TYPES.map((t) => (
                              <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Capacity</Label>
                          <Input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 40" />
                        </div>
                        <div>
                          <Label>Hours/Day</Label>
                          <Input type="number" min="1" max="24" value={operatingHours} onChange={(e) => setOperatingHours(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <Label>Equipment (comma separated)</Label>
                        <Input value={equipmentText} onChange={(e) => setEquipmentText(e.target.value)} placeholder="e.g. Projector, Microscopes, Whiteboard" />
                      </div>
                      <div>
                        <Label className="mb-2 block">Operating Days</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {ALL_DAYS.map((d) => (
                            <label key={d} className="flex items-center gap-2 text-sm capitalize cursor-pointer">
                              <Checkbox checked={operatingDays.has(d)} onCheckedChange={() => toggleDay(d)} />
                              {d}
                            </label>
                          ))}
                        </div>
                      </div>
                      <Button className="w-full bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700" onClick={handleSave} disabled={saving}>
                        {saving ? "Saving..." : editingId ? "Save Changes" : "Create Facility"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loadingFacilities ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading facilities...</p>
              ) : facilities.length === 0 ? (
                <Card className="border-2 border-dashed border-blue-200 bg-gradient-to-b from-blue-50/50 to-white rounded-2xl">
                  <CardContent className="py-16 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-sky-500 flex items-center justify-center mx-auto mb-4 shadow-md shadow-blue-200">
                      <Building2 className="h-7 w-7 text-white" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-800 mb-1">No facilities yet</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">Click "Add Facility" above to add your first classroom, lab, or hall.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {facilities.map((f) => (
                    <Card key={f.id} className="overflow-hidden border-t-4 border-t-sky-300 border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                              <Building2 className="h-4 w-4 text-blue-600" />
                            </div>
                            <CardTitle className="text-base truncate">{f.name}</CardTitle>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-blue-50 hover:text-blue-700 rounded-full"
                            onClick={() => openEditDialog(f)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground pl-11.5 mt-1 capitalize">
                          {f.type}{f.capacity ? ` · Capacity ${f.capacity}` : ""}
                        </p>
                      </CardHeader>
                      <CardContent className="pt-1">
                        {f.equipment && f.equipment.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-3">
                            {f.equipment.map((e, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{e}</Badge>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                          <Clock className="h-3.5 w-3.5" /> {f.operating_hours_per_day}h/day · {(f.operating_days ?? []).length} days/week
                        </div>
                        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Active</span>
                            <Switch checked={f.is_active} onCheckedChange={() => toggleActive(f)} />
                          </div>
                          <Badge className={f.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}>
                            {f.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="log" className="space-y-4 pt-4">
              <Card className="rounded-2xl border-blue-100">
                <CardContent className="pt-6 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Facility</Label>
                      <Select value={bookingFacilityId} onValueChange={setBookingFacilityId}>
                        <SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger>
                        <SelectContent>
                          {facilities.map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Date</Label>
                      <Input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
                    </div>
                    <div>
                      <Label>Start Time</Label>
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                    <div>
                      <Label>End Time</Label>
                      <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </div>
                    <div>
                      <Label>Purpose</Label>
                      <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Class 10 Physics practical" />
                    </div>
                    <div>
                      <Label>Notes</Label>
                      <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                    </div>
                  </div>
                  <Button
                    onClick={handleSaveBooking}
                    disabled={savingBooking}
                    className="bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700"
                  >
                    <CalendarClock className="h-4 w-4 mr-1" /> {savingBooking ? "Logging..." : "Log Usage"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-blue-100">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Recent Bookings</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingBookings ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
                  ) : recentBookings.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic py-4 text-center">No bookings logged yet.</p>
                  ) : (
                    <div className="divide-y divide-slate-50">
                      {recentBookings.map((b) => (
                        <div key={b.id} className="flex items-center gap-3 py-2.5 text-sm flex-wrap">
                          <span className="font-medium text-slate-700 min-w-[140px]">{facilityName(b.facility_id)}</span>
                          <span className="text-muted-foreground">{b.booking_date}</span>
                          <span className="text-muted-foreground">{b.start_time?.slice(0, 5)}–{b.end_time?.slice(0, 5)}</span>
                          <span className="text-muted-foreground flex-1">{b.purpose ?? "—"}</span>
                          <Badge variant="outline" className="text-xs">{b.booker_name}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="utilization" className="space-y-4 pt-4">
              <Card className="rounded-2xl border-blue-100">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <Label>From</Label>
                      <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
                    </div>
                    <div>
                      <Label>To</Label>
                      <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {loadingUtil ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Calculating utilization...</p>
              ) : facilities.length === 0 ? (
                <p className="text-sm text-muted-foreground italic text-center py-8">Add facilities first to see utilization.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {utilizationRows.map(({ facility, bookedHours, availableHours, pct }) => (
                    <Card key={facility.id} className="rounded-2xl border-blue-100">
                      <CardContent className="pt-5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-blue-500" />
                            <span className="font-medium text-slate-700">{facility.name}</span>
                          </div>
                          <span className="text-sm font-semibold text-blue-700">{pct.toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-sky-500 rounded-full"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {bookedHours.toFixed(1)}h booked of {availableHours.toFixed(1)}h available
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
