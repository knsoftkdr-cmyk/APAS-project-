import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { User, Mail, Phone, Building2, MessageSquare, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import apasLogo from "@/assets/APAS-logo.png";
import knsoftLogo from "@/assets/knsoft-logo.png";

const RequestDemo = () => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("demo_requests").insert({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      institution_name: institutionName.trim(),
      email: email.trim(),
      phone_number: phoneNumber.trim() || null,
      description: description.trim() || null,
    });

    setLoading(false);

    if (error) {
      toast({
        title: "Something went wrong",
        description: error.message || "Could not submit your request. Please try again.",
        variant: "destructive",
      });
      return;
    }

    setSubmitted(true);
    toast({
      title: "Request received 🎉",
      description: "Our team will reach out to you shortly.",
    });
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
        <div className="absolute top-8 left-8 z-50">
          <img src={knsoftLogo} alt="KNSOFT Logo" className="h-10 w-auto object-contain" />
        </div>

        <div
          className="login-card
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
              {submitted ? "Thank You! 🎉" : "Request a Demo"}
            </h2>
            <p className="mt-3 text-slate-500">
              {submitted
                ? "We've received your request and will be in touch soon."
                : "Tell us about your school and we'll get in touch"}
            </p>
          </div>

          {submitted ? (
            <div className="flex flex-col items-center gap-6 py-6">
              <CheckCircle2 className="h-16 w-16 text-green-500" />
              <p className="text-center text-slate-600">
                Our team typically responds within 1–2 business days.
              </p>
              <Link to="/" className="w-full">
                <Button className="w-full h-12 rounded-md bg-gradient-to-r from-blue-600 to-blue-500 text-white font-semibold hover:scale-105 hover:shadow-xl hover:shadow-blue-400/30 transition-all duration-300">
                  Back to Home
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                    <User className="h-4 w-4 text-[#2C3E50]/60" />
                  </div>
                  <input
                    type="text"
                    placeholder="First Name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full h-12 pl-14 pr-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0"
                    required
                  />
                </div>

                <div className="relative">
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full h-12 px-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0"
                    required
                  />
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                  <Building2 className="h-4 w-4 text-[#2C3E50]/60" />
                </div>
                <input
                  type="text"
                  placeholder="Institution / School Name"
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                  className="w-full h-12 pl-14 pr-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0"
                  required
                />
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                  <Mail className="h-4 w-4 text-[#2C3E50]/60" />
                </div>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 pl-14 pr-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0"
                  required
                />
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center justify-center w-12 bg-[#E8EEF7] rounded-l-md">
                  <Phone className="h-4 w-4 text-[#2C3E50]/60" />
                </div>
                <input
                  type="tel"
                  placeholder="Phone Number"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full h-12 pl-14 pr-4 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0"
                />
              </div>

              <div className="relative">
                <div className="absolute top-0 left-0 flex items-start justify-center w-12 h-12 bg-[#E8EEF7] rounded-l-md">
                  <MessageSquare className="h-4 w-4 text-[#2C3E50]/60 mt-4" />
                </div>
                <textarea
                  placeholder="Tell us a bit about your school and what you're looking for"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full pl-14 pr-4 py-3 bg-[#F5F8FC] rounded-md text-[#2C3E50] placeholder:text-[#2C3E50]/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 border-0 resize-none"
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-md bg-gradient-to-r from-blue-600 to-blue-500 text-white font-semibold hover:scale-105 hover:shadow-xl hover:shadow-blue-400/30 transition-all duration-300"
                >
                  {loading ? "Submitting…" : "Submit"}
                </Button>
              </div>
            </form>
          )}

          {!submitted && (
            <div className="mt-6 text-center border-t pt-4">
              <Link
                to="/login"
                className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
              >
                Already have an account? Sign in →
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="bg-gradient-to-br from-blue-100 via-white to-green-70 py-24">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-slate-800">© 2026 APAS</h2>
          <p className="mt-3 text-lg text-slate-700">Adaptive Pedagogy & Analytics System</p>
          <p className="mt-2 text-slate-600">Powered by KNSOFT TECHNOLOGIES</p>
          <div className="mt-8 flex justify-center gap-6">
            <a href="#" className="text-blue-700 hover:underline">Privacy Policy</a>
            <a href="#" className="text-blue-700 hover:underline">Terms</a>
            <a href="mailto:info@apaslearning.com" className="text-blue-700 hover:underline">Support</a>
          </div>
        </div>
      </section>
    </>
  );
};

export default RequestDemo;
