import { useState } from "react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, User, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import apasLogo from "@/assets/APAS-logo.png";
import knsoftLogo from "@/assets/knsoft-logo.png";


const Login = () => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState("Student");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
  const savedIdentifier = localStorage.getItem("rememberedIdentifier");

  if (savedIdentifier) {
    setIdentifier(savedIdentifier);
    setRememberMe(true);
  }
}, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (selectedRole === "Student") {
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

      // ✅ Record student login history
      await supabase.from("login_history").insert({
        user_id: data.session.user.id,
        email: data.session.user.email,
        role: "student",
      });
if (rememberMe) {
  localStorage.setItem("rememberedIdentifier", identifier);
} else {
  localStorage.removeItem("rememberedIdentifier");
}
      navigate("/student-dashboard");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: identifier, password });

    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Blocks user if email is not verified yet
    if (data?.user && !data.user.email_confirmed_at) {
      toast({ 
        title: "Email not verified", 
        description: "Please check your inbox and confirm your email before signing in.", 
        variant: "destructive" 
      });
      setLoading(false);
      return;
    }

    const { data: profileData } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
    const role = profileData?.role;
    const roleMap: Record<string, string> = {
          Student: "student",
          Parent: "parent",
          Teacher: "teacher",
          Admin: "admin",
          Principal: "principal",
          "School Admin": "school_admin",
          HOD: "hod",
          "KNSOFT Admin": "knsoft_admin",
        };

if (role !== roleMap[selectedRole]) {
  toast({
    title: "Role mismatch",
    description: `This account is not registered as ${selectedRole}.`,
    variant: "destructive",
  });

  await supabase.auth.signOut();
  setLoading(false);
  return;
}

    // ✅ Record staff login history with role
    await supabase.from("login_history").insert({
      user_id: data.session.user.id,
      email: data.session.user.email,
      role: role ?? "unknown",
    });

    if (role === "knsoft_admin") {
      navigate("/knsoft-admin");
    } else if (role === "school_admin") {
      navigate("/super-admin");
    } else if (role === "hod") {
      navigate("/hod-dashboard");
    } else if (role === "parent") {
      navigate("/parent-dashboard");
    } else if (role === "student") {
      navigate("/student-dashboard");
    } else {
      navigate("/dashboard");
    }
    setLoading(false);
  };

return (
<>
<section
  className="min-h-screen flex items-center justify-end pr-20"
  style={{
    backgroundImage: "url('/classroom-bg.jpg')",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  }}
>
            {/* 2. ADD THIS LOGO CODE HERE */}
           <div className="absolute top-8 left-8 z-50">
            <img 
              src={knsoftLogo} 
              alt="KNSOFT Logo" 
              className="h-10 w-auto object-contain" 
            />
           </div>
            <div
              className="
                relative
                w-[470px]
              bg-violet-50/70
                backdrop-blur-xl
                rounded-[32px]
                p-10
                border border-white/50
                shadow-[0_30px_100px_rgba(0,0,0,0.15)]
              "
            >
              
              <div className="text-center mb-8">
                <img src={apasLogo} alt="APAS Logo" className="h-24 mx-auto mb-5" />
                <h2
                  className="text-1xl font-light text-slate-800"
                  style={{ fontFamily: "'DM Serif Display', serif" }}
                >
                  Adaptive Pedagogy & Analytics System
                </h2>
                <h2
                  className="text-2xl font-light text-slate-700"
                  style={{ fontFamily: "'DM Serif Display', serif" }}
                >
                  Welcome Back 👋
                </h2>
                <p className="mt-3 text-slate-500">
                  Sign in to continue your learning journey
                </p>
              </div>

            <form onSubmit={handleLogin} className="space-y-4">
<div>
  <label className="block mb-2 text-sm font-medium text-[#2C3E50]">
    Select Role
  </label>

  <select
    value={selectedRole}
    onChange={(e) => {
      setSelectedRole(e.target.value);
      setIdentifier("");
    }}
    className="w-full h-12 px-4 rounded-md bg-[#F5F8FC] border border-gray-200 text-[#2C3E50]"
  >
    <option>Student</option>
    <option>Parent</option>
    <option>Teacher</option>
    <option>Admin</option>
    <option>HOD</option>
    <option>School Admin</option>
  </select>
</div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                  <User className="h-4 w-4 text-[#2C3E50]/60" />
                </div>
                <input
                  type={selectedRole === "Student" ? "text" : "email"}
                  placeholder={selectedRole === "Student" ? "Student ID" : "Username or Email"}
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

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="accent-[#2563EB]"
                    />
                    <span className="text-sm text-slate-600">
                      Remember Me
                    </span>
                  </label>
                </div>


              {selectedRole !== "Student" && (
                <div className="pt-1">
                  <Link
                    to="/forgot-password"
                    className="text-sm font-semibold text-[#2C3E50] hover:text-[#2563EB] transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
              )}

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

<div className="mt-8 text-center">
  <p className="text-sm text-[#2C3E50]/70">
    Need access?{" "}
    <a
      href="mailto:info@apaslearning.com"
      className="font-semibold text-[#2563EB] hover:underline"
    >
      Contact your administrator
    </a>
  </p>
</div>

<div className="mt-4 text-center border-t pt-4">
  <Link
    to="/register"
    className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
  >
    KNSOFT Administrator? Access Portal →
  </Link>
</div>
</div>
</section>

<section className="bg-gradient-to-br from-blue-100 via-white to-green-70 py-24">
  <div className="max-w-6xl mx-auto px-6 text-center">

    <h2 className="text-3xl font-bold text-slate-800">
      © 2026 APAS
    </h2>

    <p className="mt-3 text-lg text-slate-700">
      Adaptive Pedagogy & Analytics System
    </p>

    <p className="mt-2 text-slate-600">
      Powered by KNSOFT TECHNOLOGIES
    </p>

    <div className="mt-8 flex justify-center gap-6">

      <a href="#" className="text-blue-700 hover:underline">
        Privacy Policy
      </a>

      <a href="#" className="text-blue-700 hover:underline">
        Terms
      </a>

      <a
        href="mailto:info@apaslearning.com"
        className="text-blue-700 hover:underline"
      >
        Support
      </a>

    </div>

  </div>
</section>

</>  
  );
};

export default Login;