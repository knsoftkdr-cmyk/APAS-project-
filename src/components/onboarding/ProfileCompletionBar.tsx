import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sparkles, ArrowRight } from "lucide-react";

interface Props {
  percent: number;
  missing: string[];
}

export function ProfileCompletionBar({ percent, missing }: Props) {
  if (percent >= 100) return null;
  return (
    <div className="mb-4 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-transparent p-4 animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Your profile is {percent}% complete
            </p>
            <p className="text-xs text-muted-foreground">
              Complete your profile to get a better personalized experience
              {missing.length > 0 && <> — missing: {missing.slice(0, 3).join(", ")}{missing.length > 3 ? "…" : ""}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:w-72">
          <Progress value={percent} className="h-2 flex-1" />
          <Button size="sm" className="flex-shrink-0 bg-blue-500 hover:bg-blue-700 text-white" asChild>
            <Link to="/settings">
              Complete <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
