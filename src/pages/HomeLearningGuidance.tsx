import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Lightbulb, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { getMyChildren, type ChildOption } from "@/lib/appointments";
import { groupTipsByArea, guidanceForClass } from "@/lib/homeLearningModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomeLearningGuidance() {
  const { profile } = useAuth();
  const parentId = profile?.id;

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!parentId) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    getMyChildren(parentId)
      .then((kids) => {
        if (cancelled) return;
        setChildren(kids);
        setSelectedId((current) => (kids.some((k) => k.studentId === current) ? current : kids[0]?.studentId ?? ""));
      })
      .catch((error) => {
        console.error("Failed to load children for home learning guidance:", error);
        if (!cancelled) {
          setLoadFailed(true);
          toast.error("Couldn't load your children's details");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parentId, attempt]);

  const selected = children.find((c) => c.studentId === selectedId);
  const guidance = useMemo(() => (selected ? guidanceForClass(selected.className) : null), [selected]);
  const groups = useMemo(() => (guidance ? groupTipsByArea(guidance.tips) : []), [guidance]);

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-primary" aria-hidden="true" />
            Home learning guidance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Simple things you can do at home to support your child, chosen for their class.
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your children's details
          </div>
        )}

        {!loading && loadFailed && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-sm">We couldn't load your children's details. Check your connection and try again.</p>
              <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {!loading && !loadFailed && children.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No children are linked to your account yet. Ask the school office to link your child, then come back here.
            </CardContent>
          </Card>
        )}

        {!loading && !loadFailed && selected && guidance && (
          <>
            {children.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a child">
                {children.map((child) => (
                  <Button
                    key={child.studentId}
                    variant={child.studentId === selectedId ? "default" : "outline"}
                    size="sm"
                    aria-pressed={child.studentId === selectedId}
                    onClick={() => setSelectedId(child.studentId)}
                  >
                    {child.fullName}
                  </Button>
                ))}
              </div>
            )}

            <p className="text-sm text-muted-foreground" aria-live="polite">
              Suggestions for {selected.fullName}: {guidance.bandLabel}.
              {guidance.band === "general" && " We couldn't read the class, so these suggestions suit all classes."}
            </p>

            {groups.map((group) => (
              <section key={group.area} className="space-y-3" aria-labelledby={`area-${group.area}`}>
                <h2 id={`area-${group.area}`} className="text-lg font-medium">{group.label}</h2>
                {group.tips.map((tip) => (
                  <Card key={tip.id}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{tip.title}</CardTitle>
                      <CardDescription>{tip.time}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm">{tip.action}</p>
                      {tip.link && (
                        <Button asChild variant="outline" size="sm">
                          <Link to={tip.link.path}>{tip.link.label}</Link>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </section>
            ))}

            <p className="text-sm text-muted-foreground">
              These are general suggestions for your child's class. They don't use your child's marks. For advice about
              your child's own progress, book a meeting with the teacher.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
