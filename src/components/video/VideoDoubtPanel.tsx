// Doubt panel shown INSIDE the student's video player: ask a question about the part you are watching without
// leaving the video. Doubts go to the teacher (and get an instant AI draft answer); answers appear right here.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, GraduationCap, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { fetchVideoDoubts, formatTimestamp, postVideoDoubt } from "@/lib/interactiveVideo";

interface Props {
  listingId: string;
  /** Current playback time, read when the doubt is sent so it is attached to the right moment. */
  getTime: () => number;
  onSeek?: (seconds: number) => void;
  /** Called after a doubt was sent (the player pauses so the student can read the answer). */
  onAsked?: () => void;
}

export function VideoDoubtPanel({ listingId, getTime, onSeek, onAsked }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const key = ["video-doubts", listingId];

  const list = useQuery({ queryKey: key, queryFn: () => fetchVideoDoubts(listingId), staleTime: 15_000, refetchInterval: 60_000 });

  const send = useMutation({
    mutationFn: () => postVideoDoubt(listingId, Math.floor(getTime()), text.trim()),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: key });
      toast.success("Doubt sent to your teacher");
      onAsked?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send your doubt"),
  });

  const doubts = list.data?.doubts ?? [];
  const canSend = text.trim().length >= 3 && !send.isPending;

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-blue-100 bg-white p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-blue-950">
        <MessageCircleQuestion className="h-4 w-4 text-blue-600" /> Ask a doubt
      </div>

      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Not sure about something? Ask here. Your question is saved with the moment you are watching."
          className="resize-none text-sm"
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSend) send.mutate(); }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">at {formatTimestamp(getTime())}</span>
          <Button size="sm" className="rounded-full bg-blue-600 hover:bg-blue-700" disabled={!canSend} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Send className="me-1 h-3.5 w-3.5" />}
            {send.isPending ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pe-1" style={{ maxHeight: "22rem" }}>
        {list.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading your doubts...</p>
        ) : doubts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">Your doubts and the answers will show up here.</p>
        ) : doubts.map((d) => (
          <div key={d.id} className="space-y-1.5 rounded-lg border bg-slate-50/70 p-2.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words text-slate-800">{d.question_text}</p>
              <button type="button" onClick={() => onSeek?.(d.timestamp_seconds)} className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-200" title="Jump to this moment">
                {formatTimestamp(d.timestamp_seconds)}
              </button>
            </div>
            {d.answer_text && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                <div className="mb-0.5 flex items-center gap-1 font-semibold"><GraduationCap className="h-3.5 w-3.5" /> Teacher</div>
                <p className="whitespace-pre-wrap break-words">{d.answer_text}</p>
              </div>
            )}
            {d.ai_answer && (
              <div className="rounded-md border border-violet-200 bg-violet-50 p-2 text-xs text-violet-900">
                <div className="mb-0.5 flex items-center gap-1 font-semibold"><Bot className="h-3.5 w-3.5" /> Quick AI answer</div>
                <p className="whitespace-pre-wrap break-words">{d.ai_answer}</p>
              </div>
            )}
            {!d.answer_text && <Badge variant="outline" className="rounded-full text-[10px]">Waiting for your teacher</Badge>}
          </div>
        ))}
      </div>
    </div>
  );
}
