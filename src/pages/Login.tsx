import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GraduationCap, Eye, EyeOff, User, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import loginIllustration from "@/assets/login-illustration.png";
// Add import at top:
import apasLogo from "@/assets/APAS-logo.png";

const Login = () => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isStudentLogin, setIsStudentLogin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isStudentLogin) {
      const { data, error } = await supabase.functions.invoke("student-login", {
        body: { studentId: identifier, password },
      });

      if (error || !data?.success || !data?.session?.access_token || !data?.session?.refresh_token) {
        toast({
          title: "Login failed",
          description: data?.error || "Invalid login. Use your Student ID and either your existing password or your Date of Birth in DDMMYYYY format.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      if (setSessionError) {
        toast({ title: "Login failed", description: setSessionError.message, variant: "destructive" });
        setLoading(false);
        return;
      }

      navigate("/dashboard");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: identifier, password });

    if (error) {
      const msg = error.message === "Email not confirmed"
        ? "Please verify your email before signing in."
        : error.message;
      toast({ title: "Login failed", description: msg, variant: "destructive" });
      setLoading(false);
      return;
    }

    navigate("/dashboard");
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#EAF1FB] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl overflow-hidden relative">
        {/* Decorative dots */}
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

        <div className="grid md:grid-cols-2">
          {/* Left: Illustration on blue blob */}
          <div className="hidden md:flex items-center justify-center relative bg-gradient-to-br from-[#EAF1FB] via-[#F5F8FC] to-white overflow-hidden min-h-[600px]">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 700" preserveAspectRatio="none">
              <path
                d="M 0,0 L 480,0 Q 560,180 500,360 Q 440,540 520,700 L 0,700 Z"
                fill="#DCE8F7"
                opacity="0.55"
              />
            </svg>
            <img
              src={loginIllustration}
              alt="Students learning illustration"
              className="relative z-10 w-full max-w-sm h-auto p-4"
            />
          </div>

          {/* Right: Form */}
          <div className="px-8 sm:px-14 py-12 flex flex-col justify-center">
            {/* Logo */}
            <div className="flex justify-center mb-8">
              <img src={apasLogo} alt="APAS Logo" className="h-24 w-auto object-contain" />
            </div>

            <h2 className="text-3xl font-semibold text-[#2C3E50] mb-8 text-center" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Login to your account
            </h2>

            <form onSubmit={handleLogin} className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isStudentLogin}
                  onChange={(e) => { setIsStudentLogin(e.target.checked); setIdentifier(""); }}
                  className="rounded border-border accent-[#2563EB]"
                />
                <span className="text-sm font-medium text-[#2C3E50]">I am a Student</span>
              </label>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                  <User className="h-4 w-4 text-[#2C3E50]/60" />
                </div>
                <input
                  type={isStudentLogin ? "text" : "email"}
                  placeholder={isStudentLogin ? "Student ID" : "Username or Email"}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full h-12 pl-14 pr-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0"
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
                  className="w-full h-12 pl-14 pr-11 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0"
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

              <div className="pt-1">
                <Link to="/register" className="text-sm font-semibold text-[#2C3E50] hover:text-[#2563EB] transition-colors">
                  Forgot password?
                </Link>
              </div>

              <div className="pt-4">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-md bg-[#2563EB] text-white font-semibold hover:bg-[#1d4fd8] transition-colors disabled:opacity-70"
                >
                  {loading ? "Signing in…" : "Login"}
                </Button>
              </div>
            </form>

            <p className="mt-8 text-sm text-[#2C3E50]/70">
              Don't have an account?{" "}
              <Link to="/register" className="font-semibold text-[#2563EB] hover:underline">
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
