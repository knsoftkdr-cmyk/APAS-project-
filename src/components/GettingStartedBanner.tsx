import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GraduationCap, ArrowRight, X } from "lucide-react";
import { useState } from "react";

export function GettingStartedBanner() {
  const { profile } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="mb-6 rounded-lg border border-accent/30 bg-accent/5 p-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15">
            <GraduationCap className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">
              Welcome to APAS{profile?.full_name ? `, ${profile.full_name}` : ""}! 🎉
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Get started by completing your learning style assessment in the Diagnostic phase.
              This will help us personalise your lesson plans.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" asChild>
                <Link to="/diagnostic">
                  Start Assessment <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-button p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
