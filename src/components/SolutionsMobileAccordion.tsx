import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { solutions } from "@/data/solutions";

interface SolutionsMobileAccordionProps {
  onNavigate: () => void;
}

const SolutionsMobileAccordion = ({ onNavigate }: SolutionsMobileAccordionProps) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-slate-100 pb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-1"
      >
        <span>Solutions</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-[250ms] ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div
        className={`grid transition-all duration-[250ms] ease-out ${
          open ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-1 pl-2">
            {solutions.map((solution) => {
              const Icon = solution.icon;
              return (
                <Link
                  key={solution.slug}
                  to={`/solutions/${solution.slug}`}
                  onClick={onNavigate}
                  className="flex items-center gap-3 py-2 text-slate-600"
                >
                  <div
                    className={`shrink-0 w-8 h-8 rounded-lg ${solution.iconBg} flex items-center justify-center`}
                  >
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm font-medium">{solution.title}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SolutionsMobileAccordion;
