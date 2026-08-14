/**
 * AiInsightsTab.tsx
 * Top-level "AI Insights" tab — wraps LLM-driven insight sub-views:
 * Delay Prediction, Attendance Correlation, Student Travel Pattern Analysis.
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import DelayPredictionSubTab from "./DelayPredictionSubTab";
import AttendanceCorrelationSubTab from "./AttendanceCorrelationSubTab";
import StudentTravelPatternSubTab from "./StudentTravelPatternSubTab";

interface Props {
  schoolId?: string;
}

export default function AiInsightsTab({ schoolId }: Props) {
  return (
    <Tabs defaultValue="delay-prediction">
      <TabsList className="rounded-full bg-slate-100 p-1 h-9 mb-4">
        <TabsTrigger value="delay-prediction" className="text-xs rounded-full data-[state=active]:bg-blue-600 data-[state=active]:text-white">
          Delay Prediction
        </TabsTrigger>
        <TabsTrigger value="attendance-correlation" className="text-xs rounded-full data-[state=active]:bg-blue-600 data-[state=active]:text-white">
          Attendance Correlation
        </TabsTrigger>
        <TabsTrigger value="travel-patterns" className="text-xs rounded-full data-[state=active]:bg-blue-600 data-[state=active]:text-white">
          Student Travel Patterns
        </TabsTrigger>
      </TabsList>

      <TabsContent value="delay-prediction">
        <DelayPredictionSubTab schoolId={schoolId} />
      </TabsContent>

      <TabsContent value="attendance-correlation">
        <AttendanceCorrelationSubTab schoolId={schoolId} />
      </TabsContent>

      <TabsContent value="travel-patterns">
        <StudentTravelPatternSubTab schoolId={schoolId} />
      </TabsContent>
    </Tabs>
  );
}
