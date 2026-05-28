import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import loginIllustration from "@/assets/login-illustration.png";
import apasLogo from "@/assets/APAS-logo.png";

type Step = "email" | "success";

const ForgotPassword = () => {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSendResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-otp", {
        body: { email: email.trim().toLowerCase() },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || "Failed to send recovery link. Please try again.");
      }

      toast({ 
        title: "Link sent successfully!", 
        description: `A secure link has been sent to ${email}. Check your inbox.` 
      });
      
      setStep("success");
    } catch (err: any) {
      toast({ 
        title: "Could not send link", 
        description: err.message, 
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#EAF1FB] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl overflow-hidden relative">
        {/* Visual Dot Matrices */}
        <div className="absolute top-6 right-6 grid grid-cols-5 gap-1 opacity-40 pointer-events-none">
          {Array.from({ length: 25 }).map((_, i) => <div key={i} className="w-1 h-1 rounded-full bg-[#2563EB]/40" />)}
        </div>
        <div className="absolute bottom-6 right-6 grid grid-cols-5 gap-1 opacity-40 pointer-events-none">
          {Array.from({ length: 25 }).map((_, i) => <div key={i} className="w-1 h-1 rounded-full bg-[#2563EB]/40" />)}
        </div>

        <div className="grid md:grid-cols-2">
          {/* Left: Illustration */}
          <div className="hidden md:flex items-center justify-center relative bg-gradient-to-br from-[#EAF1FB] via-[#F5F8FC] to-white overflow-hidden min-h-[600px]">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 700" preserveAspectRatio="none">
              <path d="M 0,0 L 480,0 Q 560,180 500,360 Q 440,540 520,700 L 0,700 Z" fill="#DCE8F7" opacity="0.55" />
            </svg>
            <div className="relative z-10 bg-[#EAF1FB]/80 rounded-3xl p-8 backdrop-blur-sm">
              <img src={loginIllustration} alt="Students learning" className="w-full max-w-md h-auto" />
            </div>
          </div>

          {/* Right: Form Formats */}
          <div className="px-8 sm:px-14 py-12 flex flex-col justify-center">
            <div className="flex justify-center mb-8">
              <img src={apasLogo} alt="APAS Logo" className="h-24 w-auto object-contain" />
            </div>

            {/* STEP 1: Enter Email Form */}
            {step === "email" && (
              <>
                <div className="flex flex-col items-center mb-8 gap-3">
                  <div className="w-14 h-14 rounded-full bg-[#EAF1FB] flex items-center justify-center">
                    <Mail className="w-7 h-7 text-[#2563EB]" />
                  </div>
                  <h2 className="text-3xl font-semibold text-[#2C3E50] text-center" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Forgot Password?
                  </h2>
                  <p className="text-sm text-[#2C3E50]/60 text-center max-w-xs">
                    Enter your registered email and we'll send you a link to reset your password.
                  </p>
                </div>

                <form onSubmit={handleSendResetLink} className="space-y-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                      <Mail className="h-4 w-4 text-[#2C3E50]/60" />
                    </div>
                    <input
                      type="email"
                      placeholder="Registered email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full h-12 pl-14 pr-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0"
                      required
                      autoFocus
                    />
                  </div>
                  <div className="pt-2">
                    <Button type="submit" disabled={loading}
                      className="w-full h-12 rounded-md bg-[#2563EB] text-white font-semibold hover:bg-[#1d4fd8] transition-colors disabled:opacity-70">
                      {loading ? "Sending Link…" : "Send Reset Link"}
                    </Button>
                  </div>
                </form>

                <button onClick={() => navigate("/login")}
                  className="mt-6 flex items-center gap-1.5 text-sm text-[#2C3E50]/60 hover:text-[#2563EB] transition-colors mx-auto">
                  <ArrowLeft className="w-4 h-4" /> Back to Login
                </button>
              </>
            )}

            {/* STEP 2: Link Dispatched Success Block */}
            {step === "success" && (
              <div className="text-center space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                  </div>
                  <h2 className="text-3xl font-semibold text-[#2C3E50]" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Check your email
                  </h2>
                  <p className="text-sm text-[#2C3E50]/60 max-w-sm mx-auto">
                    We have sent a secure password renewal link to{" "}
                    <span className="font-semibold text-[#2C3E50]">{email}</span>.
                  </p>
                </div>

                <div className="bg-[#F5F8FC] rounded-xl p-5 border border-[#E8EEF7] text-left">
                  <p className="text-xs text-[#2C3E50]/70 leading-relaxed">
                    <strong>Next Steps:</strong> Open your email application and click <strong>"Reset password"</strong>. The link will securely authorize your session and open your password editor form.
                  </p>
                </div>

                <div className="pt-2">
                  <Button onClick={() => navigate("/login")}
                    className="w-full h-12 rounded-md bg-[#2563EB] text-white font-semibold hover:bg-[#1d4fd8] transition-colors">
                    Return to Login Screen
                  </Button>
                </div>

                <button onClick={() => setStep("email")}
                  className="text-xs font-semibold text-[#2563EB] hover:underline block mx-auto">
                  Didn't receive it? Try another email
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;