import { useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Building2, Mail, Lock, Phone, Globe, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSolutionBySlug } from "@/data/solutions";
import apasLogo from "@/assets/APAS-logo.png";
import { supabase } from "@/integrations/supabase/client";

const COUNTRIES = ["India", "United States", "United Kingdom", "United Arab Emirates", "Singapore"];
const INDIA_STATES = [
  "Telangana", "Andhra Pradesh", "Karnataka", "Tamil Nadu", "Maharashtra",
  "Delhi", "Gujarat", "West Bengal", "Kerala", "Punjab",
];

const SolutionSignup = () => {
  const { slug } = useParams<{ slug: string }>();
  const solution = getSolutionBySlug(slug ?? "");

  const [form, setForm] = useState({
    orgName: "",
    email: "",
    password: "",
    phone: "",
    country: "India",
    state: "Telangana",
  });
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!solution) {
    return <Navigate to="/" replace />;
  }

  const handleChange = (field: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!form.orgName.trim()) return setError("Please enter your organization name.");
    if (!form.email.trim()) return setError("Please enter your email.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (!form.phone.trim()) return setError("Please enter your phone number.");
    if (!agreed) return setError("Please agree to the Terms of Service and Privacy Policy.");

    setSubmitting(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            account_type: "erp_customer",
            org_name: form.orgName,
            phone: form.phone,
            country: form.country,
            state: form.state,
            solution_slug: solution.slug,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (data.session) {
        window.location.href = "/erp/login";
      } else {
        window.location.href = "/erp/login?check_email=1";
      }
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-white">
      <Helmet>
        <title>Get Started with {solution.title} | APAS Education ERP</title>
      </Helmet>

      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-blue-50 via-cyan-50 to-emerald-50 p-16 items-center">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_20%_20%,#3b82f6,transparent_50%)]" />
        <div className="relative z-10 max-w-md">
          <h1 className="text-5xl font-bold leading-tight text-slate-900 mb-8">
            Introducing
            <br />
            a new era of{" "}
            <span className="bg-gradient-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent">
              {solution.title}
            </span>
          </h1>
          <p className="text-slate-600 text-lg">{solution.heroSubtitle}</p>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <Link to="/" className="flex items-center gap-2 mb-10">
            <img src={apasLogo} alt="APAS Logo" className="h-10 w-auto object-contain" />
          </Link>

          <h2 className="text-3xl font-bold text-slate-900 mb-8">Let's get started</h2>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input type="text" placeholder="Organization Name*" value={form.orgName} onChange={handleChange("orgName")}
                className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input type="email" placeholder="Email*" value={form.email} onChange={handleChange("email")}
                className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input type="password" placeholder="Password*" value={form.password} onChange={handleChange("password")}
                className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>

            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input type="tel" placeholder="Phone Number*" value={form.phone} onChange={handleChange("phone")}
                className="w-full rounded-lg border border-slate-300 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <select value={form.country} onChange={handleChange("country")}
                  className="w-full appearance-none rounded-lg border border-slate-300 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {COUNTRIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <select value={form.state} onChange={handleChange("state")}
                  className="w-full appearance-none rounded-lg border border-slate-300 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {INDIA_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
            </div>

            <p className="text-xs text-slate-500">Your data will be stored securely in your regional data center.</p>

            <label className="flex items-start gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
              <span>
                I agree to the{" "}
                <a href="/terms" className="text-blue-600 underline">Terms of Service</a> and{" "}
                <a href="/privacy" className="text-blue-600 underline">Privacy Policy</a>.
              </span>
            </label>

            <Button onClick={handleSubmit} disabled={submitting}
              className="w-full bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white shadow-lg shadow-blue-500/30 rounded-full py-6 text-sm">
              {submitting ? "Creating your account..." : "Create your account"}
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link to="/erp/login" className="text-blue-600 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SolutionSignup;
