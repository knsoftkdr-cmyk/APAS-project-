/**
 * AiInsightsTab.tsx
 * Top-level "AI Insights" tab — wraps LLM-driven insight sub-views.
 * Currently: Delay Prediction. Attendance Correlation and Student Travel
 * Pattern Analysis come in later passes.
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import DelayPredictionSubTab from "./DelayPredictionSubTab";

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
      </TabsList>

      <TabsContent value="delay-prediction">
        <DelayPredictionSubTab schoolId={schoolId} />
      </TabsContent>
    </Tabs>
  );
}
