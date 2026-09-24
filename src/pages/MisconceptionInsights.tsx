import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lightbulb, AlertOctagon, TrendingUp, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useStudentMisconceptions, type StudentMisconception } from "@/hooks/useMisconceptions";

interface BookOption { id: number; subject: string; class_name: string | null }

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-blue-100 text-blue-800 border-blue-300",
};

export default function MisconceptionInsights() {
  const [books, setBooks] = useState<BookOption[]>([]);
  const [bookId, setBookId] = useState<string>("");

  useEffect(() => {
    supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject")
      .then(({ data }) => setBooks((data as BookOption[]) ?? []));
  }, []);

  const { data, isLoading } = useStudentMisconceptions({ bookId: bookId ? Number(bookId) : undefined });
  const items = data ?? [];

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Patterns to Watch</h1>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Not just wrong answers — these are the same misunderstanding showing up more than once, across different questions.
        </p>

        <Select value={bookId} onValueChange={setBookId}>
          <SelectTrigger><SelectValue placeholder="All subjects" /></SelectTrigger>
          <SelectContent>
            {books.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.subject}{b.class_name ? ` · ${b.class_name}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isLoading && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </CardContent></Card>
        )}

        {!isLoading && items.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <TrendingUp className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="font-medium">No repeated patterns found</p>
              <p className="text-sm text-muted-foreground">
                Nothing's shown up more than once yet — that's a good sign, or you just need a bit more practice history.
              </p>
            </CardContent>
          </Card>
        )}

        {items.map((m) => <MisconceptionCard key={m.misconception_id} m={m} />)}
      </div>
    </AppLayout>
  );
}

function MisconceptionCard({ m }: { m: StudentMisconception }) {
  return (
    <Card className="border-2">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-1">
          <Badge variant="outline" className={cn("text-[11px] gap-1", SEVERITY_STYLES[m.severity])}>
            <AlertOctagon className="h-3 w-3" /> {m.severity} priority
          </Badge>
          <span>{m.subject} · {m.chapter_name} · {m.topic_name}</span>
        </div>
        <CardTitle className="text-base leading-relaxed">{m.misconception_text}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {m.why_it_happens && (
          <p className="text-sm text-muted-foreground">{m.why_it_happens}</p>
        )}
        {m.correction_hint && (
          <div className="flex items-start gap-2 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md p-3">
            <Lightbulb className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{m.correction_hint}</span>
          </div>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
          <span className="flex items-center gap-1"><Repeat className="h-3 w-3" /> Seen {m.occurrence_count} times across {m.distinct_items} question{m.distinct_items === 1 ? "" : "s"}</span>
          <span>· last {formatDistanceToNow(new Date(m.last_seen_at), { addSuffix: true })}</span>
        </div>
      </CardContent>
    </Card>
  );
}
