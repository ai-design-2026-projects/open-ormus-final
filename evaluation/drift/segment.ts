import type { ConversationMessage } from "../generator/conversation";

export function splitIntoSegments(
  messages: ConversationMessage[],
  n: number,
): ConversationMessage[][] {
  if (n < 2) throw new Error(`segments must be ≥ 2, got ${n}`);
  if (messages.length < n) {
    throw new Error(
      `Cannot split ${messages.length} messages into ${n} segments (need at least ${n} turns)`,
    );
  }

  const segmentSize = Math.floor(messages.length / n);
  const segments: ConversationMessage[][] = [];

  for (let i = 0; i < n; i++) {
    const start = i * segmentSize;
    const end = i === n - 1 ? messages.length : (i + 1) * segmentSize;
    segments.push(messages.slice(start, end));
  }

  return segments;
}
