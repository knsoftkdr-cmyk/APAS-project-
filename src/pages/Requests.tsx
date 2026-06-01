import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { TeacherRequestForm } from "@/components/TeacherRequestForm";
import requestsBanner from "@/assets/request-banner.png"; 

const Requests = () => {
  return (
<AppLayout>
      <div className="space-y-6">
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-[#EDE9FE] via-[#DDD6FE] to-[#C4B5FD] p-8 relative min-h-[220px]">

          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>

                    <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>


          <div className="max-w-xl">
            <h1 className="text-5xl font-bold text-slate-900">
              Diagnostic Requests
            </h1>

            <p className="mt-3 text-slate-700 text-lg">
              Request and track diagnostic questionnaires for your classes
            </p>
          </div>

          <img
            src={requestsBanner}
            alt="Requests Banner"
            className="absolute right-10 bottom-6 h-[160px]"
          />
        </div>
       <TeacherRequestForm />
      </div>
    </AppLayout>
  );
};

export default Requests;
