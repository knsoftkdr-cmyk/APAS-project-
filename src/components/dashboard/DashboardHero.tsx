import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { GraduationCap, CalendarDays, Sparkles } from "lucide-react";

export const DashboardHero = ({
  eyebrow, greeting, name, dateLabel, description, actions,
}: {
  eyebrow: string;
  greeting: string;
  name: string;
  dateLabel: string;
  description: string;
  actions?: ReactNode;
}) => {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-700 via-blue-600 to-cyan-500 px-5 py-6 md:px-9 md:py-10 text-white shadow-elevated">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-90">
        <div className="absolute -top-10 -right-10 h-56 w-56 rounded-full bg-blue-400/10 blur-2xl" />
        <div className="absolute bottom-0 right-24 h-32 w-32 rounded-full bg-indigo-300/10 blur-xl" />
        <div className="absolute top-10 right-72 h-2 w-2 rounded-full bg-white/40" />
        <div className="absolute top-24 right-52 h-1.5 w-1.5 rounded-full bg-white/30" />
        <div className="absolute bottom-14 right-96 h-1.5 w-1.5 rounded-full bg-white/30" />
      </div>

      <div className="relative flex flex-col md:flex-row md:items-start md:justify-between gap-5 md:gap-6">
        <div className="max-w-xl">
          <div className="flex items-center gap-2 mb-2.5 md:mb-3">
            <div className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center">
              <GraduationCap className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-[11px] font-semibold text-blue-200 uppercase tracking-[0.15em]">
              {eyebrow}
            </span>
          </div>
          <h1 className="text-2xl md:text-[2.25rem] font-bold tracking-tight leading-tight">
            {greeting}, {name}
          </h1>
          <p className="text-sm text-blue-100/80 mt-1.5">{dateLabel}</p>
          <p className="text-sm text-blue-100/90 mt-3 leading-relaxed max-w-lg">{description}</p>
        </div>

        {actions ? (
          <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const HeroCalendarButton = () => (
  <Link to="/academic-calendar" className="flex-1 md:flex-none">
    <Button variant="secondary" size="sm" className="w-full gap-1.5 bg-white/10 text-white border border-white/20 hover:bg-white/20">
      <CalendarDays className="h-4 w-4" />
      Calendar
    </Button>
  </Link>
);

export const HeroPrimaryButton = ({ to, label }: { to: string; label: string }) => (
  <Link to={to} className="flex-1 md:flex-none">
    <Button size="sm" className="w-full gap-1.5 bg-white text-indigo-700 hover:bg-blue-50 shadow-sm">
      <Sparkles className="h-4 w-4" />
      {label}
    </Button>
  </Link>
);
