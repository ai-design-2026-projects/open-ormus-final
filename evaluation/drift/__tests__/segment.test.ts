import { describe, it, expect } from "bun:test";
import { splitIntoSegments } from "../segment";

const makeMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    character_name: `char_${i}`,
    content: `msg_${i}`,
    emotion: "neutral",
    intensity: "low",
    reasoning: "",
    subtext: "",
  })) as any[];

describe("splitIntoSegments", () => {
  it("splits 9 messages into 3 equal segments of 3", () => {
    const result = splitIntoSegments(makeMessages(9), 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(3);
    expect(result[1]).toHaveLength(3);
    expect(result[2]).toHaveLength(3);
  });

  it("puts remainder in last segment (10 into 3)", () => {
    const result = splitIntoSegments(makeMessages(10), 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(3);
    expect(result[1]).toHaveLength(3);
    expect(result[2]).toHaveLength(4);
  });

  it("splits exactly into 2 segments", () => {
    const result = splitIntoSegments(makeMessages(6), 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(3);
    expect(result[1]).toHaveLength(3);
  });

  it("preserves message order", () => {
    const msgs = makeMessages(4);
    const result = splitIntoSegments(msgs, 2);
    expect(result[0]![0]!.content).toBe("msg_0");
    expect(result[1]![0]!.content).toBe("msg_2");
  });

  it("throws when messages.length < segments", () => {
    expect(() => splitIntoSegments(makeMessages(2), 3)).toThrow(
      "Cannot split 2 messages into 3 segments",
    );
  });

  it("throws when n < 2", () => {
    expect(() => splitIntoSegments(makeMessages(5), 1)).toThrow("segments must be ≥ 2");
  });
});
