import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "blue" | "orange" | "purple" | "emerald" | "pink" | "amber";

const TONES: Record<Accent, { chip: string; link: string; glow: string; wash: string; border: string }> = {
  blue: {
    chip: "bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-sm shadow-blue-200",
    link: "text-blue-600",
    glow: "bg-blue-400/15",
    wash: "bg-gradient-to-br from-blue-50/80 via-white to-white",
    border: "border-blue-200 group-hover:border-blue-300",
  },
  orange: {
    chip: "bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-200",
    link: "text-orange-600",
    glow: "bg-orange-400/15",
    wash: "bg-gradient-to-br from-orange-50/80 via-white to-white",
    border: "border-orange-200 group-hover:border-orange-300",
  },
  purple: {
    chip: "bg-gradient-to-br from-purple-500 to-violet-500 text-white shadow-sm shadow-purple-200",
    link: "text-purple-600",
    glow: "bg-purple-400/15",
    wash: "bg-gradient-to-br from-purple-50/80 via-white to-white",
    border: "border-purple-200 group-hover:border-purple-300",
  },
  emerald: {
    chip: "bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-200",
    link: "text-emerald-600",
    glow: "bg-emerald-400/15",
    wash: "bg-gradient-to-br from-emerald-50/80 via-white to-white",
    border: "border-emerald-200 group-hover:border-emerald-300",
  },
  pink: {
    chip: "bg-gradient-to-br from-pink-500 to-rose-500 text-white shadow-sm shadow-pink-200",
    link: "text-pink-600",
    glow: "bg-pink-400/15",
    wash: "bg-gradient-to-br from-pink-50/80 via-white to-white",
    border: "border-pink-200 group-hover:border-pink-300",
  },
  amber: {
    chip: "bg-gradient-to-br from-amber-500 to-yellow-500 text-white shadow-sm shadow-amber-200",
    link: "text-amber-600",
    glow: "bg-amber-400/15",
    wash: "bg-gradient-to-br from-amber-50/80 via-white to-white",
    border: "border-amber-200 group-hover:border-amber-300",
  },
};

export const DashStatCard = ({
  label, value, icon: Icon, accent, linkTo, linkLabel, loading,
}: {
  label: string;
  value: number | string;
  icon: any;
  accent: Accent;
  linkTo?: string;
  linkLabel?: string;
  loading?: boolean;
}) => {
  const tones = TONES[accent];

  return (
    <Card className={cn(
      "group relative overflow-hidden border-[4px] shadow-card hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300 rounded-2xl",
      tones.wash,
      tones.border
    )}>
      <div className={cn("absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl transition-transform duration-500 group-hover:scale-125", tones.glow)} />
      <div className={cn("absolute -bottom-10 -left-10 w-28 h-28 rounded-full blur-3xl opacity-60 transition-transform duration-500 group-hover:scale-110", tones.glow)} />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-2 mb-5">
          <div className="relative">
            <div className={cn("absolute inset-0 rounded-2xl blur-md opacity-60 scale-90 transition-transform duration-300 group-hover:scale-100", tones.chip)} />
            <div className={cn("relative rounded-2xl p-3 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3", tones.chip)}>
              <Icon className="h-5 w-5" />
            </div>
          </div>
          {linkTo && linkLabel ? (
            <Link
              to={linkTo}
              className={cn("text-xs font-semibold inline-flex items-center gap-1 hover:gap-1.5 transition-all shrink-0 mt-1.5 bg-white/70 backdrop-blur-sm px-2.5 py-1 rounded-full shadow-sm", tones.link)}
            >
              {linkLabel} →
            </Link>
          ) : null}
        </div>
        <p className="text-3xl font-bold text-foreground">{loading ? "-" : value}</p>
        <p className="text-sm text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
};
