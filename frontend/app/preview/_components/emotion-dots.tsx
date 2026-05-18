const EMOTIONS = ["Joy","Trust","Fear","Surprise","Sadness","Disgust","Anger","Anticipation"]

const EMOTION_COLOR: Record<string, string> = {
  Joy: "var(--signal-warn)", Trust: "var(--signal-ok)", Fear: "var(--ink-dim)",
  Surprise: "var(--accent-bright)", Sadness: "var(--accent-deep)", Disgust: "var(--signal-flag)",
  Anger: "var(--signal-flag)", Anticipation: "var(--accent-oo)",
}

export function EmotionDotsDemo() {
  const active = "Anticipation"
  return (
    <div className="flex flex-col gap-4">
      <p className="t-body-s text-ink-mute">Plutchik&apos;s 8 primary emotions. Active: <strong>{active}</strong>.</p>
      <div className="grid grid-cols-4 gap-3 max-w-xs">
        {EMOTIONS.map((e) => {
          const isActive = e === active
          return (
            <div key={e} className="flex flex-col items-center gap-1.5">
              <span
                className={`size-3 rounded-full transition-all duration-[220ms] ${isActive ? "scale-125 shadow-glow" : "opacity-40"}`}
                style={{ background: EMOTION_COLOR[e] ?? "var(--ink-mute)" }}
              />
              <span className={`t-meta text-center ${isActive ? "t-meta-bright" : ""}`}>{e}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
