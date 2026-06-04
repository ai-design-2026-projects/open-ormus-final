import Link from "next/link"

const SAMPLE_SCRIPT = [
  {
    char: "SHERLOCK HOLMES",
    emotion: "ANTICIPATION · LOW",
    text: "You're late, Professor. Twelve minutes is uncharacteristic — even of trains.",
  },
  {
    char: "JAMES MORIARTY",
    emotion: "TRUST · FEIGNED",
    text: "I was watching you read the same telegram four times. I am curious what it said the fourth.",
  },
  {
    char: "SHERLOCK HOLMES",
    emotion: "JOY · COLD",
    text: "It said you would board the 6:14 with a leather case and a second-class ticket. The second-class part interests me.",
  },
]

const FEATURES = [
  {
    label: "LIBRARY",
    title: "Assemble your cast.",
    body: "Import characters from any public-domain source, or build them field by field with the wizard. Each sheet tracks traits, speech patterns, fears, and knowledge scope.",
    meta: "PUBLIC DOMAIN TO ORIGINAL",
  },
  {
    label: "SCENE",
    title: "Direct, or step in.",
    body: "Set the stage, choose the cast, and run the scene. Watch characters unfold turn by turn, or join as a participant and speak your own lines. The AI orchestrator decides who speaks, or you set the order.",
    meta: "ANY CAST SIZE · DIRECTOR OR PARTICIPANT",
  },
  {
    label: "ASSISTANT",
    title: "Think through your cast.",
    body: "Chat with the built-in assistant to develop a character's backstory, explore how two personalities would clash, or plan a scene before it runs. The same tool registry powers both.",
    meta: "TOOL-AUGMENTED · SAME REGISTRY",
  },
]

const CONTRASTS = [
  { bad: 'System prompt: "You are Sherlock Holmes."', good: 'Traits, speech patterns, fears, goals. A structured sheet.' },
  { bad: 'One character in a single chat window.', good: 'As many characters as the scene needs.' },
  { bad: 'No record of how the exchange went.', good: 'Plutchik emotion per turn. Reasoning exposed.' },
]

