import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, ArrowLeft, ShieldCheck, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import loginIllustration from "@/assets/login-illustration.png";
import apasLogo from "@/assets/APAS-logo.png";

type Step = "email" | "otp";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

const ForgotPassword = () => {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  const sendOtp = async (emailAddr: string) => {
    const { data, error } = await supabase.functions.invoke("send-otp", {
      body: { email: emailAddr.trim().toLowerCase() },
    });
    if (error || !data?.success) {
      throw new Error(data?.error || "Failed to send OTP. Please try again.");
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await sendOtp(email);
      toast({ title: "OTP sent!", description: `A 6-digit code was sent to ${email}. Check your inbox.` });
      setResendCooldown(RESEND_COOLDOWN);
      setStep("otp");
    } catch (err: any) {
      toast({ title: "Could not send OTP", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    try {
      await sendOtp(email);
      setOtp(Array(OTP_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
      setResendCooldown(RESEND_COOLDOWN);
      toast({ title: "OTP resent!", description: "A new code was sent to your email." });
    } catch (err: any) {
      toast({ title: "Resend failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (token: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-otp", {
        body: { email: email.trim().toLowerCase(), code: token },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || "Invalid or expired OTP.");
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (sessionError) throw sessionError;

      toast({ title: "Verified!", description: "You are now logged in." });
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
      setOtp(Array(OTP_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);
    if (digit && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
    if (digit && index === OTP_LENGTH - 1 && newOtp.every((d) => d !== "")) {
      verifyOtp(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (otp[index]) {
        const newOtp = [...otp]; newOtp[index] = ""; setOtp(newOtp);
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    const newOtp = Array(OTP_LENGTH).fill("");
    pasted.split("").forEach((char, i) => { newOtp[i] = char; });
    setOtp(newOtp);
    inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
    if (pasted.length === OTP_LENGTH) verifyOtp(pasted);
  };

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = otp.join("");
    if (token.length < OTP_LENGTH) {
      toast({ title: "Incomplete code", description: "Please enter all 6 digits.", variant: "destructive" });
      return;
    }
    verifyOtp(token);
  };

  return (
    <div className="min-h-screen bg-[#EAF1FB] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl overflow-hidden relative">
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

          {/* Right: Form */}
          <div className="px-8 sm:px-14 py-12 flex flex-col justify-center">
            <div className="flex justify-center mb-8">
              <img src={apasLogo} alt="APAS Logo" className="h-24 w-auto object-contain" />
            </div>

            {/* STEP 1: Email */}
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
                    Enter your registered email and we'll send you a 6-digit login code.
                  </p>
                </div>

                <form onSubmit={handleSendOtp} className="space-y-4">
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
                      {loading ? "Sending OTP…" : "Send OTP"}
                    </Button>
                  </div>
                </form>

                <button onClick={() => navigate("/login")}
                  className="mt-6 flex items-center gap-1.5 text-sm text-[#2C3E50]/60 hover:text-[#2563EB] transition-colors mx-auto">
                  <ArrowLeft className="w-4 h-4" /> Back to Login
                </button>
              </>
            )}

            {/* STEP 2: OTP */}
            {step === "otp" && (
              <>
                <div className="flex flex-col items-center mb-8 gap-3">
                  <div className="w-14 h-14 rounded-full bg-[#EAF1FB] flex items-center justify-center">
                    <ShieldCheck className="w-7 h-7 text-[#2563EB]" />
                  </div>
                  <h2 className="text-3xl font-semibold text-[#2C3E50] text-center" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Enter OTP
                  </h2>
                  <p className="text-sm text-[#2C3E50]/60 text-center max-w-xs">
                    We sent a 6-digit code to{" "}
                    <span className="font-semibold text-[#2C3E50]">{email}</span>.
                    Enter it below to log in instantly.
                  </p>
                </div>

                <form onSubmit={handleVerifySubmit} className="space-y-6">
                  <div className="flex justify-center gap-2.5" onPaste={handleOtpPaste}>
                    {otp.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => { inputRefs.current[index] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(index, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(index, e)}
                        className={`w-11 h-14 text-center text-xl font-bold rounded-lg border-2 bg-[#F5F8FC] text-[#2C3E50] transition-all focus:outline-none focus:border-[#2563EB] focus:bg-white ${
                          digit ? "border-[#2563EB] bg-white" : "border-[#E8EEF7]"
                        }`}
                      />
                    ))}
                  </div>
                  <Button type="submit" disabled={loading || otp.join("").length < OTP_LENGTH}
                    className="w-full h-12 rounded-md bg-[#2563EB] text-white font-semibold hover:bg-[#1d4fd8] transition-colors disabled:opacity-70">
                    {loading ? "Verifying…" : "Verify & Login"}
                  </Button>
                </form>

                <div className="mt-5 flex items-center justify-center gap-1.5 text-sm text-[#2C3E50]/60">
                  <span>Didn't receive the code?</span>
                  <button onClick={handleResend} disabled={resendCooldown > 0 || loading}
                    className="flex items-center gap-1 font-semibold text-[#2563EB] hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-default">
                    <RefreshCw className="w-3.5 h-3.5" />
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                  </button>
                </div>

                <button onClick={() => { setStep("email"); setOtp(Array(OTP_LENGTH).fill("")); }}
                  className="mt-4 flex items-center gap-1.5 text-sm text-[#2C3E50]/60 hover:text-[#2563EB] transition-colors mx-auto">
                  <ArrowLeft className="w-4 h-4" /> Change email
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
