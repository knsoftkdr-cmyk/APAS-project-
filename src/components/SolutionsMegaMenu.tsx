import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ArrowRight } from "lucide-react";
import { solutions } from "@/data/solutions";

interface SolutionsMegaMenuProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

const SolutionsMegaMenu = ({ open, onToggle, onClose }: SolutionsMegaMenuProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex items-center gap-1 hover:text-blue-600 transition-colors ${
          open ? "text-blue-600" : ""
        }`}
      >
        Solutions
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-[250ms] ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Mega dropdown panel */}
      <div
        role="menu"
        className={`absolute left-1/2 top-full mt-4 w-[min(92vw,720px)] -translate-x-1/2 origin-top rounded-3xl border border-blue-100 bg-white/95 backdrop-blur-xl shadow-2xl shadow-blue-900/10 transition-all duration-[250ms] ease-out ${
          open
            ? "opacity-100 translate-y-0 visible pointer-events-auto"
            : "opacity-0 -translate-y-2 invisible pointer-events-none"
        }`}
      >
        <div className="p-6">
          <div className="mb-4 px-1">
            <div className="text-xs font-semibold uppercase tracking-widest text-blue-600">
              Education ERP Solutions
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Everything your institution needs, unified in one AI-powered platform.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {solutions.map((solution) => {
              const Icon = solution.icon;
              return (
                <Link
                  key={solution.slug}
                  to={`/solutions/${solution.slug}`}
                  onClick={onClose}
                  role="menuitem"
                  className="group flex items-start gap-3 rounded-2xl p-3 cursor-pointer border border-transparent hover:border-blue-100 hover:bg-blue-50/70 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                >
                  <div
                    className={`shrink-0 w-11 h-11 rounded-xl ${solution.iconBg} flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform`}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm text-slate-900">
                        {solution.title}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-blue-500 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500 line-clamp-2">
                      {solution.cardDesc}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-blue-50 flex items-center justify-between px-1">
          </div>
        </div>
      </div>
    </div>
  );
};

export default SolutionsMegaMenu;
