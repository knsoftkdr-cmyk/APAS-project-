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
import { IncidentManagementTab } from "@/components/transport/IncidentManagementTab";
import { VehicleMaintenanceTab } from "@/components/transport/VehicleMaintenanceTab";
import { FuelManagementTab } from "@/components/transport/FuelManagementTab";
import { DriverBehaviourAnalyticsTab } from "@/components/transport/DriverBehaviourAnalyticsTab";
import { SpeedMonitoringTab } from "@/components/transport/SpeedMonitoringTab";
import { RouteDeviationTab } from "@/components/transport/RouteDeviationTab";
import WeatherTab from "@/components/transport/WeatherTab";
import BusOccupancyTab from "@/components/transport/BusOccupancyTab";
import AnalyticsDashboardTab from "@/components/transport/AnalyticsDashboardTab";
import AiInsightsTab from "@/components/transport/AiInsightsTab";
import ExecutiveDashboardTab from "@/components/transport/ExecutiveDashboardTab";
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
        <TabsList className="flex flex-wrap h-auto gap-1.5 bg-slate-100/70 p-1.5 rounded-xl">
          <TabsTrigger value="vehicles" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            <Bus className="h-4 w-4" /> Vehicles
          </TabsTrigger>
          <TabsTrigger value="drivers" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            <UserRound className="h-4 w-4" /> Driver & Attendant
          </TabsTrigger>
          <TabsTrigger value="routes" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            <RouteIcon className="h-4 w-4" /> Routes & Stops
          </TabsTrigger>
          <TabsTrigger value="assignments" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            <Users className="h-4 w-4" /> Student Assignment
          </TabsTrigger>
          <TabsTrigger value="geofencing" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            <MapPin className="h-4 w-4" /> Geofencing
          </TabsTrigger>
          <TabsTrigger value="multiroute" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            <Wand2 className="h-4 w-4" /> Multi-Route
          </TabsTrigger>
          <TabsTrigger value="trips" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            <MapPinned className="h-4 w-4" /> Trips
          </TabsTrigger>
          <TabsTrigger value="boardinglogs" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            <ClipboardList className="h-4 w-4" /> Boarding & Drop
          </TabsTrigger>
          <TabsTrigger value="incidents" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            Incidents
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="fuel" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            Fuel
          </TabsTrigger>
          <TabsTrigger value="behaviour" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            Driver Behaviour
          </TabsTrigger>
          <TabsTrigger value="speedmonitoring" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            Speed Monitoring
          </TabsTrigger>
          <TabsTrigger value="routedeviation" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            Route Deviation
          </TabsTrigger>
          <TabsTrigger value="weather" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            Weather
          </TabsTrigger>
          <TabsTrigger value="occupancy" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
            Bus Occupancy
          </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              Analytics Dashboard
            </TabsTrigger>
            <TabsTrigger value="aiinsights" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              AI Insights
            </TabsTrigger>
            <TabsTrigger value="executive" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
              Executive Dashboard
            </TabsTrigger>
          <TabsTrigger value="emergency" className="gap-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 transition-all duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-lg hover:bg-slate-50 hover:text-slate-800 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:border-blue-600 data-[state=active]:shadow-sm">
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
        <TabsContent value="incidents">
          <IncidentManagementTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="maintenance">
          <VehicleMaintenanceTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="fuel">
          <FuelManagementTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="behaviour">
          <DriverBehaviourAnalyticsTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="speedmonitoring">
          <SpeedMonitoringTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="routedeviation">
          <RouteDeviationTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="weather">
          <WeatherTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="occupancy">
          <BusOccupancyTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsDashboardTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="aiinsights">
          <AiInsightsTab schoolId={schoolId} />
        </TabsContent>
        <TabsContent value="executive">
          <ExecutiveDashboardTab schoolId={schoolId} />
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
