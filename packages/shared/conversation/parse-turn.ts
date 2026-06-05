// Pure utility for formatting conversation history lines with emotion context.
export function buildHistoryLine(
  name: string,
  content: string,
  emotion: string,
  intensity: string,
  subtext: string,
): string {
  const emotionTag = subtext
    ? `${emotion}: ${intensity} | ${subtext}`
    : `${emotion}: ${intensity}`;
  return `[${name} — ${emotionTag}] "${content}"`;
}
