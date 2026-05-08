import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GraduationCap, Eye, EyeOff, User, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import loginIllustration from "@/assets/login-illustration.png";

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
    <div className="min-h-screen bg-white flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-6xl grid md:grid-cols-2 gap-8 items-center">
        {/* Left: Form */}
        <div className="max-w-md w-full mx-auto md:mx-0">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#2C3E50] to-[#2563EB] shadow-lg">
              <GraduationCap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#2C3E50] leading-none" style={{ fontFamily: "'DM Serif Display', serif" }}>
                APAS
              </h1>
              <p className="text-[10px] tracking-[0.15em] text-[#2C3E50]/70 uppercase mt-1">
                Adaptive Pedagogy & Analytics System
              </p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-[#2C3E50] mb-8" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Login to your account
          </h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
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
                className="px-10 h-11 rounded-md bg-[#2C3E50] text-white font-medium hover:bg-[#1f2d3d] transition-colors disabled:opacity-70"
              >
                {loading ? "Signing in…" : "Login"}
              </Button>
            </div>
          </form>

          <p className="mt-10 text-sm text-[#2C3E50]/70">
            Don't have an account?{" "}
            <Link to="/register" className="font-semibold text-[#2563EB] hover:underline">
              Create one
            </Link>
          </p>
        </div>

        {/* Right: Illustration */}
        <div className="hidden md:flex items-center justify-center relative">
          <div className="absolute inset-0 bg-[#F5F8FC] rounded-[40%_60%_55%_45%/55%_45%_55%_45%]" />
          <img
            src={loginIllustration}
            alt="Students learning illustration"
            width={1024}
            height={1024}
            className="relative w-full max-w-lg h-auto"
          />
        </div>
      </div>
    </div>
  );
};

export default Login;
