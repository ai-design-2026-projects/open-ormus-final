const EMOTION_COLOR: Record<string, string> = {
  Joy: "var(--signal-warn)",
  Trust: "var(--signal-ok)",
  Fear: "var(--ink-dim)",
  Surprise: "var(--accent-bright)",
  Sadness: "var(--accent-deep)",
  Disgust: "var(--signal-flag)",
  Anger: "var(--signal-flag)",
  Anticipation: "var(--accent-oo)",
};

interface EmotionDotProps {
  emotion: string;
  intensity: "low" | "medium" | "high";
  subtext?: string;
  showLabel?: boolean;
}

export function EmotionDot({ emotion, intensity, subtext, showLabel = false }: EmotionDotProps) {
  const color = EMOTION_COLOR[emotion] ?? "var(--ink-mute)";
  const sizeClass = intensity === "low" ? "size-2 opacity-60" : "size-3";
  const ringClass = intensity === "high" ? "shadow-glow animate-pulse" : "";

  const dot = (
    <span
      className={`rounded-full inline-block shrink-0 ${sizeClass} ${ringClass}`}
      style={{ background: color }}
    />
  );

  if (!showLabel) {
    return <span title={subtext || undefined}>{dot}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {dot}
      <span className="text-xs" style={{ color: "var(--ink-mute)" }}>
        {emotion}{subtext ? ` · "${subtext}"` : ""}
      </span>
    </span>
  );
}
