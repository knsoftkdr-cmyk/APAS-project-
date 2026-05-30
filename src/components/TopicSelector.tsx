import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, PenLine, Loader2 } from "lucide-react";
import { useChapterSubtopics } from "@/hooks/useChapterSubtopics";

interface TopicSelectorProps {
  selectedClass: string;
  selectedSubject: string;
  selectedChapterName: string;
  value: string;
  onChange: (topic: string) => void;
  className?: string;
}

export function TopicSelector({
  selectedClass,
  selectedSubject,
  selectedChapterName,
  value,
  onChange,
  className = "",
}: TopicSelectorProps) {
  const { subtopics, isLoading, hasSubtopics } = useChapterSubtopics(
    selectedClass,
    selectedSubject,
    selectedChapterName
  );

  // Reset topic value whenever the chapter changes
  const prevChapter = useRef(selectedChapterName);
  useEffect(() => {
    if (prevChapter.current !== selectedChapterName) {
      prevChapter.current = selectedChapterName;
      onChange("");
    }
  }, [selectedChapterName, onChange]);

  const isContextReady = !!selectedClass && !!selectedSubject && !!selectedChapterName;

  // Handle dropdown change — convert special marker back to empty string
  const handleDropdownChange = (val: string) => {
    onChange(val === "__none__" ? "" : val);
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 mb-2">
        {hasSubtopics ? (
          <BookOpen className="h-3 w-3 text-primary" />
        ) : (
          <PenLine className="h-3 w-3 text-muted-foreground" />
        )}
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Topic
        </label>
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {isContextReady && hasSubtopics && !isLoading ? (
        // ── Dropdown mode ──────────────────────────────────────────
        <Select value={value === "" ? "__none__" : value} onValueChange={handleDropdownChange}>
          <SelectTrigger className="transition-all duration-300 hover:border-primary/50">
            <SelectValue placeholder="Select a topic…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              Select Topic
            </SelectItem>
            {subtopics.map((s) => (
              <SelectItem key={s.id} value={s.subtopic_name}>
                <span>
                  {s.subtopic_name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        // ── Free-text mode ─────────────────────────────────────────
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            isLoading
              ? "Loading topics…"
              : isContextReady
              ? "e.g. Photosynthesis, Fractions, The Water Cycle…"
              : "Select class, subject & chapter first…"
          }
          disabled={isLoading}
          className="transition-all duration-300 hover:border-primary/50 disabled:opacity-60"
        />
      )}

      {isContextReady && hasSubtopics && !isLoading && (
        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
          <BookOpen className="h-3 w-3" />
          {subtopics.length} predefined topic{subtopics.length !== 1 ? "s" : ""} available for this chapter
        </div>
      )}

      {isContextReady && !isLoading && !hasSubtopics && (
        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
          <PenLine className="h-3 w-3" />
          No predefined topics — type your own above
        </div>
      )}
    </div>
  );
}
