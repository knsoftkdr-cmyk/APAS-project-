import { useEffect } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSolutionBySlug, solutions } from "@/data/solutions";
import apasLogo from "@/assets/APAS-logo.png";

const SolutionDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const solution = getSolutionBySlug(slug ?? "");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!solution) {
    return <Navigate to="/" replace />;
  }

  const Icon = solution.icon;
  const otherSolutions = solutions.filter((s) => s.slug !== solution.slug).slice(0, 3);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Helmet>
        <title>{solution.title} | APAS Education ERP</title>
        <meta name="description" content={solution.heroSubtitle} />
      </Helmet>

      {/* Top bar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src={apasLogo} alt="APAS Logo" className="h-14 w-auto object-contain" />
          </Link>
          <div className="hidden sm:flex items-center gap-3">
            <Link to={`/get-started/${solution.slug}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="rounded-full">Start for Free</Button>
            </Link>
            <Link to="/request-demo">
              <Button className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white shadow-lg shadow-blue-500/30 rounded-full">
                Request Demo
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/60 via-white to-white px-6 py-20 md:py-28">
        <div className="absolute top-10 -left-20 w-72 h-72 bg-blue-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-green-200/30 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto relative grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100 text-xs font-semibold text-blue-900 mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              {solution.badge}
            </div>

            <div
              className={`w-16 h-16 rounded-2xl ${solution.iconBg} flex items-center justify-center shadow-xl shadow-blue-500/20 mb-6`}
            >
              <Icon className="w-8 h-8 text-white" />
            </div>

            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-5">
              {solution.title}
            </h1>
            <p className="text-lg text-slate-600 max-w-xl mb-8 leading-relaxed">
              {solution.heroSubtitle}
            </p>

            <div className="flex flex-wrap gap-3">
              <Link to="/request-demo">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 hover:opacity-90 text-white shadow-lg shadow-blue-500/30 rounded-full px-6"
                >
                  Request Demo <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
              <Link to={`/get-started/${solution.slug}`} target="_blank" rel="noopener noreferrer">
                <Button size="lg" variant="outline" className="rounded-full px-6">
                  Start for Free
                </Button>
              </Link>
            </div>
          </div>

          {/* Right side: dashboard illustration */}
          <div className="relative h-[420px] md:h-[480px]">
            <div
              className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${solution.colorFrom} ${solution.colorTo} p-1 shadow-2xl shadow-blue-500/30`}
            >
              <div className="w-full h-full rounded-3xl bg-white p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500">{solution.title} Overview</div>
                    <div className="font-bold text-lg">Live Dashboard</div>
                  </div>
                  <div className={`w-10 h-10 rounded-xl ${solution.iconBg} flex items-center justify-center`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {solution.stats.map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-xl bg-slate-50 border border-slate-100 p-4 flex items-center justify-between"
                    >
                      <span className="text-sm text-slate-600">{stat.label}</span>
                      <span
                        className={`text-xl font-extrabold bg-gradient-to-r ${solution.colorFrom} ${solution.colorTo} bg-clip-text text-transparent`}
                      >
                        {stat.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto rounded-xl bg-gradient-to-r from-blue-500/10 to-green-500/10 border border-blue-100 p-3 flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-blue-800 mt-0.5 shrink-0" />
                  <div className="text-xs text-slate-700">
                    <b>AI Insight:</b> Trends and anomalies are surfaced automatically, no manual reports needed.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Overview */}
      <section className="px-6 py-16 border-t border-slate-100">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">What {solution.title} does for you</h2>
          <p className="text-slate-600 leading-relaxed">{solution.overview}</p>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-16 bg-gradient-to-b from-white via-blue-50/40 to-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-blue-100 text-xs font-semibold text-blue-900 mb-4">
              Key Capabilities
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              Everything you need, built in
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {solution.features.map((feature) => {
              const FeatureIcon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="group rounded-3xl border border-blue-100 bg-white p-6 shadow-sm hover:shadow-xl hover:shadow-blue-200/40 hover:-translate-y-1 transition-all duration-300"
                >
                  <div
                    className={`w-12 h-12 rounded-xl ${solution.iconBg} flex items-center justify-center mb-4 shadow-md group-hover:scale-105 transition-transform`}
                  >
                    <FeatureIcon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-bold text-lg mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{feature.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="px-6 py-16">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-3 gap-6 text-center">
          {solution.stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-blue-100 p-8 bg-white shadow-sm">
              <div
                className={`text-4xl font-extrabold bg-gradient-to-r ${solution.colorFrom} ${solution.colorTo} bg-clip-text text-transparent mb-2`}
              >
                {stat.value}
              </div>
              <div className="text-sm text-slate-600">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Explore other solutions */}
      {otherSolutions.length > 0 && (
      <section className="px-6 py-16 border-t border-slate-100">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center">Explore other solutions</h2>
          <div
            className={`grid gap-6 max-w-3xl mx-auto ${
              otherSolutions.length === 1
                ? "sm:grid-cols-1 max-w-md"
                : otherSolutions.length === 2
                ? "sm:grid-cols-2"
                : "sm:grid-cols-3"
            }`}
          >
            {otherSolutions.map((other) => {
              const OtherIcon = other.icon;
              return (
                <Link
                  key={other.slug}
                  to={`/solutions/${other.slug}`}
                  className="group rounded-2xl border border-blue-100 bg-white p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
                >
                  <div
                    className={`w-10 h-10 rounded-lg ${other.iconBg} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}
                  >
                    <OtherIcon className="w-5 h-5 text-white" />
                  </div>
                  <div className="font-semibold text-sm mb-1 flex items-center gap-1">
                    {other.title}
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">{other.cardDesc}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* CTA */}
      <section className="px-6 py-20 bg-gradient-to-r from-blue-600 via-blue-800 to-green-600">
        <div className="max-w-3xl mx-auto text-center text-white">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
            Ready to see {solution.title} in action?
          </h2>
          <p className="text-blue-100 mb-8">
            Book a personalized walkthrough with our team and see how APAS fits your institution.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/request-demo">
              <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50 rounded-full px-6">
                Request Demo <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link to={`/get-started/${solution.slug}`} target="_blank" rel="noopener noreferrer">
              <Button
                size="lg"
                variant="outline"
                className="rounded-full px-6 border-white/60 text-white hover:bg-white/10"
              >
                Start for Free
              </Button>
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-blue-100">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> No setup fees</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Guided onboarding</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Dedicated support</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 bg-slate-900 text-slate-400 text-center text-sm">
        <Link to="/" className="hover:text-white transition-colors">
          &larr; Back to APAS Home
        </Link>
      </footer>
    </div>
  );
};

export default SolutionDetail;
