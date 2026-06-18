import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GraduationCap, Eye, EyeOff, Check, X, User, Lock, Mail, IdCard, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import registerSide from "@/assets/register-side.png";
import apasLogo from "@/assets/APAS-logo.png";
import knsoftLogo from "@/assets/knsoft-logo.png";



const roles = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "school_admin", label: "Admin" },
] as const;

const hasUpperCase = (str: string) => /[A-Z]/.test(str);
const hasSpecialChar = (str: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(str);
const hasDigit = (str: string) => /[0-9]/.test(str);
const isPasswordValid = (pwd: string) =>
  pwd.length >= 6 && hasUpperCase(pwd) && hasSpecialChar(pwd) && hasDigit(pwd);

const ValidationItem = ({ met, text }: { met: boolean; text: string }) => (
  <div className={cn("flex items-center gap-2 text-xs", met ? "text-emerald-600" : "text-[#2C3E50]/50")}>
    {met ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
    <span>{text}</span>
  </div>
);

const Register = () => {
  
  const [fullName, setFullName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<string>("student");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const isStudent = role === "student";
  const usesEmail = role === "teacher" || role === "school_admin";
  const passwordIsValid = isPasswordValid(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;
  const canSubmit =   identifier.trim() && password.trim();

const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();

  setLoading(true);

  const { data, error } =
    await supabase.auth.signInWithPassword({
      email: identifier,
      password,
    });

  if (error) {
    toast({
      title: "Login Failed",
      description: error.message,
      variant: "destructive",
    });

    setLoading(false);
    return;
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profileData?.role !== "knsoft_admin") {
    toast({
      title: "Access Denied",
      description: "Only KNSOFT Administrators can access this portal.",
      variant: "destructive",
    });

    await supabase.auth.signOut();

    setLoading(false);
    return;
  }

  toast({
    title: "Welcome",
    description: "Successfully logged in.",
  });

  navigate("/knsoft-admin");

  setLoading(false);
};

  const inputBase =
    "w-full h-12 pl-14 pr-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0";

  return (
    <div className="min-h-screen bg-[#EAF1FB] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-8xl bg-white rounded-2xl shadow-xl overflow-hidden relative">
        <div className="absolute top-6 right-6 grid grid-cols-5 gap-1 opacity-40 pointer-events-none">
          {Array.from({ length: 25 }).map((_, i) => (
            <div key={i} className="w-1 h-1 rounded-full bg-[#2563EB]/40" />
          ))}
        </div>
        <div className="absolute bottom-6 right-6 grid grid-cols-5 gap-1 opacity-40 pointer-events-none">
          {Array.from({ length: 25 }).map((_, i) => (
            <div key={i} className="w-1 h-1 rounded-full bg-[#2563EB]/40" />
          ))}
        </div>

        <div className="grid md:grid-cols-[48%_52%]">
          
          {/* LEFT SIDE */}
          <div className="hidden md:flex relative min-h-[900px] overflow-hidden">

            {/* blue Gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700" />

{/* Decorative Circles */}

<div className="absolute top-12 left-24 w-14 h-14 rounded-full border border-white/20" />

<div className="absolute top-24 right-32 w-10 h-10 rounded-full border border-white/25" />

<div className="absolute top-48 left-[55%] w-8 h-8 rounded-full border border-white/20" />

<div className="absolute top-[35%] left-16 w-12 h-12 rounded-full border border-white/15" />

<div className="absolute top-[45%] right-20 w-16 h-16 rounded-full border border-white/20" />

<div className="absolute bottom-[35%] left-24 w-10 h-10 rounded-full border border-white/25" />

<div className="absolute bottom-[28%] right-36 w-14 h-14 rounded-full border border-white/20" />

<div className="absolute bottom-40 left-[65%] w-8 h-8 rounded-full border border-white/25" />

<div className="absolute bottom-20 left-12 w-16 h-16 rounded-full border border-white/15" />

<div className="absolute bottom-12 right-20 w-12 h-12 rounded-full border border-white/20" />


            {/* Decorative Circles */}
            <div className="absolute top-20 left-20 w-16 h-16 rounded-full border border-white/30" />
            <div className="absolute top-40 right-32 w-8 h-8 rounded-full border border-white/30" />
            <div className="absolute bottom-40 right-20 w-10 h-10 rounded-full border border-white/30" />

{/* Wave */}
<svg
  className="absolute right-[-1px] top-0 h-full w-[160px]"
  viewBox="0 0 160 1000"
  preserveAspectRatio="none"
>
  <path
    d="
      M 120 0
      C 70 120, 70 220, 110 320
      C 150 420, 150 580, 110 680
      C 70 780, 70 880, 120 1000
      L 160 1000
      L 160 0
      Z
    "
    fill='white'
  />
</svg>
<div
  className="absolute right-[158px] top-0 h-full w-[2px]"
  style={{
    background:
      "linear-gradient(to bottom, transparent, rgba(0,0,0,0.08), transparent)",
  }}
/>

            <div className="relative z-10 flex flex-col w-full px-10 py-12">

              <div>
              <img
                src={knsoftLogo}
                alt="KnSoft"
                className="h-10 w-auto"
              />

                <h2 className="mt-32 text-4xl font-bold text-white leading-tight">
                  Learn, Grow
                  <br />
                  Succeed Together
                </h2>

                <p className="mt-6 text-white/90 text-xl max-w-sm">
                  Join APAS and start your journey towards smarter education.
                </p>
              </div>

              <div className="absolute bottom-[-20px] left-0 w-full flex justify-center">
                <img
                  src={registerSide}
                  alt="Teacher and Students"
                  className="w-[800px] object-contain"
                />
              </div>

            </div>
          </div>

          {/* Right: Form Context Panels */}
          <div className="bg-gradient-to-br from-[#FCFCFF] via-[#F8F7FF] to-[#F2F0FF] px-12 sm:px-16 py-12 flex flex-col justify-center">
            <div className="flex justify-center mb-6">
              <img src={apasLogo} alt="APAS Logo" className="h-24 w-auto object-contain" />
            </div>

            {/* STEP 1: Render Registration Inputs Form */}
            
              <>
                <h2 className="text-4xl font-bold text-[#2C3E50] mb-6 text-center" style={{ fontFamily: "'DM Serif Display', serif" }}>
                  KNSOFT Administrator Access
                </h2>

                <form onSubmit={handleLogin} className="space-y-4">
                  {/* Role selector */}


                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                      {usesEmail ? <Mail className="h-4 w-4 text-[#2C3E50]/60" /> : <IdCard className="h-4 w-4 text-[#2C3E50]/60" />}
                    </div>
                    <input
                      type={usesEmail ? "email" : "text"}
                      placeholder="Administrator Email"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className={inputBase}
                      required
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                      <Lock className="h-4 w-4 text-[#2C3E50]/60" />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={cn(inputBase, "pr-11")}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#2C3E50]/50 hover:text-[#2C3E50]"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>                    

                  <div className="pt-2">
                    <Button
                      type="submit"
                      disabled={loading || !canSubmit}
                      className="w-full h-12 rounded-md bg-[#2563EB] text-white font-semibold hover:bg-[#1d4fd8] transition-colors disabled:opacity-70"
                    >
                      {loading ? "Signing In..." : "Access Portal"}
                    </Button>
                  </div>
                </form>

                <p className="mt-8 text-sm text-center text-[#2C3E50]/70">
                  Return to{" "}
                  <Link
                    to="/login"
                    className="font-semibold text-[#2563EB] hover:underline"
                  >
                    Main Login
                  </Link>
                </p>
              </>

          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;