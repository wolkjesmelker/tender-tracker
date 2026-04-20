import vdkLogo from '../../assets/vdk-logo.svg'

type SplashScreenProps = {
  onContinue: () => void
}

export function SplashScreen({ onContinue }: SplashScreenProps) {
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center bg-[#0f1729]">
      {/* Logo with fade-in animation */}
      <div className="animate-fade-in flex flex-col items-center gap-8 px-6">
        {/* VDK Logo */}
        <img
          src={vdkLogo}
          alt="Van de Kreeke Groep"
          className="h-36 w-auto max-w-[min(90vw,520px)] drop-shadow-2xl md:h-40"
        />

        {/* App name */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-wider text-white/90">
            TENDER<span className="text-[#ea0029]">TRACKER</span>
          </h1>
          <p className="mt-1 text-sm text-white/40">
            Aanbestedingen monitoring platform
          </p>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="group relative min-w-[200px] rounded-xl border border-white/15 bg-white/[0.07] px-10 py-3.5 text-base font-semibold tracking-wide text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-200 hover:border-[#ea0029]/50 hover:bg-[#ea0029]/15 hover:shadow-[0_12px_40px_rgba(234,0,41,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ea0029] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1729] active:scale-[0.98]"
        >
          <span className="relative z-10">Verder</span>
          <span
            className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{
              background:
                'linear-gradient(135deg, rgba(234,0,41,0.12) 0%, transparent 55%)',
            }}
            aria-hidden
          />
        </button>
      </div>

      {/* Questric branding at bottom (tekst alleen, geen wit logo-vak) */}
      <div className="absolute bottom-8 flex flex-col items-center gap-2">
        <span className="text-base font-semibold tracking-wide text-white/60">Questric</span>
        <a
          href="https://www.questric.eu"
          className="text-[10px] text-white/20 transition-colors hover:text-white/45"
        >
          www.questric.eu
        </a>
      </div>
    </div>
  )
}
