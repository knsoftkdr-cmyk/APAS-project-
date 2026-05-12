import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GraduationCap, Eye, EyeOff, Check, X, User, Lock, Mail, IdCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import loginIllustration from "@/assets/login-illustration.png";
// Add import at top:
import apasLogo from "@/assets/APAS-logo.png";

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
  const canSubmit = passwordIsValid && passwordsMatch && fullName.trim() && identifier.trim();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);

    const email = isStudent ? `${identifier.trim().toLowerCase()}@student.apas.local` : identifier;

    if (isStudent) {
      const { data, error } = await supabase.functions.invoke("register-student", {
        body: { email, password, full_name: fullName.trim(), role },
      });
      if (error || data?.error) {
        toast({ title: "Registration failed", description: data?.error || error?.message, variant: "destructive" });
      } else {
        toast({ title: "Account created!", description: "You can now sign in." });
        navigate("/login");
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim(), role },
          emailRedirectTo: `${window.location.origin}/verify-email`,
        },
      });
      if (error) {
        toast({ title: "Registration failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Verification email sent!", description: "Please check your inbox." });
        navigate("/login");
      }
    }
    setLoading(false);
  };

  const inputBase =
    "w-full h-12 pl-14 pr-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0";

  return (
    <div className="min-h-screen bg-[#EAF1FB] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl overflow-hidden relative">
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
          {/* Left: Illustration */}
          <div className="hidden md:flex items-center justify-center relative bg-gradient-to-br from-[#EAF1FB] via-[#F5F8FC] to-white overflow-hidden min-h-[700px]">
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
          <div className="flex justify-center mb-6">
            <img src={apasLogo} alt="APAS Logo" className="h-24 w-auto object-contain" />
          </div>

          <h2 className="text-2xl font-semibold text-[#2C3E50] mb-6 text-center" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Create your account
          </h2>

          <form onSubmit={handleRegister} className="space-y-4">
            {/* Role selector */}
            <div className="grid grid-cols-3 gap-2">
              {roles.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => { setRole(r.value); setIdentifier(""); }}
                  className={cn(
                    "rounded-md py-2 text-xs font-semibold transition-all",
                    role === r.value
                      ? "bg-[#2C3E50] text-white shadow"
                      : "bg-[#F5F8FC] text-[#2C3E50]/70 hover:bg-[#E8EEF7]"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                <User className="h-4 w-4 text-[#2C3E50]/60" />
              </div>
              <input
                type="text"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={inputBase}
                required
              />
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                {usesEmail ? <Mail className="h-4 w-4 text-[#2C3E50]/60" /> : <IdCard className="h-4 w-4 text-[#2C3E50]/60" />}
              </div>
              <input
                type={usesEmail ? "email" : "text"}
                placeholder={isStudent ? "Student ID (e.g. STU2024001)" : "Email"}
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

            {password && (
              <div className="space-y-1.5 rounded-md bg-[#F5F8FC] border border-[#E8EEF7] p-3">
                <ValidationItem met={password.length >= 6} text="At least 6 characters" />
                <ValidationItem met={hasUpperCase(password)} text="One uppercase letter (A-Z)" />
                <ValidationItem met={hasSpecialChar(password)} text="One special character" />
                <ValidationItem met={hasDigit(password)} text="One digit (0-9)" />
              </div>
            )}

            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                <Lock className="h-4 w-4 text-[#2C3E50]/60" />
              </div>
              <input
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={cn(inputBase, "pr-11")}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#2C3E50]/50 hover:text-[#2C3E50]"
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmPassword && (
              <div className={cn("text-xs font-medium", passwordsMatch ? "text-emerald-600" : "text-destructive")}>
                {passwordsMatch ? "✓ Passwords match" : "✗ Passwords don't match"}
              </div>
            )}

            <div className="pt-2">
              <Button
                type="submit"
                disabled={loading || !canSubmit}
                className="w-full h-12 rounded-md bg-[#2563EB] text-white font-semibold hover:bg-[#1d4fd8] transition-colors disabled:opacity-70"
              >
                {loading ? "Creating…" : "Create Account"}
              </Button>
            </div>
          </form>

          <p className="mt-8 text-sm text-[#2C3E50]/70">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-[#2563EB] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
