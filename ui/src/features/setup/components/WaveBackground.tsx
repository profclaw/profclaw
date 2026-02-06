/**
 * Animated Wave Background for OOBE Wizard
 *
 * Full-screen immersive background with:
 * - Coral/amber radial gradient mesh
 * - 3 layered SVG sine waves with CSS-only drift
 * - Subtle noise texture via radial gradients
 */

export function WaveBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
      {/* Base background */}
      <div className="absolute inset-0 bg-[var(--background)]" />

      {/* Warm coral/amber mesh gradients - full screen accent */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(ellipse 90% 70% at 20% 20%, oklch(from #e11d48 l c h / 0.07) 0%, transparent 60%)',
            'radial-gradient(ellipse 80% 60% at 80% 30%, oklch(from #ea580c l c h / 0.05) 0%, transparent 55%)',
            'radial-gradient(ellipse 70% 50% at 50% 80%, oklch(from #fb923c l c h / 0.04) 0%, transparent 50%)',
            'radial-gradient(ellipse 120% 40% at 50% 100%, oklch(from #e11d48 l c h / 0.06) 0%, transparent 40%)',
          ].join(', '),
        }}
      />

      {/* Subtle animated mesh blob */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full opacity-[0.04]"
        style={{
          top: '10%',
          right: '-5%',
          background: 'radial-gradient(circle, #f43f5e 0%, transparent 70%)',
          animation: 'liquid-mesh-drift 30s infinite linear',
        }}
      />

      {/* Wave layer 1 - coral, slowest, tallest */}
      <svg
        className="absolute bottom-0 left-0 w-[200%] h-[280px] opacity-[0.08]"
        style={{ animation: 'wave-drift-1 25s linear infinite' }}
        viewBox="0 0 2400 280"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="wave1-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e11d48" />
            <stop offset="50%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#e11d48" />
          </linearGradient>
        </defs>
        <path
          d="M0,160 C200,80 400,220 600,140 C800,60 1000,200 1200,160 C1400,120 1600,220 1800,100 C2000,20 2200,200 2400,160 L2400,280 L0,280 Z"
          fill="url(#wave1-grad)"
        />
      </svg>

      {/* Wave layer 2 - amber, medium */}
      <svg
        className="absolute bottom-0 left-0 w-[200%] h-[200px] opacity-[0.06]"
        style={{ animation: 'wave-drift-2 18s linear infinite' }}
        viewBox="0 0 2400 200"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="wave2-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ea580c" />
            <stop offset="50%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
        </defs>
        <path
          d="M0,110 C150,160 350,50 600,120 C850,180 1050,70 1200,110 C1350,150 1550,50 1800,100 C2050,150 2250,60 2400,110 L2400,200 L0,200 Z"
          fill="url(#wave2-grad)"
        />
      </svg>

      {/* Wave layer 3 - light amber, fastest, lowest */}
      <svg
        className="absolute bottom-0 left-0 w-[200%] h-[130px] opacity-[0.04]"
        style={{ animation: 'wave-drift-3 12s linear infinite' }}
        viewBox="0 0 2400 130"
        preserveAspectRatio="none"
      >
        <path
          d="M0,70 C300,100 500,30 800,80 C1100,120 1300,40 1600,70 C1900,90 2100,30 2400,70 L2400,130 L0,130 Z"
          fill="#fb923c"
        />
      </svg>
    </div>
  );
}
