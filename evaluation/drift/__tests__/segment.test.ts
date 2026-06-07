import { describe, it, expect } from "bun:test";
import { segmentConversation } from "../../shared/segmenter";

const makeMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    turn: i + 1,
    character_id: `char_${i}`,
    character_name: `char_${i}`,
    content: `msg_${i}`,
    emotion: "neutral",
    intensity: "low",
    reasoning: "",
    subtext: "",
  })) as any[];

describe("segmentConversation", () => {
  it("splits 9 messages into 3 equal segments of 3", () => {
    const result = segmentConversation(makeMessages(9), 3);
    expect(result).toHaveLength(3);
    expect(result[0]!.messages).toHaveLength(3);
    expect(result[1]!.messages).toHaveLength(3);
    expect(result[2]!.messages).toHaveLength(3);
  });

  it("puts remainder in last segment (10 into 3)", () => {
    const result = segmentConversation(makeMessages(10), 3);
    expect(result).toHaveLength(3);
    expect(result[0]!.messages).toHaveLength(3);
    expect(result[1]!.messages).toHaveLength(3);
    expect(result[2]!.messages).toHaveLength(4);
  });

  it("splits exactly into 2 segments", () => {
    const result = segmentConversation(makeMessages(6), 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.messages).toHaveLength(3);
    expect(result[1]!.messages).toHaveLength(3);
  });

  it("preserves message order", () => {
    const msgs = makeMessages(4);
    const result = segmentConversation(msgs, 2);
    expect(result[0]!.messages[0]!.content).toBe("msg_0");
    expect(result[1]!.messages[0]!.content).toBe("msg_2");
  });

  it("returns empty array for empty messages", () => {
    expect(segmentConversation([], 3)).toHaveLength(0);
  });

  it("clamps segments to message count when n > messages.length", () => {
    const result = segmentConversation(makeMessages(2), 3);
    expect(result).toHaveLength(2);
  });

  it("exposes segment_index, turn_range, and messages on each segment", () => {
    const result = segmentConversation(makeMessages(4), 2);
    expect(result[0]!.segment_index).toBe(0);
    expect(result[0]!.turn_range).toEqual([1, 2]);
    expect(result[1]!.segment_index).toBe(1);
    expect(result[1]!.turn_range).toEqual([3, 4]);
  });
});
