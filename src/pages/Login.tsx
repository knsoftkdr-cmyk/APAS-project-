import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GraduationCap, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import AuthBackground from "@/components/AuthBackground";

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
            description: data?.error || "Invalid login. Use your Student ID and either your existing password or your Date of Birth in DDMMYYYY format. Example: 8/7/2016 → 08072016.",
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

    const email = isStudentLogin
      ? `${identifier.trim().toLowerCase()}@student.apas.local`
      : identifier;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      const msg = error.message === "Email not confirmed"
        ? "Please verify your email before signing in. Check your inbox for the verification link."
        : isStudentLogin
          ? "Invalid login. Use your Student ID and either your existing password or your Date of Birth in DDMMYYYY format. Example: 8/7/2016 → 08072016."
          : error.message;
      toast({ title: "Login failed", description: msg, variant: "destructive" });
      setLoading(false);
      return;
    }

    navigate("/dashboard");
    setLoading(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <AuthBackground />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl shadow-indigo-500/25">
            <GraduationCap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">APAS</h1>
          <p className="text-sm text-muted-foreground">Adaptive Pedagogy & Analytics System</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white/60 backdrop-blur-xl p-8 shadow-2xl shadow-indigo-500/10 border border-white/50 ring-1 ring-black/[0.03]">
          <h2 className="mb-1 text-lg font-semibold text-foreground">Sign in</h2>
          <p className="mb-6 text-sm text-muted-foreground">Enter your credentials to continue</p>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Student toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isStudentLogin}
                onChange={(e) => { setIsStudentLogin(e.target.checked); setIdentifier(""); }}
                className="rounded border-border accent-indigo-600"
              />
              <span className="text-sm font-medium text-foreground">I am a Student</span>
            </label>


            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-foreground font-medium">
                {isStudentLogin ? "Student ID" : "Email"}
              </Label>
              <Input
                id="identifier"
                type={isStudentLogin ? "text" : "email"}
                placeholder={isStudentLogin ? "e.g. STU2024001" : "you@example.com"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="rounded-xl border-2 border-border bg-white/80 px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition-all"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground font-medium">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={isStudentLogin ? "e.g. 08072016" : "••••••••"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl border-2 border-border bg-white/80 px-4 py-2.5 pr-11 text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {isStudentLogin ? (
                <p className="text-xs text-muted-foreground">
                  Enter either the student&apos;s own password or the imported DOB password in DDMMYYYY format.
                </p>
              ) : null}
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-blue-500 via-indigo-500 to-indigo-600 text-white font-medium py-2.5 hover:from-blue-600 hover:via-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/register" className="font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
