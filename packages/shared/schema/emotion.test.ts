import { describe, expect, test } from "bun:test";
import { EmotionSchema, parseEmotionBlock } from "./emotion";

describe("EmotionSchema", () => {
  test("accepts valid emotion", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Fear",
      intensity: "high",
      subtext: "Trying not to show weakness",
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown emotion value", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Neutral",
      intensity: "low",
      subtext: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid intensity", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Joy",
      intensity: "rising",
      subtext: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects subtext longer than 120 chars", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Joy",
      intensity: "low",
      subtext: "x".repeat(121),
    });
    expect(result.success).toBe(false);
  });
});

describe("parseEmotionBlock", () => {
  test("extracts emotion from valid XML block", () => {
    const text = `<emotion>{"emotion":"Fear","intensity":"high","subtext":"Hiding something"}</emotion>`;
    const result = parseEmotionBlock(text);
    expect(result).toEqual({ emotion: "Fear", intensity: "high", subtext: "Hiding something" });
  });

  test("returns null for missing emotion block", () => {
    expect(parseEmotionBlock("Just some text.")).toBeNull();
  });

  test("returns null for malformed JSON inside block", () => {
    expect(parseEmotionBlock("<emotion>{bad json}</emotion>")).toBeNull();
  });

  test("returns null if emotion value is invalid", () => {
    const text = `<emotion>{"emotion":"Neutral","intensity":"low","subtext":""}</emotion>`;
    expect(parseEmotionBlock(text)).toBeNull();
  });
});
