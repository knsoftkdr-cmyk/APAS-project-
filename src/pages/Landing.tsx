import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import heroStudent from "@/assets/landing-hero-student.png";
import heroBoy from "@/assets/landing-hero-boy.jpg";
import studentsPhoto from "@/assets/landing-students.jpg";
import teacherPhoto from "@/assets/landing-teacher.jpg";
import aiBrain from "@/assets/landing-ai-brain.png";
import aboutBg from "@/assets/landing-about-bg.jpg";
import ctaBg from "@/assets/landing-cta-bg.jpg";
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
    href: "#students",
  },
  {
    icon: BarChart3,
    title: "Smart Analytics",
    desc: "Real-time dashboards and academic performance insights at your fingertips.",
    gradient: "from-purple-500 to-pink-500",
    href: "#analytics",
  },
  {
    icon: Sparkles,
    title: "Personalized Recommendations",
    desc: "Smart suggestions of learning materials based on strengths and weaknesses.",
    gradient: "from-pink-500 to-rose-500",
    href: "#students",
  },
  {
    icon: ClipboardCheck,
    title: "Intelligent Assessments",
    desc: "AI-driven tests with continuous progress tracking and feedback.",
    gradient: "from-indigo-500 to-blue-500",
    href: "#how",
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
    const els = document.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in-view"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in-view");
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.01, rootMargin: "0px 0px -10% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    // Safety: ensure everything becomes visible even if observer misses
    const t = setTimeout(() => els.forEach((el) => el.classList.add("in-view")), 1500);
    return () => { observer.disconnect(); clearTimeout(t); };
  }, []);

  return (
      <div className="landing-root min-h-screen overflow-x-hidden bg-white text-slate-900 scroll-smooth">
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
            <a href="#about" className="hover:text-indigo-600 transition-colors">About</a>
            <a href="#features" className="hover:text-indigo-600 transition-colors">Features</a>
            <a href="#students" className="hover:text-indigo-600 transition-colors">Students</a>
            <a href="#faculty" className="hover:text-indigo-600 transition-colors">Faculty</a>
            <a href="#how" className="hover:text-indigo-600 transition-colors">How it works</a>
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
            <a href="#home" onClick={() => setMenuOpen(false)} className="block">Home</a>
            <a href="#about" onClick={() => setMenuOpen(false)} className="block">About</a>
            <a href="#features" onClick={() => setMenuOpen(false)} className="block">Features</a>
            <a href="#students" onClick={() => setMenuOpen(false)} className="block">Students</a>
            <a href="#faculty" onClick={() => setMenuOpen(false)} className="block">Faculty</a>
            <a href="#how" onClick={() => setMenuOpen(false)} className="block">How it works</a>
            <a href="#contact" onClick={() => setMenuOpen(false)} className="block">Contact</a>
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
        className="relative pt-32 pb-24 px-6 overflow-hidden bg-white"
      >
        {/* animated mesh background */}
        <div className="absolute inset-0 z-0">
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

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
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

          {/* Right – hero illustration */}
          <div data-reveal className="reveal relative h-[500px] lg:h-[560px] flex items-center justify-center">
            <img
              src={heroBoy}
              alt="Student reading a book"
              width={1280}
              height={1024}
              className="w-full h-full object-contain floaty"
            />
          </div>
        </div>
      </section>

      {/* About APAS */}
      <section id="about" className="relative py-28 px-6 overflow-hidden bg-slate-950">
        <div className="absolute inset-0 z-0">
          <img
            src={aboutBg}
            alt=""
            aria-hidden="true"
            loading="lazy"
            width={1920}
            height={1080}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/85 via-indigo-950/80 to-slate-950/90" />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto text-white">
          <div data-reveal className="reveal text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur border border-white/20 text-xs font-semibold text-pink-200 mb-5">
              <Sparkles className="w-3.5 h-3.5" />
              About APAS
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              An{" "}
              <span className="bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300 bg-clip-text text-transparent">
                Adaptive Pedagogy & Analytics System
              </span>{" "}
              for modern schools
            </h2>
            <p className="mt-6 text-lg text-white/80 leading-relaxed">
              APAS is an AI-powered learning platform that adapts to every student.
              It blends adaptive lessons, diagnostic tests, gamified practice, and
              real-time analytics into one seamless experience — helping students
              learn smarter and giving teachers the insights they need to teach better.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Brain,
                title: "What APAS does",
                desc: "Diagnoses each learner's strengths and gaps, then auto-generates personalized lesson plans, practice tests, and homework aligned to the curriculum.",
              },
              {
                icon: Users,
                title: "Who it's for",
                desc: "Students get a 24/7 AI tutor and gamified learning. Teachers get auto-graded insights. Schools and admins get full visibility across classes.",
              },
              {
                icon: LineChart,
                title: "How it helps",
                desc: "Tracks growth with normalized gain scores, predicts at-risk students early, and recommends targeted interventions — all backed by brain-based pedagogy.",
              },
            ].map((c) => (
              <div
                key={c.title}
                data-reveal
                className="reveal rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-7 hover:bg-white/10 hover:border-pink-300/40 hover:-translate-y-1 transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-900/50">
                  <c.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="mt-5 font-bold text-lg">{c.title}</h3>
                <p className="mt-2 text-sm text-white/75 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why APAS */}
      <section id="features" className="relative py-24 px-6 bg-gradient-to-b from-white via-indigo-50/30 to-white overflow-hidden">
        <img
          src={aiBrain}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="absolute right-[-120px] top-1/2 -translate-y-1/2 w-[640px] opacity-[0.10] pointer-events-none select-none animate-spin-very-slow"
        />
        <div className="max-w-7xl mx-auto relative">
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
              <a
                href={f.href}
                key={f.title}
                data-reveal
                className="reveal group relative rounded-2xl p-[1.5px] bg-gradient-to-br from-indigo-200 via-purple-200 to-pink-200 hover:from-indigo-500 hover:via-purple-500 hover:to-pink-500 transition-all hover:-translate-y-2 hover:shadow-2xl hover:shadow-purple-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
              </a>
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

      {/* SECTION 3 — Student Experience */}
      <section id="students" className="relative py-24 px-6 bg-gradient-to-b from-white via-purple-50/40 to-white overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div data-reveal className="reveal text-center max-w-2xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-100 text-xs font-semibold text-purple-700 mb-4">
              Student Experience
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              Built for{" "}
              <span className="bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                modern students
              </span>{" "}
              who want smarter learning experiences
            </h2>
          </div>

          {/* Real student photo banner */}
          <div data-reveal className="reveal relative mb-16 rounded-3xl overflow-hidden shadow-2xl shadow-purple-200">
            <img
              src={studentsPhoto}
              alt="Students learning together with APAS"
              loading="lazy"
              className="w-full h-64 md:h-80 object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-900/75 via-purple-800/40 to-transparent flex items-center">
              <div className="px-8 md:px-14 max-w-xl text-white">
                <div className="text-xs font-semibold uppercase tracking-widest text-pink-200">Real Classrooms</div>
                <div className="mt-2 text-2xl md:text-3xl font-extrabold leading-tight drop-shadow-lg">
                  50,000+ students already learning smarter with APAS
                </div>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Dashboard mockup */}
            <div data-reveal className="reveal relative h-[560px]">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-1 shadow-2xl shadow-purple-500/40 floaty">
                <div className="w-full h-full rounded-3xl bg-white p-6 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">Welcome back</div>
                      <div className="font-bold text-lg">Hi, Aarav 👋</div>
                    </div>
                    <div className="px-3 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold flex items-center gap-1">
                      <Flame className="w-3 h-3" /> 12 day streak
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Math", val: 86, color: "#6366F1" },
                      { label: "Science", val: 72, color: "#A855F7" },
                      { label: "English", val: 94, color: "#EC4899" },
                    ].map((s) => {
                      const c = 2 * Math.PI * 26;
                      const off = c - (s.val / 100) * c;
                      return (
                        <div key={s.label} className="rounded-xl bg-slate-50 p-3 flex flex-col items-center">
                          <div className="relative w-16 h-16">
                            <svg className="w-16 h-16 -rotate-90">
                              <circle cx="32" cy="32" r="26" stroke="#E2E8F0" strokeWidth="6" fill="none" />
                              <circle cx="32" cy="32" r="26" stroke={s.color} strokeWidth="6" fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{s.val}%</div>
                          </div>
                          <div className="mt-1 text-xs text-slate-600">{s.label}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 p-4 border border-indigo-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-700">Weekly Performance</span>
                      <span className="text-xs text-emerald-600 font-semibold">+18%</span>
                    </div>
                    <div className="flex items-end gap-1.5 h-20">
                      {[35, 55, 48, 70, 62, 85, 90].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-indigo-500 to-pink-500 chart-bar" style={{ height: `${h}%`, animationDelay: `${i * 0.1}s` }} />
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-100 p-3 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600 mt-0.5" />
                    <div className="text-xs text-slate-700">
                      <b>AI Mentor:</b> Try 5 quick algebra problems to boost your score by 8%.
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute -top-5 -right-3 rounded-2xl bg-white shadow-2xl shadow-purple-200 p-3 flex items-center gap-3 floaty floaty-2 z-10">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Achievement</div>
                  <div className="font-bold text-xs text-slate-800">Quiz Master</div>
                </div>
              </div>

              <div className="absolute -bottom-4 -left-4 rounded-2xl bg-white shadow-2xl shadow-indigo-200 p-3 max-w-[220px] floaty floaty-3 z-10">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                    <MessageCircle className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-xs font-semibold">AI Tutor</span>
                  <span className="ml-auto w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                </div>
                <div className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2">
                  Need help with photosynthesis? I can explain step by step ✨
                </div>
              </div>

              <div className="absolute top-1/2 -left-6 -translate-y-1/2 rounded-2xl bg-white shadow-xl p-2 flex gap-1.5 floaty z-10">
                {[Award, Star, Trophy].map((Ic, i) => (
                  <div key={i} className={`w-9 h-9 rounded-lg flex items-center justify-center ${["bg-gradient-to-br from-pink-400 to-rose-500","bg-gradient-to-br from-amber-400 to-orange-500","bg-gradient-to-br from-indigo-400 to-purple-500"][i]}`}>
                    <Ic className="w-4 h-4 text-white" />
                  </div>
                ))}
              </div>
            </div>

            {/* Feature list — student-only experiences (no overlap with main Features) */}
            <div data-reveal className="reveal space-y-4">
              {[
                { icon: Flame, title: "Daily Streaks & Habits", desc: "Build a consistent learning habit with streaks, reminders, and rewards.", color: "from-orange-500 to-rose-500" },
                { icon: Trophy, title: "Achievement Badges", desc: "Earn trophies and milestones as you master each topic.", color: "from-amber-500 to-orange-500" },
                { icon: MessageCircle, title: "24/7 AI Mentor", desc: "Ask anything. Your personal tutor is always one tap away.", color: "from-indigo-500 to-blue-500" },
                { icon: Zap, title: "Gamified Practice", desc: "Quick games turn revision into something you actually want to do.", color: "from-purple-500 to-pink-500" },
                { icon: Target, title: "Daily Goals", desc: "Small, achievable targets that keep you moving forward every day.", color: "from-pink-500 to-rose-500" },
              ].map((f) => (
                <div key={f.title} className="group flex items-start gap-4 rounded-2xl border border-slate-100 bg-white p-5 hover:border-purple-200 hover:shadow-xl hover:shadow-purple-100 transition-all hover:-translate-y-1">
                  <div className={`shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                    <f.icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <div className="font-bold">{f.title}</div>
                    <p className="text-sm text-slate-600 mt-1">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4 — Faculty & Analytics */}
      <section id="faculty" className="relative py-24 px-6 bg-gradient-to-b from-white via-indigo-50/40 to-white">
        <div className="max-w-7xl mx-auto">
          <div data-reveal className="reveal text-center max-w-2xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 mb-4">
              For Educators
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              Powerful Insights for{" "}
              <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Educators
              </span>
            </h2>
            <p className="mt-4 text-slate-600">
              Track student engagement, identify weak areas, and improve outcomes using AI-powered analytics.
            </p>
          </div>

          {/* Real teacher photo banner */}
          <div data-reveal className="reveal relative mb-16 rounded-3xl overflow-hidden shadow-2xl shadow-indigo-200">
            <img
              src={teacherPhoto}
              alt="Educator using APAS analytics"
              loading="lazy"
              className="w-full h-64 md:h-80 object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-l from-indigo-900/75 via-purple-800/40 to-transparent flex items-center justify-end">
              <div className="px-8 md:px-14 max-w-xl text-right text-white">
                <div className="text-xs font-semibold uppercase tracking-widest text-indigo-200">For Educators</div>
                <div className="mt-2 text-2xl md:text-3xl font-extrabold leading-tight drop-shadow-lg">
                  Teach smarter with real-time AI analytics
                </div>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div data-reveal className="reveal grid sm:grid-cols-2 gap-4">
              {[
                { icon: LineChart, title: "Class Performance", desc: "Monitor every class & section in real time.", color: "from-indigo-500 to-purple-500" },
                { icon: Activity, title: "Engagement Heatmaps", desc: "See where students light up — or fall off.", color: "from-purple-500 to-pink-500" },
                { icon: FileText, title: "AI-Generated Reports", desc: "Auto-built insights, ready to share with parents.", color: "from-pink-500 to-rose-500" },
                { icon: Users, title: "Student Insights", desc: "Drill into each learner's profile and growth.", color: "from-indigo-500 to-blue-500" },
              ].map((f) => (
                <div key={f.title} className="rounded-2xl bg-white border border-slate-100 p-5 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-100 transition-all">
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center shadow-md`}>
                    <f.icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="mt-4 font-bold">{f.title}</div>
                  <p className="text-sm text-slate-600 mt-1">{f.desc}</p>
                </div>
              ))}
            </div>

            <div data-reveal className="reveal relative h-[520px]">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 p-6 shadow-xl floaty">
                <div className="bg-white rounded-2xl h-full p-5 flex flex-col gap-4 shadow-inner">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold">Class 8-A Overview</div>
                      <div className="text-xs text-slate-500">42 students · Last 30 days</div>
                    </div>
                    <div className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 text-xs font-semibold">+14% growth</div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { l: "Engagement", v: "92%", c: "text-indigo-600" },
                      { l: "Avg Score", v: "78", c: "text-purple-600" },
                      { l: "At Risk", v: "4", c: "text-rose-600" },
                    ].map((k) => (
                      <div key={k.l} className="rounded-lg bg-slate-50 p-2 text-center">
                        <div className="text-[10px] text-slate-500">{k.l}</div>
                        <div className={`text-lg font-extrabold ${k.c}`}>{k.v}</div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-slate-700 mb-2">Engagement Heatmap</div>
                    <div className="grid grid-cols-12 gap-1">
                      {Array.from({ length: 84 }).map((_, i) => {
                        const intensity = Math.abs(Math.sin(i * 0.7)) * 0.85 + 0.12;
                        return (
                          <div key={i} className="aspect-square rounded-sm" style={{ background: `rgba(99, 102, 241, ${intensity.toFixed(2)})` }} />
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-auto rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 p-3 flex items-start gap-2">
                    <FileText className="w-4 h-4 text-indigo-600 mt-0.5" />
                    <div className="text-xs text-slate-700">
                      <b>AI Report:</b> 3 students need extra support in <i>fractions</i>. Recommended: targeted practice set.
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute -top-4 -right-3 rounded-2xl bg-white shadow-xl p-3 flex items-center gap-2 floaty floaty-2 z-10">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Outcomes</div>
                  <div className="font-bold text-xs text-emerald-600">Improving</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 5 — How It Works */}
      <section id="how" className="relative py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div data-reveal className="reveal text-center max-w-2xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-pink-100 text-xs font-semibold text-pink-700 mb-4">
              How it works
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              From sign-up to{" "}
              <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 bg-clip-text text-transparent">
                smarter learning
              </span>{" "}
              in 4 steps
            </h2>
          </div>

          {/* Desktop timeline */}
          <div className="hidden md:block relative">
            <div className="absolute top-10 left-[10%] right-[10%] h-1 rounded-full bg-gradient-to-r from-indigo-100 via-purple-100 to-pink-100 overflow-hidden">
              <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 connector-fill origin-left" />
            </div>

            <div className="grid grid-cols-4 gap-6 relative">
              {[
                { icon: UserPlus, title: "Register", desc: "Create your free account in seconds.", color: "from-indigo-500 to-purple-500" },
                { icon: BookOpen, title: "Learn", desc: "Personalized lessons tailored to you.", color: "from-purple-500 to-pink-500" },
                { icon: BarChart3, title: "Analyze Performance", desc: "AI tracks your strengths and gaps.", color: "from-pink-500 to-rose-500" },
                { icon: Rocket, title: "Improve with AI", desc: "Get smart suggestions to grow faster.", color: "from-amber-500 to-orange-500" },
              ].map((s, i) => (
                <div key={s.title} data-reveal className="reveal text-center" style={{ transitionDelay: `${i * 120}ms` }}>
                  <div className="relative mx-auto w-20 h-20">
                    <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${s.color} blur-xl opacity-50`} />
                    <div className={`relative w-20 h-20 rounded-full bg-gradient-to-br ${s.color} flex items-center justify-center shadow-2xl shadow-purple-300/40 step-pulse`}>
                      <s.icon className="w-8 h-8 text-white" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-white border-2 border-purple-200 flex items-center justify-center text-xs font-bold text-purple-600">
                      {i + 1}
                    </div>
                  </div>
                  <h3 className="mt-5 font-bold text-lg">{s.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile vertical timeline */}
          <div className="md:hidden relative pl-10">
            <div className="absolute left-4 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-indigo-500 via-purple-500 to-pink-500" />
            {[
              { icon: UserPlus, title: "Register", desc: "Create your free account in seconds." },
              { icon: BookOpen, title: "Learn", desc: "Personalized lessons tailored to you." },
              { icon: BarChart3, title: "Analyze Performance", desc: "AI tracks your strengths and gaps." },
              { icon: Rocket, title: "Improve with AI", desc: "Get smart suggestions to grow faster." },
            ].map((s, i) => (
              <div key={s.title} data-reveal className="reveal relative mb-8">
                <div className="absolute -left-[34px] top-0 w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                  <s.icon className="w-4 h-4 text-white" />
                </div>
                <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-md">
                  <div className="text-xs text-purple-600 font-semibold">Step {i + 1}</div>
                  <div className="font-bold mt-1">{s.title}</div>
                  <p className="text-sm text-slate-600 mt-1">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="relative py-24 px-6 bg-gradient-to-b from-white via-pink-50/30 to-white overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div data-reveal className="reveal text-center max-w-2xl mx-auto mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-pink-100 text-xs font-semibold text-pink-700 mb-4">
              Loved by learners
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight">
              What students &{" "}
              <span className="bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
                teachers
              </span>{" "}
              are saying
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { name: "Aarav S.", role: "Class 8 Student", quote: "APAS feels like having a personal tutor 24/7. My math scores jumped 22% in two months!", color: "from-indigo-500 to-purple-500" },
              { name: "Ms. Priya R.", role: "Math Teacher", quote: "The heatmaps show me exactly which students need help. I save hours every week.", color: "from-purple-500 to-pink-500" },
              { name: "Dr. Mehta", role: "Principal", quote: "School-wide growth of 31% in one term. APAS truly delivers measurable outcomes.", color: "from-pink-500 to-rose-500" },
            ].map((t, i) => (
              <div
                key={t.name}
                data-reveal
                className="reveal group rounded-2xl bg-white border border-slate-100 p-7 hover:-translate-y-2 hover:shadow-2xl hover:shadow-purple-200 transition-all relative overflow-hidden"
                style={{ transitionDelay: `${i * 100}ms` }}
              >
                <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br ${t.color} opacity-10 blur-2xl group-hover:opacity-30 transition-opacity`} />
                <div className="flex gap-1 text-amber-400 mb-3">
                  {[1,2,3,4,5].map(s => <Star key={s} className="w-4 h-4 fill-current" />)}
                </div>
                <p className="text-slate-700 leading-relaxed">"{t.quote}"</p>
                <div className="mt-6 flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-white font-bold`}>
                    {t.name[0]}
                  </div>
                  <div>
                    <div className="font-bold text-sm">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="get-started" className="relative py-24 px-6">
        <div className="max-w-5xl mx-auto rounded-3xl relative overflow-hidden shadow-2xl shadow-purple-500/40">
          <img
            src={ctaBg}
            alt=""
            aria-hidden="true"
            loading="lazy"
            width={1920}
            height={1080}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-700/90 via-purple-700/85 to-pink-600/90" />
          <div className="relative p-12 text-center text-white">
            <div className="absolute inset-0 opacity-20 pointer-events-none">
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
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight relative">
              Ready to learn smarter?
            </h2>
            <p className="mt-4 text-white/90 max-w-xl mx-auto relative">
              Join the growing community of students and educators using APAS to
              unlock potential through adaptive, AI-powered learning.
            </p>
            <div className="mt-8 flex flex-wrap gap-4 justify-center relative">
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

        @keyframes connectorFill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .connector-fill { animation: connectorFill 2.5s ease-out forwards; }

        @keyframes stepPulse { 0%,100% { box-shadow: 0 10px 30px -5px rgba(168,85,247,.4); } 50% { box-shadow: 0 10px 40px 0 rgba(236,72,153,.6); } }
        .step-pulse { animation: stepPulse 3s ease-in-out infinite; }

        @keyframes spinVerySlow { from { transform: translateY(-50%) rotate(0deg); } to { transform: translateY(-50%) rotate(360deg); } }
        .animate-spin-very-slow { animation: spinVerySlow 60s linear infinite; }

        #home, #about, #features, #analytics, #students, #faculty, #how, #get-started, #contact {
          scroll-margin-top: 92px;
        }
      `}</style>
    </div>
  );
};

export default Landing;
