import { describe, test, expect } from "bun:test";
import { segmentConversation } from "../segmenter";
import type { ConversationMessage } from "../../generator/conversation";

function makeMessages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    turn: i + 1,
    character_id: "char_001",
    character_name: "Alice",
    emotion: "neutral",
    intensity: "low",
    subtext: "",
    reasoning: null,
    content: `message ${i + 1}`,
  }));
}

describe("segmentConversation", () => {
  test("N=2 even: equal split", () => {
    const segs = segmentConversation(makeMessages(6), 2);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.messages).toHaveLength(3);
    expect(segs[1]!.messages).toHaveLength(3);
  });

  test("N=2 odd: last segment absorbs remainder", () => {
    const segs = segmentConversation(makeMessages(7), 2);
    expect(segs[0]!.messages).toHaveLength(3);
    expect(segs[1]!.messages).toHaveLength(4);
  });

  test("N=3: segment_index is 0-based", () => {
    const segs = segmentConversation(makeMessages(9), 3);
    expect(segs.map((s) => s.segment_index)).toEqual([0, 1, 2]);
  });

  test("N=3: turn_range is inclusive 1-based", () => {
    const segs = segmentConversation(makeMessages(9), 3);
    expect(segs[0]!.turn_range).toEqual([1, 3]);
    expect(segs[1]!.turn_range).toEqual([4, 6]);
    expect(segs[2]!.turn_range).toEqual([7, 9]);
  });

  test("empty messages returns empty array", () => {
    expect(segmentConversation([], 3)).toHaveLength(0);
  });

  test("N > messages.length: clamps to messages.length segments", () => {
    const segs = segmentConversation(makeMessages(5), 6);
    expect(segs).toHaveLength(5);
  });

  test("all messages are covered with no duplicates", () => {
    const segs = segmentConversation(makeMessages(10), 3);
    const allTurns = segs.flatMap((s) => s.messages.map((m) => m.turn));
    expect(allTurns).toHaveLength(10);
    expect(new Set(allTurns).size).toBe(10);
  });
});
