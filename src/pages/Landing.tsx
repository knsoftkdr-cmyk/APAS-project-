import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Brain,
  BarChart3,
  Sparkles,
  ClipboardCheck,
  ArrowRight,
  Menu,
  X,
  GraduationCap,
  Zap,
  Target,
  TrendingUp,
  Trophy,
  MessageCircle,
  Award,
  Flame,
  Star,
  BookOpen,
  Users,
  LineChart,
  FileText,
  Activity,
  UserPlus,
  Lightbulb,
  Rocket,
} from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "Adaptive Learning",
    desc: "AI customizes learning paths based on each student's performance and pace.",
    gradient: "from-indigo-500 to-purple-500",
  },
  {
    icon: BarChart3,
    title: "Smart Analytics",
    desc: "Real-time dashboards and academic performance insights at your fingertips.",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    icon: Sparkles,
    title: "Personalized Recommendations",
    desc: "Smart suggestions of learning materials based on strengths and weaknesses.",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    icon: ClipboardCheck,
    title: "Intelligent Assessments",
    desc: "AI-driven tests with continuous progress tracking and feedback.",
    gradient: "from-indigo-500 to-blue-500",
  },
];

const Landing = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("in-view");
        });
      },
      { threshold: 0.15 },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-root min-h-screen overflow-x-hidden bg-white text-slate-900">
      {/* Navbar */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-white/80 backdrop-blur-xl shadow-[0_4px_20px_rgba(79,70,229,0.08)]"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              APAS
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-700">
            <a href="#home" className="hover:text-indigo-600 transition-colors">Home</a>
            <a href="#features" className="hover:text-indigo-600 transition-colors">Features</a>
            <a href="#analytics" className="hover:text-indigo-600 transition-colors">Analytics</a>
            <a href="#about" className="hover:text-indigo-600 transition-colors">About</a>
            <a href="#contact" className="hover:text-indigo-600 transition-colors">Contact</a>
          </div>

          <div className="hidden md:block">
            <Link to="/login">
              <Button className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 hover:opacity-90 text-white shadow-lg shadow-indigo-500/30 rounded-full px-5">
                Get Started
              </Button>
            </Link>
          </div>

          <button className="md:hidden" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden bg-white/95 backdrop-blur-xl border-t border-slate-100 px-6 py-4 space-y-3 text-sm font-medium">
            <a href="#home" className="block">Home</a>
            <a href="#features" className="block">Features</a>
            <a href="#analytics" className="block">Analytics</a>
            <a href="#about" className="block">About</a>
            <a href="#contact" className="block">Contact</a>
            <Link to="/login" className="block">
              <Button className="w-full bg-gradient-to-r from-indigo-600 to-pink-500 text-white rounded-full">
                Get Started
              </Button>
            </Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section
        id="home"
        className="relative pt-32 pb-24 px-6 overflow-hidden"
      >
        {/* animated mesh background */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 -left-40 w-[600px] h-[600px] rounded-full bg-indigo-400/30 blur-3xl mesh-blob" />
          <div className="absolute top-20 right-0 w-[500px] h-[500px] rounded-full bg-purple-400/30 blur-3xl mesh-blob mesh-blob-2" />
          <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-pink-400/20 blur-3xl mesh-blob mesh-blob-3" />
          {/* particles */}
          {Array.from({ length: 18 }).map((_, i) => (
            <span
              key={i}
              className="particle"
              style={{
                left: `${(i * 53) % 100}%`,
                top: `${(i * 37) % 100}%`,
                animationDelay: `${i * 0.4}s`,
                animationDuration: `${8 + (i % 5)}s`,
              }}
            />
          ))}
        </div>

        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          {/* Left */}
          <div data-reveal className="reveal">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/70 backdrop-blur border border-indigo-100 text-xs font-semibold text-indigo-700 shadow-sm mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              AI-Powered Education Platform
            </div>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight">
              Adaptive Learning{" "}
              <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 bg-clip-text text-transparent">
                Powered by AI
              </span>
            </h1>
            <p className="mt-6 text-lg text-slate-600 max-w-xl leading-relaxed">
              Personalized education experiences, intelligent analytics, and smart
              pedagogy designed for the next generation of learners.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/login">
                <Button
                  size="lg"
                  className="rounded-full px-7 h-12 text-base bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 text-white shadow-xl shadow-indigo-500/30 hover:shadow-2xl hover:shadow-purple-500/40 hover:scale-105 transition-all"
                >
                  Get Started <ArrowRight className="ml-1" />
                </Button>
              </Link>
              <a href="#features">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-full px-7 h-12 text-base border-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 backdrop-blur"
                >
                  Explore Features
                </Button>
              </a>
            </div>

            <div className="mt-10 flex items-center gap-8 text-sm text-slate-500">
              <div>
                <div className="text-2xl font-bold text-slate-900">50K+</div>
                Students
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">200+</div>
                Schools
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">98%</div>
                Satisfaction
              </div>
            </div>
          </div>

          {/* Right – futuristic illustration */}
          <div data-reveal className="reveal relative h-[500px] lg:h-[560px]">
            {/* main dashboard card */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-1 shadow-2xl shadow-purple-500/40 floaty">
              <div className="w-full h-full rounded-3xl bg-white/95 backdrop-blur p-6 flex flex-col">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                      <Brain className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-semibold">AI Learning Hub</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 p-3 border border-indigo-100">
                    <div className="text-xs text-slate-500">Progress</div>
                    <div className="text-2xl font-bold text-indigo-700">87%</div>
                    <div className="mt-2 h-1.5 rounded-full bg-indigo-100 overflow-hidden">
                      <div className="h-full w-[87%] bg-gradient-to-r from-indigo-500 to-purple-500" />
                    </div>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-pink-50 to-rose-50 p-3 border border-pink-100">
                    <div className="text-xs text-slate-500">Mastery</div>
                    <div className="text-2xl font-bold text-pink-600">A+</div>
                    <div className="mt-2 flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= 4 ? "bg-pink-500" : "bg-pink-100"}`} />
                      ))}
                    </div>
                  </div>
                </div>

                {/* chart */}
                <div className="mt-5 flex-1 rounded-xl bg-gradient-to-br from-slate-50 to-indigo-50/40 border border-slate-100 p-4 flex items-end gap-2">
                  {[40, 65, 50, 80, 70, 95, 85].map((h, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-indigo-500 via-purple-500 to-pink-500 chart-bar"
                        style={{ height: `${h}%`, animationDelay: `${i * 0.1}s` }}
                      />
                      <span className="text-[10px] text-slate-400">D{i + 1}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-100">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <span className="text-xs text-slate-700">
                    AI suggests: Practice <b>fractions</b> for 15 min today
                  </span>
                </div>
              </div>
            </div>

            {/* floating chip 1 */}
            <div className="absolute -top-4 -left-4 rounded-2xl bg-white shadow-xl shadow-indigo-200 p-3 flex items-center gap-3 floaty floaty-2 z-10">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-xs text-slate-500">Improvement</div>
                <div className="font-bold text-sm text-emerald-600">+24%</div>
              </div>
            </div>

            {/* floating chip 2 */}
            <div className="absolute -bottom-4 -right-2 rounded-2xl bg-white shadow-xl shadow-pink-200 p-3 flex items-center gap-3 floaty floaty-3 z-10">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
                <Target className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-xs text-slate-500">Goal Met</div>
                <div className="font-bold text-sm text-pink-600">12/15</div>
              </div>
            </div>

            {/* AI assistant blob */}
            <div className="absolute top-1/3 -right-6 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 p-4 shadow-2xl shadow-purple-500/40 floaty floaty-2 z-10">
              <Zap className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </section>

      {/* Why APAS */}
      <section id="features" className="relative py-24 px-6 bg-gradient-to-b from-white via-indigo-50/30 to-white">
        <div className="max-w-7xl mx-auto">
          <div data-reveal className="reveal text-center max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 mb-4">
              Why APAS
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              Built for the{" "}
              <span className="bg-gradient-to-r from-indigo-600 to-pink-500 bg-clip-text text-transparent">
                future of learning
              </span>
            </h2>
            <p className="mt-4 text-slate-600">
              Everything students, teachers and schools need to deliver a truly
              personalized learning journey — powered by AI.
            </p>
          </div>

          <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <div
                key={f.title}
                data-reveal
                className="reveal group relative rounded-2xl p-[1.5px] bg-gradient-to-br from-indigo-200 via-purple-200 to-pink-200 hover:from-indigo-500 hover:via-purple-500 hover:to-pink-500 transition-all hover:-translate-y-2 hover:shadow-2xl hover:shadow-purple-300/50"
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div className="rounded-2xl bg-white h-full p-6">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}
                  >
                    <f.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="mt-5 font-bold text-lg">{f.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
                  <div className="mt-5 flex items-center gap-1 text-xs font-semibold text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    Learn more <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Analytics highlight */}
      <section id="analytics" className="relative py-24 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div data-reveal className="reveal">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-100 text-xs font-semibold text-purple-700 mb-4">
              Smart Analytics
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              Insights that turn data into{" "}
              <span className="bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                outcomes
              </span>
            </h2>
            <p className="mt-4 text-slate-600 leading-relaxed">
              Track engagement, mastery, and growth across every student. APAS turns
              raw classroom data into beautiful, actionable insights for teachers
              and schools.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-700">
              {[
                "Real-time learner dashboards",
                "Cognitive performance heatmaps",
                "Predictive risk alerts",
                "Curriculum-aligned reports",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-pink-500 flex items-center justify-center text-white text-[10px]">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div data-reveal className="reveal relative h-[420px]">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 p-6 shadow-xl">
              <div className="grid grid-cols-3 gap-4 h-full">
                {[
                  { label: "Engagement", val: "92%", color: "from-indigo-500 to-purple-500" },
                  { label: "Mastery", val: "78%", color: "from-purple-500 to-pink-500" },
                  { label: "Growth", val: "+31%", color: "from-pink-500 to-rose-500" },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl bg-white/90 backdrop-blur p-4 flex flex-col justify-between shadow-md">
                    <div className="text-xs text-slate-500">{s.label}</div>
                    <div className={`text-3xl font-extrabold bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>
                      {s.val}
                    </div>
                  </div>
                ))}
                <div className="col-span-3 rounded-2xl bg-white/90 backdrop-blur p-5 shadow-md">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">Class Performance</span>
                    <span className="text-xs text-slate-400">Last 7 days</span>
                  </div>
                  <div className="flex items-end gap-2 h-32">
                    {[50, 70, 60, 85, 75, 95, 88].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-lg bg-gradient-to-t from-indigo-500 via-purple-500 to-pink-500 chart-bar"
                        style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About / CTA */}
      <section id="about" className="relative py-24 px-6">
        <div className="max-w-5xl mx-auto rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-12 text-center text-white shadow-2xl shadow-purple-500/40 relative overflow-hidden">
          <div className="absolute inset-0 opacity-20">
            {Array.from({ length: 20 }).map((_, i) => (
              <span
                key={i}
                className="particle"
                style={{
                  left: `${(i * 47) % 100}%`,
                  top: `${(i * 31) % 100}%`,
                  animationDelay: `${i * 0.3}s`,
                  background: "white",
                }}
              />
            ))}
          </div>
          <div className="relative">
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              Ready to learn smarter?
            </h2>
            <p className="mt-4 text-white/90 max-w-xl mx-auto">
              Join the growing community of students and educators using APAS to
              unlock potential through adaptive, AI-powered learning.
            </p>
            <div className="mt-8 flex flex-wrap gap-4 justify-center">
              <Link to="/login">
                <Button size="lg" className="rounded-full px-8 h-12 bg-white text-indigo-700 hover:bg-white/90 font-semibold shadow-xl">
                  Get Started Free <ArrowRight className="ml-1" />
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" className="rounded-full px-8 h-12 bg-transparent border-2 border-white/60 text-white hover:bg-white/10">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="border-t border-slate-100 bg-slate-50/50 px-6 py-12">
        <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-8 text-sm">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center">
                <GraduationCap className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold">APAS</span>
            </div>
            <p className="mt-3 text-slate-500">
              Adaptive Pedagogy & Analytics System — helping students learn smarter.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-3">Product</div>
            <ul className="space-y-2 text-slate-500">
              <li><a href="#features" className="hover:text-indigo-600">Features</a></li>
              <li><a href="#analytics" className="hover:text-indigo-600">Analytics</a></li>
              <li><Link to="/login" className="hover:text-indigo-600">Sign In</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-3">Company</div>
            <ul className="space-y-2 text-slate-500">
              <li><a href="#about" className="hover:text-indigo-600">About</a></li>
              <li><a href="#contact" className="hover:text-indigo-600">Contact</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-3">Contact</div>
            <p className="text-slate-500">hello@apas.ai</p>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-slate-200 text-xs text-slate-400 text-center">
          © {new Date().getFullYear()} APAS. All rights reserved.
        </div>
      </footer>

      {/* Local styles */}
      <style>{`
        .reveal { opacity: 0; transform: translateY(24px); transition: opacity .8s ease, transform .8s ease; }
        .reveal.in-view { opacity: 1; transform: translateY(0); }

        @keyframes floaty { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-14px) } }
        .floaty { animation: floaty 6s ease-in-out infinite; }
        .floaty-2 { animation-duration: 7s; animation-delay: .5s; }
        .floaty-3 { animation-duration: 8s; animation-delay: 1s; }

        @keyframes meshShift {
          0%,100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(40px,-30px) scale(1.1); }
        }
        .mesh-blob { animation: meshShift 14s ease-in-out infinite; }
        .mesh-blob-2 { animation-duration: 18s; animation-direction: reverse; }
        .mesh-blob-3 { animation-duration: 22s; }

        .particle {
          position: absolute;
          width: 6px; height: 6px;
          border-radius: 9999px;
          background: linear-gradient(135deg,#8B5CF6,#EC4899);
          opacity: .5;
          animation: particleFloat 10s ease-in-out infinite;
          filter: blur(.5px);
        }
        @keyframes particleFloat {
          0%,100% { transform: translateY(0) translateX(0); opacity: .25; }
          50% { transform: translateY(-40px) translateX(20px); opacity: .8; }
        }

        @keyframes growBar { from { transform: scaleY(.3); transform-origin: bottom; } to { transform: scaleY(1); transform-origin: bottom; } }
        .chart-bar { animation: growBar 1.2s cubic-bezier(.2,.8,.2,1) both; }
      `}</style>
    </div>
  );
};

export default Landing;
