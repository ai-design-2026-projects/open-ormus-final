import type { ConversationMessage } from "../generator/conversation";

export type Segment = {
  segment_index: number;
  turn_range: [number, number];
  messages: ConversationMessage[];
};

export function segmentConversation(messages: ConversationMessage[], n: number): Segment[] {
  if (messages.length === 0) return [];

  // Clamp to avoid empty slices when messages < n
  const effectiveN = Math.min(n, messages.length);
  const sliceSize = Math.floor(messages.length / effectiveN);
  const segments: Segment[] = [];

  for (let i = 0; i < effectiveN; i++) {
    const start = i * sliceSize;
    const end = i === effectiveN - 1 ? messages.length : start + sliceSize;
    const slice = messages.slice(start, end);

    segments.push({
      segment_index: i,
      turn_range: [slice[0]!.turn, slice[slice.length - 1]!.turn],
      messages: slice,
    });
  }

  return segments;
}
