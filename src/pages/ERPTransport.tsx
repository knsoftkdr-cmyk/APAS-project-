import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bus, UserRound, Route as RouteIcon, Users, MapPin, Wand2, MapPinned, ClipboardList, Siren } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ERPLayout from "@/components/erp/ERPLayout";
import { VehiclesTab, DriversTab, AttendantsTab, RoutesTab, AssignmentsTab } from "@/pages/TransportManagement";
import { SosAlertBanner } from "@/components/transport/SosAlertBanner";
import { GeofenceZonesTab } from "@/components/transport/GeofenceZonesTab";
import { MultiRoutePlanner } from "@/components/transport/MultiRoutePlanner";
import { TripsTab } from "@/components/transport/TripsTab";
import { BoardingDropManagementTab } from "@/components/transport/BoardingDropManagementTab";
import { EmergencyManagementTab } from "@/components/transport/EmergencyManagementTab";

const ERPTransport = () => {
  const navigate = useNavigate();

  const [schoolId, setSchoolId] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate("/login");
        return;
      }

      const { data: profileData, error } = await supabase
        .from("profiles")
        .select("erp_access, school_id, schools(name)")
        .eq("id", sessionData.session.user.id)
        .single();

      if (error || !profileData || profileData.erp_access !== true) {
        navigate("/dashboard");
        return;
      }

      const sid = (profileData as any).school_id as string;
      const school = (profileData as any).schools;
      setSchoolId(sid);
      setOrgName(school?.name ?? "Your Organization");
      setLoading(false);
    };

    init();
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-400 text-sm">Loading your workspace...</p>
      </div>
    );
  }

  return (
    <ERPLayout orgName={orgName} activePath="/erp/transport" tabLabel="Transport">
      <SosAlertBanner />
      <Tabs defaultValue="vehicles" className="space-y-4">
        <TabsList className="grid w-full grid-cols-9 max-w-6xl">
          <TabsTrigger value="vehicles" className="gap-1.5">
            <Bus className="h-4 w-4" /> Vehicles
          </TabsTrigger>
          <TabsTrigger value="drivers" className="gap-1.5">
            <UserRound className="h-4 w-4" /> Driver & Attendant
          </TabsTrigger>
          <TabsTrigger value="routes" className="gap-1.5">
            <RouteIcon className="h-4 w-4" /> Routes & Stops
          </TabsTrigger>
          <TabsTrigger value="assignments" className="gap-1.5">
            <Users className="h-4 w-4" /> Student Assignment
          </TabsTrigger>
          <TabsTrigger value="geofencing" className="gap-1.5">
            <MapPin className="h-4 w-4" /> Geofencing
          </TabsTrigger>
          <TabsTrigger value="multiroute" className="gap-1.5">
            <Wand2 className="h-4 w-4" /> Multi-Route
          </TabsTrigger>
          <TabsTrigger value="trips" className="gap-1.5">
            <MapPinned className="h-4 w-4" /> Trips
          </TabsTrigger>
          <TabsTrigger value="boardinglogs" className="gap-1.5">
            <ClipboardList className="h-4 w-4" /> Boarding & Drop
          </TabsTrigger>
          <TabsTrigger value="emergency" className="gap-1.5">
            <Siren className="h-4 w-4" /> Emergency
          </TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles">
          <VehiclesTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="drivers" className="space-y-6">
          <DriversTab schoolId={schoolId} />
          <AttendantsTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="routes">
          <RoutesTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="assignments">
          <AssignmentsTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="multiroute">
          <MultiRoutePlanner schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="trips">
          <TripsTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="boardinglogs">
          <BoardingDropManagementTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="emergency">
          <EmergencyManagementTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="geofencing">
          <GeofenceZonesTab schoolId={schoolId} />
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
};

export default ERPTransport;