export function LandingPage() {
  return (
    <>
      <style>{`
        @keyframes land-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes land-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30% { transform: translateY(-3px); opacity: 1; }
        }
        .land-fade { animation: land-up 0.65s cubic-bezier(0.22,1,0.36,1) both; }
        .land-d1 { animation-delay: 0.04s; }
        .land-d2 { animation-delay: 0.12s; }
        .land-d3 { animation-delay: 0.22s; }
        .land-d4 { animation-delay: 0.34s; }
        .land-d5 { animation-delay: 0.50s; }
        .land-dot span { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--accent-oo); animation: land-dot 1.2s ease-in-out infinite; }
        .land-dot span:nth-child(2) { animation-delay: 0.15s; }
        .land-dot span:nth-child(3) { animation-delay: 0.30s; }
      `}</style>

      <div className="bg-background min-h-screen flex flex-col">

        {/* ── Navigation ── */}
        <nav
          className="sticky top-0 z-50 border-b border-hair backdrop-blur-[10px]"
          style={{ background: "color-mix(in oklch, var(--surface-1) 85%, transparent)" }}
        >
          <div className="max-w-[1280px] mx-auto px-8 h-14 flex items-center gap-4">
            <div className="flex items-center gap-2.5 shrink-0">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <circle cx="10" cy="12" r="6.5" fill="none" stroke="var(--ink)" strokeWidth="1.4" />
                <circle cx="14" cy="12" r="6.5" fill="none" stroke="var(--accent-oo)" strokeWidth="1.4" />
              </svg>
              <span className="font-medium text-[15px] tracking-[-0.01em]">
                Open<em className="t-editorial">Ormus</em>
              </span>
            </div>
            <div className="flex-1" />
            <Link
              href="/login"
              className="text-[13px] text-ink-dim hover:text-ink transition-colors duration-[120ms] px-3 py-1.5 rounded-lg hover:bg-[color-mix(in_oklch,var(--ink)_5%,transparent)]"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center h-9 px-4 rounded-[var(--r-md)] text-[13px] font-medium text-on-ink transition-colors duration-[120ms]"
              style={{
                background: "var(--ink-panel)",
                boxShadow: "0 0 0 1px var(--ink-panel), inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(20,24,40,0.10)",
              }}
            >
              Get started
            </Link>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="relative max-w-[1280px] mx-auto w-full px-8 pt-20 pb-16 grid lg:grid-cols-[1fr_500px] gap-16 items-center">
          {/* Accent wash */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(800px 500px at 75% 40%, color-mix(in oklch, var(--accent-oo) 7%, transparent), transparent 65%)" }}
          />

          {/* Left: text */}
          <div className="relative">
            <p className="t-meta land-fade land-d1">CHARACTER SIMULATION STUDIO · MULTI-AGENT LLM</p>
            <h1 className="t-h1 mt-3 mb-0 land-fade land-d2">
              The <em className="t-editorial">cast</em><br />you&apos;ve assembled.
            </h1>
            <p
              className="t-body-l text-ink-dim mt-5 land-fade land-d3"
              style={{ maxWidth: "460px", lineHeight: 1.6 }}
            >
              Import characters from public-domain sources, or build them field by
              field. Put two or more into a scene. Watch, direct, or step in yourself.
            </p>
            <p className="t-body-s text-ink-mute mt-3 land-fade land-d3" style={{ maxWidth: "400px" }}>
              Every turn logged: emotion, intensity, the reasoning behind each line.
            </p>
            <div className="flex items-center gap-3 mt-8 land-fade land-d4">
              <Link
                href="/register"
                className="inline-flex items-center h-11 px-5 rounded-[var(--r-lg)] text-[14px] font-medium text-on-ink transition-all duration-[120ms]"
                style={{
                  background: "var(--ink-panel)",
                  boxShadow: "0 0 0 1px var(--ink-panel), inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px -8px rgba(20,24,40,0.20)",
                }}
              >
                Get started
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center h-11 px-5 rounded-[var(--r-lg)] text-[14px] font-medium text-ink border border-hair-strong hover:border-ink-faint transition-all duration-[120ms]"
                style={{ boxShadow: "var(--shadow-inset), var(--shadow-1)" }}
              >
                Sign in →
              </Link>
            </div>
            <div className="flex items-center gap-3 mt-6 land-fade land-d5">
              <span className="t-meta">LIBRARY · SCENE · ASSISTANT</span>
              <span className="size-1 rounded-full bg-hair-strong" />
              <span className="t-meta">ONE REGISTRY · THREE SURFACES</span>
            </div>
          </div>

          {/* Right: screenplay specimen card */}
          <div className="relative hidden lg:block land-fade land-d5">
            <div
              className="absolute -inset-6 rounded-[32px] pointer-events-none"
              style={{ background: "radial-gradient(500px 400px at 50% 50%, color-mix(in oklch, var(--accent-oo) 9%, transparent), transparent 70%)" }}
            />
            <div
              className="relative rounded-[var(--r-xl)] overflow-hidden border"
              style={{
                background: "var(--ink-panel)",
                borderColor: "var(--hair-on-ink)",
                boxShadow: "var(--shadow-3), 0 0 0 1px color-mix(in oklch, var(--accent-oo) 8%, transparent)",
              }}
            >
              {/* Card header */}
              <div
                className="flex items-center justify-between px-5 py-3 border-b"
                style={{ borderColor: "var(--hair-on-ink)" }}
              >
                <span className="t-meta" style={{ color: "var(--on-ink-mute)" }}>
                  SAMPLE · GENERATED SCENE
                </span>
                <div className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full" style={{ background: "var(--signal-ok)" }} />
                  <span className="t-meta" style={{ color: "var(--on-ink-dim)" }}>LIVE · 12T</span>
                </div>
              </div>

              {/* Dot grid */}
              <div className="absolute inset-0 grid-field opacity-[0.07] pointer-events-none" />

              {/* Scene content */}
              <div className="relative px-7 pt-6 pb-5">
                <div
                  className="font-mono text-[11px] tracking-[0.05em] uppercase pb-4 mb-5 border-b"
                  style={{ color: "var(--on-ink-mute)", borderColor: "var(--hair-on-ink)" }}
                >
                  INT. KING'S CROSS PLATFORM 4 — DUSK · APRIL 1891
                </div>
                <p
                  className="t-editorial text-[14px] mb-6"
                  style={{ color: "var(--on-ink-dim)", lineHeight: 1.65 }}
                >
                  Fog rolls between rails. The 6:14 is twelve minutes late.
                  Holmes stands beneath a gaslamp, reading a telegram.
                </p>

                {SAMPLE_SCRIPT.map((line, i) => (
                  <div key={i} className="mb-5 text-center">
                    <div className="font-mono text-[11px] tracking-[0.08em] font-medium mb-1.5">
                      <span style={{ color: "var(--on-ink)" }}>{line.char}</span>
                      <span className="ml-2 text-[10px]" style={{ color: "var(--accent-glow)" }}>
                        — {line.emotion}
                      </span>
                    </div>
                    <p
                      className="text-[14px] mx-auto"
                      style={{
                        color: "var(--on-ink)",
                        lineHeight: 1.55,
                        maxWidth: "42ch",
                        margin: 0,
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      {line.text}
                    </p>
                  </div>
                ))}

                {/* Typing indicator */}
                <div className="flex items-center justify-center gap-2 mt-3 opacity-55">
                  <span
                    className="font-mono text-[10px] tracking-[0.08em] uppercase"
                    style={{ color: "var(--on-ink-dim)" }}
                  >
                    JAMES MORIARTY IS COMPOSING
                  </span>
                  <span className="land-dot flex gap-1">
                    <span /><span /><span />
                  </span>
                </div>
              </div>

              {/* Card footer */}
              <div
                className="px-5 py-3 border-t flex items-center justify-between"
                style={{ borderColor: "var(--hair-on-ink)", background: "rgba(255,255,255,0.02)" }}
              >
                <span className="t-meta" style={{ color: "var(--on-ink-mute)" }}>
                  SHERLOCK × MORIARTY
                </span>
                <span className="t-meta" style={{ color: "var(--on-ink-mute)" }}>
                  TURN 12 OF 30
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Prismatic divider ── */}
        <div className="hair-prism" />

        {/* ── Stats strip ── */}
        <div className="border-b border-hair bg-surface-1">
          <div className="max-w-[1280px] mx-auto px-8 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="t-meta t-meta-bright">CHARACTER-FIRST</span>
            <span className="size-1 rounded-full bg-hair-strong hidden sm:block" />
            <span className="t-meta t-meta-bright">TWO OR MORE ON STAGE</span>
            <span className="size-1 rounded-full bg-hair-strong hidden sm:block" />
            <span className="t-meta t-meta-bright">LIBRARY · SCENE · ASSISTANT</span>
            <div className="flex-1" />
            <span className="t-meta">DIRECT OR PARTICIPATE, YOUR CALL</span>
          </div>
        </div>

        {/* ── Features (dark ink panel) ── */}
        <section className="bg-ink-panel relative overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(900px 500px at 15% 60%, color-mix(in oklch, var(--accent-oo) 11%, transparent), transparent 65%)" }}
          />
          <div className="absolute inset-0 scan-field opacity-25 pointer-events-none" />

          <div className="relative max-w-[1280px] mx-auto px-8 py-20">
            <p className="t-meta mb-4" style={{ color: "var(--on-ink-mute)" }}>WHAT IT DOES</p>
            <h2 className="t-h2 mb-16" style={{ color: "var(--on-ink)", maxWidth: "560px", lineHeight: 1.05 }}>
              One tool.<br />Three <em className="t-editorial">surfaces.</em>
            </h2>

            <div className="grid lg:grid-cols-3 gap-5">
              {FEATURES.map((f) => (
                <div
                  key={f.label}
                  className="rounded-[var(--r-xl)] p-7 border flex flex-col gap-5"
                  style={{ background: "var(--ink-panel-2)", borderColor: "var(--hair-on-ink)" }}
                >
                  <div>
                    <p className="t-meta mb-3" style={{ color: "var(--on-ink-mute)" }}>{f.label}</p>
                    <h3 className="t-h5 m-0" style={{ color: "var(--on-ink)" }}>{f.title}</h3>
                  </div>
                  <p
                    className="text-[14px] flex-1 m-0"
                    style={{ color: "var(--on-ink-dim)", lineHeight: 1.7 }}
                  >
                    {f.body}
                  </p>
                  <div
                    className="pt-5 border-t"
                    style={{ borderColor: "var(--hair-on-ink)" }}
                  >
                    <span className="t-meta" style={{ color: "var(--accent-glow)" }}>{f.meta}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Prismatic divider ── */}
        <div className="hair-prism" />

        {/* ── Director section ── */}
        <section className="max-w-[1280px] mx-auto px-8 py-20">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="t-meta mb-4">THE STAGE</p>
              <h2 className="t-h2 mb-6">
                You <em className="t-editorial">set</em> the scene.<br />You choose your role.
              </h2>
              <p
                className="t-body-l text-ink-dim mb-8"
                style={{ maxWidth: "460px", lineHeight: 1.65 }}
              >
                Assemble the cast, describe the setting, and decide how you want to
                engage. Watch from outside as the characters run the scene, or join
                as a participant and speak your own lines. Either way, every turn is
                tracked: emotion, intensity, the Plutchik wheel.
              </p>
              <Link
                href="/register"
                className="inline-flex items-center h-10 px-5 rounded-[var(--r-lg)] text-[13.5px] font-medium text-ink border border-hair-strong hover:border-ink-faint transition-all duration-[120ms]"
                style={{ boxShadow: "var(--shadow-inset), var(--shadow-1)" }}
              >
                Open the stage →
              </Link>
            </div>

            {/* Before / After */}
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 mb-1">
                <span className="t-meta px-1">GENERIC LLM ROLEPLAY</span>
                <span className="t-meta px-1">OPENORMUS</span>
              </div>
              {CONTRASTS.map((pair, i) => (
                <div key={i} className="grid grid-cols-2 gap-3 text-[13px]">
                  <div
                    className="rounded-[var(--r-md)] px-4 py-3 border border-dashed"
                    style={{
                      borderColor: "color-mix(in oklch, var(--signal-flag) 25%, var(--hair))",
                      color: "var(--ink-mute)",
                      background: "color-mix(in oklch, var(--signal-flag) 3%, var(--surface-1))",
                    }}
                  >
                    {pair.bad}
                  </div>
                  <div
                    className="rounded-[var(--r-md)] px-4 py-3 border font-medium"
                    style={{
                      borderColor: "color-mix(in oklch, var(--signal-ok) 28%, var(--hair))",
                      color: "var(--ink)",
                      background: "color-mix(in oklch, var(--signal-ok) 5%, var(--surface-1))",
                    }}
                  >
                    {pair.good}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="max-w-[1280px] mx-auto px-8 pb-20">
          <div
            className="glass rounded-[var(--r-xl)] px-10 py-12 text-center relative overflow-hidden"
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(700px 400px at 50% 50%, color-mix(in oklch, var(--accent-oo) 7%, transparent), transparent 70%)" }}
            />
            <div className="relative">
              <p className="t-meta mb-4">READY TO OPEN THE STAGE?</p>
              <h2 className="t-h3 mb-3">
                A library, a few characters,<br />and a <em className="t-editorial">scene.</em>
              </h2>
              <p className="text-[14px] text-ink-dim mb-8 max-w-[360px] mx-auto" style={{ lineHeight: 1.6 }}>
                In under a minute.
              </p>
              <div className="flex items-center justify-center gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center h-11 px-6 rounded-[var(--r-lg)] text-[14px] font-medium text-on-ink transition-all duration-[120ms]"
                  style={{
                    background: "var(--ink-panel)",
                    boxShadow: "0 0 0 1px var(--ink-panel), inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  Create an account
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center h-11 px-5 text-[14px] font-medium text-ink-dim hover:text-ink transition-colors duration-[120ms]"
                >
                  Sign in →
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="border-t border-hair mt-auto">
          <div className="max-w-[1280px] mx-auto px-8 py-6 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <circle cx="10" cy="12" r="6.5" fill="none" stroke="var(--ink-faint)" strokeWidth="1.4" />
                <circle cx="14" cy="12" r="6.5" fill="none" stroke="var(--ink-faint)" strokeWidth="1.4" />
              </svg>
              <span className="t-meta">OPENORMUS · CHARACTER SIMULATION STUDIO · 2026</span>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/login" className="t-meta hover:text-ink-dim transition-colors duration-[120ms]">
                SIGN IN
              </Link>
              <Link href="/register" className="t-meta hover:text-ink-dim transition-colors duration-[120ms]">
                REGISTER
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
