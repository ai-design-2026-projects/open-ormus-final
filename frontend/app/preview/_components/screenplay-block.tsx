type BlockType = "slug" | "stage" | "paren" | "line"

interface ScriptBlock {
  type: BlockType
  text: string
  char?: string
  emotion?: string
}

const SCRIPT: ScriptBlock[] = [
  { type: "slug", text: "INT. KING'S CROSS PLATFORM 4 — DUSK · APRIL 1891" },
  { type: "stage", text: "Fog rolls between rails. HOLMES stands beneath a gaslamp, reading a telegram. From the column of escaping steam, MORIARTY steps into view." },
  { type: "line", char: "Sherlock Holmes", emotion: "Anticipation · low", text: "You're late, Professor. Twelve minutes is uncharacteristic — even of trains." },
  { type: "line", char: "James Moriarty", emotion: "Trust · feigned", text: "I was watching you read the same telegram four times. I am curious what it said the fourth." },
  { type: "paren", text: "(Holmes folds the telegram precisely, in thirds.)" },
  { type: "line", char: "Sherlock Holmes", emotion: "Joy · cold", text: "It said you would board the 6:14 with a leather case and a second-class ticket. The second-class part interests me." },
]

function Block({ b }: { b: ScriptBlock }) {
  if (b.type === "slug") {
    return <div className="font-mono text-[11.5px] font-semibold tracking-[0.06em] text-ink-dim uppercase mt-6 mb-2">{b.text}</div>
  }
  if (b.type === "stage") {
    return <p className="t-editorial text-[13.5px] text-ink-mute italic mx-auto my-3" style={{ maxWidth: 560 }}>{b.text}</p>
  }
  if (b.type === "paren") {
    return <p className="t-editorial text-[12.5px] text-ink-faint italic my-1 ml-12">{b.text}</p>
  }
  return (
    <div className="my-4">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-mono text-[11px] font-semibold tracking-[0.05em] text-ink">{b.char?.toUpperCase()}</span>
        <span className="t-meta">— {b.emotion?.toUpperCase()}</span>
      </div>
      <p className="t-body text-ink leading-relaxed ml-0">{b.text}</p>
    </div>
  )
}

export function ScreenplayDemo() {
  return (
    <div
      className="rounded-xl border border-hair shadow-[var(--shadow-2)] p-8 max-w-2xl"
      style={{
        background: "linear-gradient(180deg, oklch(0.98 0.008 85) 0%, oklch(0.975 0.006 85) 100%)",
        borderLeft: "4px solid var(--signal-flag)",
      }}
    >
      {SCRIPT.map((b, i) => <Block key={i} b={b} />)}
      <div className="mt-6 pt-4 border-t border-hair flex items-center gap-2">
        <span className="t-meta">JAMES MORIARTY IS COMPOSING</span>
        <span className="flex gap-1">
          {[0,1,2].map((i) => (
            <span
              key={i}
              className="size-1.5 rounded-full bg-accent-oo"
              style={{ animation: `pulse 1.2s ${i * 0.2}s infinite` }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
