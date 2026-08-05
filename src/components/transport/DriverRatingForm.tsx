import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Star, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface DriverRatingFormProps {
  schoolId: string | null;
  parentId: string | null;
  driverId: string | null;
  studentId: string | null;
  routeId: string | null;
}

export function DriverRatingForm({ schoolId, parentId, driverId, studentId, routeId }: DriverRatingFormProps) {
  const [loading, setLoading] = useState(true);
  const [semesterId, setSemesterId] = useState<string | null>(null);
  const [existingRating, setExistingRating] = useState<{ rating: number; comment: string | null } | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!schoolId || !parentId || !driverId) { setLoading(false); return; }
    (async () => {
      const { data: semesterRow } = await supabase
        .from("academic_semesters")
        .select("id")
        .eq("school_id", schoolId)
        .eq("status", "active")
        .maybeSingle();

      if (!semesterRow) { setSemesterId(null); setLoading(false); return; }
      setSemesterId(semesterRow.id);

      const { data: existing } = await supabase
        .from("driver_ratings")
        .select("rating, comment")
        .eq("driver_id", driverId)
        .eq("parent_id", parentId)
        .eq("semester_id", semesterRow.id)
        .maybeSingle();

      if (existing) setExistingRating(existing);
      setLoading(false);
    })();
  }, [schoolId, parentId, driverId]);

  const handleSubmit = async () => {
    if (!schoolId || !parentId || !driverId || !semesterId || rating === 0) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("driver_ratings").insert({
        school_id: schoolId,
        driver_id: driverId,
        parent_id: parentId,
        student_id: studentId,
        route_id: routeId,
        semester_id: semesterId,
        rating,
        comment: comment.trim() || null,
      });
      if (error) throw error;
      setExistingRating({ rating, comment: comment.trim() || null });
      toast.success("Thanks for rating your driver!");
    } catch (err: any) {
      toast.error(err.message || "Failed to submit rating");
    } finally {
      setSubmitting(false);
    }
  };

  if (!driverId || loading) return null;

  if (!semesterId) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-100 bg-white p-4 text-sm text-muted-foreground">
        Driver ratings open once the current semester is active.
      </div>
    );
  }

  if (existingRating) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-100 bg-white p-4">
        <p className="text-sm font-semibold text-emerald-900 mb-2">You rated this driver this semester</p>
        <div className="flex items-center gap-1 mb-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className={`h-5 w-5 ${n <= existingRating.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
          ))}
        </div>
        {existingRating.comment && <p className="text-sm text-muted-foreground">{existingRating.comment}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-emerald-100 bg-white p-4">
      <p className="text-sm font-semibold text-emerald-900 mb-2">Rate your driver this semester</p>
      <div className="flex items-center gap-1 mb-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)}>
            <Star className={`h-6 w-6 transition-colors ${n <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300 hover:text-yellow-300"}`} />
          </button>
        ))}
      </div>
      <textarea
        placeholder="Optional comment about your experience..."
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="w-full text-sm border border-emerald-100 rounded-lg px-3 py-2 mb-3 resize-none"
        rows={2}
      />
      <Button onClick={handleSubmit} disabled={rating === 0 || submitting} size="sm">
        {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
        Submit Rating
      </Button>
    </div>
  );
}
