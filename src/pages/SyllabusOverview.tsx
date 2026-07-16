import { AppLayout } from "@/components/layout/AppLayout";
import SchoolSyllabusOverview from "@/components/SchoolSyllabusOverview";
import { TrendingUp } from "lucide-react";

export default function SyllabusOverview() {
  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        {/* Layered waves at top */}
        <svg className="absolute top-0 left-0 w-full h-48 opacity-[0.07]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0,90 C240,150 480,30 720,70 C960,110 1200,30 1440,80 L1440,0 L0,0 Z" fill="#4f46e5" />
        </svg>
        <svg className="absolute top-0 left-0 w-full h-36 opacity-[0.06]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0,50 C320,120 720,10 1440,60 L1440,0 L0,0 Z" fill="#3b82f6" />
        </svg>

        <div className="relative z-10 p-4 md:p-6 space-y-5 md:space-y-6 max-w-5xl mx-auto">
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-blue-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-start md:items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <TrendingUp className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Syllabus Coverage</h1>
                <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Track how much of the syllabus each teacher has covered, by class and subject.</p>
              </div>
            </div>
          </div>

          <SchoolSyllabusOverview />
        </div>
      </div>
    </AppLayout>
  );
}
