import { useEffect, useRef } from "react";
import knsoftLogo from "@/assets/knsoft-logo.png";

/* ── Floating particles canvas (purple / blue / pink theme) ── */
const ParticleCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    interface Particle {
      x: number; y: number; r: number; dx: number; dy: number;
      opacity: number; color: string; pulseSpeed: number; pulsePhase: number;
    }

    // Vibrant purple / pink / blue palette to match reference image
    const colors = [
      "168, 85, 247",   // Purple
      "236, 72, 153",   // Pink
      "59, 130, 246",   // Blue
      "139, 92, 246",   // Violet
      "217, 70, 239",   // Fuchsia
    ];

    const particles: Particle[] = Array.from({ length: 70 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 3 + 1.5,
      dx: (Math.random() - 0.5) * 0.5,
      dy: (Math.random() - 0.5) * 0.5,
      opacity: Math.random() * 0.5 + 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      pulseSpeed: Math.random() * 0.02 + 0.01,
      pulsePhase: Math.random() * Math.PI * 2,
    }));

    let frame = 0;

    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Connections — soft purple/pink lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 180) {
            const alpha = 0.22 * (1 - dist / 180);
            ctx.beginPath();
            ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        const pulse = Math.sin(frame * p.pulseSpeed + p.pulsePhase) * 0.15 + 1;
        const currentR = p.r * pulse;
        const currentOpacity = p.opacity * (0.85 + pulse * 0.15);

        ctx.beginPath();
        ctx.arc(p.x, p.y, currentR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${currentOpacity})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, currentR * 4, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, currentR * 4);
        grad.addColorStop(0, `rgba(${p.color}, ${currentOpacity * 0.5})`);
        grad.addColorStop(1, `rgba(${p.color}, 0)`);
        ctx.fillStyle = grad;
        ctx.fill();

        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0 || p.x > window.innerWidth) p.dx *= -1;
        if (p.y < 0 || p.y > window.innerHeight) p.dy *= -1;
      }

      animationId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 z-[1]" />;
};

/* ── Main background component ── */
const AuthBackground = () => (
  <>
    {/* Vibrant purple / pink / blue gradient base — matches reference theme */}
    <div
      className="absolute inset-0"
      style={{
        background:
          "linear-gradient(135deg, #e0c3fc 0%, #c2a8f5 18%, #a78bfa 35%, #c084fc 50%, #f0abfc 65%, #a5b4fc 82%, #93c5fd 100%)",
      }}
    />

    {/* Soft white radiance from top-center (matches reference glow) */}
    <div
      className="absolute inset-0 z-[1]"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 60%)",
      }}
    />

    {/* Excellencia Infinitum subtle repeating watermark */}
    <div
      className="absolute inset-0 z-[2] pointer-events-none opacity-[0.12]"
      style={{
        backgroundImage: `url(${excellenciaLogo})`,
        backgroundRepeat: "repeat",
        backgroundSize: "240px auto",
      }}
      aria-hidden="true"
    />

    {/* Flowing pink / purple / blue gradient blobs */}
    <div className="absolute -left-32 top-1/4 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-pink-400/40 to-purple-500/30 blur-3xl auth-float-slow" />
    <div className="absolute -right-32 -top-20 h-[550px] w-[550px] rounded-full bg-gradient-to-bl from-fuchsia-400/35 to-purple-400/25 blur-3xl auth-float-slow-reverse" />
    <div className="absolute -bottom-40 left-1/4 h-[600px] w-[600px] rounded-full bg-gradient-to-tr from-blue-400/40 to-indigo-400/30 blur-3xl auth-float-medium" />
    <div className="absolute bottom-0 -right-20 h-[500px] w-[500px] rounded-full bg-gradient-to-tl from-pink-400/35 to-violet-400/25 blur-3xl auth-float-slow" />
    <div className="absolute left-1/3 top-1/3 h-72 w-72 rounded-full bg-gradient-to-br from-purple-300/30 to-pink-300/20 blur-3xl auth-float-medium" />

    {/* Particle network */}
    <ParticleCanvas />

    {/* Subtle dot grid */}
    <div className="absolute inset-0 z-[2] bg-[radial-gradient(circle_at_1px_1px,rgba(168,85,247,0.08)_1px,transparent_1px)] bg-[length:44px_44px]" />

    {/* Flowing wave layers at bottom — pink/blue ribbons */}
    <div className="absolute bottom-0 left-0 right-0 z-[2] h-48 pointer-events-none">
      <svg viewBox="0 0 1440 200" className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wave1" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgba(236, 72, 153, 0.18)" />
            <stop offset="50%" stopColor="rgba(168, 85, 247, 0.22)" />
            <stop offset="100%" stopColor="rgba(59, 130, 246, 0.18)" />
          </linearGradient>
          <linearGradient id="wave2" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgba(96, 165, 250, 0.16)" />
            <stop offset="50%" stopColor="rgba(192, 132, 252, 0.18)" />
            <stop offset="100%" stopColor="rgba(244, 114, 182, 0.16)" />
          </linearGradient>
        </defs>
        <path
          d="M0,90 C300,150 600,30 900,80 C1140,120 1320,60 1440,90 L1440,200 L0,200 Z"
          fill="url(#wave1)"
          className="auth-wave"
        />
        <path
          d="M0,130 C240,80 600,160 960,110 C1200,80 1380,140 1440,120 L1440,200 L0,200 Z"
          fill="url(#wave2)"
          className="auth-wave-2"
        />
      </svg>
    </div>

    {/* Excellencia Infinitum logo — top left corner */}
    <div className="absolute top-4 left-4 z-[5] pointer-events-none flex items-center gap-2">
      <img
        src={excellenciaLogoFull}
        alt="Excellencia Infinitum"
        className="h-28 sm:h-32 md:h-40 w-auto drop-shadow-lg select-none"
      />
    </div>

    {/* Knsoft Technologies branding — bottom right */}
    <div className="absolute bottom-4 right-4 z-[5] pointer-events-none flex flex-col items-end gap-1">
      <img
        src={knsoftLogo}
        alt="Knsoft Technologies"
        className="h-10 sm:h-12 w-auto opacity-95 drop-shadow-md select-none"
      />
      <span className="text-[10px] sm:text-xs text-slate-700/80 font-medium tracking-wide">
        Powered by Knsoft Technologies
      </span>
    </div>
  </>
);

export default AuthBackground;
