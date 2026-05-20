import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ThumbsUp, ThumbsDown, MessageSquare } from "lucide-react";

interface AIResponseFeedbackProps {
  aiResponseId: string;
  taskType: string;
  confidenceScore: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: () => void;
}

export const AIResponseFeedback = ({
  aiResponseId,
  taskType,
  confidenceScore,
  open,
  onOpenChange,
  onSubmit,
}: AIResponseFeedbackProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isAccurate, setIsAccurate] = useState<boolean | null>(null);
  const [valueRating, setValueRating] = useState(3);
  const [feedback, setFeedback] = useState("");
  const [correction, setCorrection] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isAccurate === null) {
      toast.error("Please rate accuracy");
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-feedback-learning-loop`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "user_id": user?.id,
          },
          body: JSON.stringify({
            action: "submit_feedback",
            ai_usage_log_id: aiResponseId,
            task_type: taskType,
            confidence_score: confidenceScore,
            is_accurate: isAccurate,
            teacher_feedback: feedback,
            correction_provided: correction,
            value_rating: valueRating,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to submit");
      toast.success("Feedback recorded - AI will learn from this!");
      setIsAccurate(null);
      setValueRating(3);
      setFeedback("");
      setCorrection("");
      onOpenChange(false);
      onSubmit?.();
    } catch (e) {
      console.error("Error submitting feedback:", e);
      toast.error("Failed to submit feedback");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share Feedback on AI Response</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">Help improve AI quality through feedback</p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Accuracy Rating */}
          <div>
            <Label className="font-semibold mb-2 block">Was this response accurate?</Label>
            <div className="flex gap-2">
              <Button
                variant={isAccurate === true ? "default" : "outline"}
                onClick={() => setIsAccurate(true)}
                className="flex-1 gap-2"
              >
                <ThumbsUp className="h-4 w-4" /> Yes, accurate
              </Button>
              <Button
                variant={isAccurate === false ? "destructive" : "outline"}
                onClick={() => setIsAccurate(false)}
                className="flex-1 gap-2"
              >
                <ThumbsDown className="h-4 w-4" /> No, inaccurate
              </Button>
            </div>
          </div>

          {/* Value Rating */}
          <div>
            <Label className="font-semibold">How valuable was this response?</Label>
            <div className="flex gap-1 mt-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <Button
                  key={rating}
                  variant={valueRating === rating ? "default" : "outline"}
                  size="sm"
                  onClick={() => setValueRating(rating)}
                  className="flex-1"
                >
                  {rating}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">1 = Not helpful, 5 = Very helpful</p>
          </div>

          {/* Teacher Feedback */}
          <div>
            <Label htmlFor="feedback" className="font-semibold">
              Your observations
            </Label>
            <Textarea
              id="feedback"
              placeholder="What could be improved? Any specific issues?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-20"
            />
          </div>

          {/* Correction if Inaccurate */}
          {isAccurate === false && (
            <div>
              <Label htmlFor="correction" className="font-semibold">
                What should the correct answer have been?
              </Label>
              <Textarea
                id="correction"
                placeholder="Provide the correct information so AI can learn..."
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                className="min-h-20"
              />
            </div>
          )}

          {/* Confidence Info */}
          <div className="bg-muted p-3 rounded text-sm">
            <p className="font-medium mb-1">AI Confidence: {(confidenceScore * 100).toFixed(0)}%</p>
            <p className="text-muted-foreground text-xs">
              {confidenceScore > 0.8
                ? "High confidence - AI was very sure about this response"
                : confidenceScore > 0.6
                ? "Moderate confidence - AI had some uncertainty"
                : "Low confidence - AI was uncertain about this response"}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || isAccurate === null}>
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageSquare className="h-4 w-4 mr-2" />}
            Submit Feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
