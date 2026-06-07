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

  test("rejects subtext longer than 300 chars", () => {
    const result = EmotionSchema.safeParse({
      emotion: "Joy",
      intensity: "low",
      subtext: "x".repeat(301),
    });
    expect(result.success).toBe(false);
  });
});

describe("parseEmotionBlock", () => {
  test("extracts emotion from <|emotion|> block", () => {
    const text = `<|emotion|>{"emotion":"Fear","intensity":"high","subtext":"Hiding something"}<|emotion|>`;
    const result = parseEmotionBlock(text);
    expect(result).toEqual({ emotion: "Fear", intensity: "high", subtext: "Hiding something" });
  });

  test("extracts emotion when surrounded by other text", () => {
    const text = `<|reasoning|>some thoughts<|reasoning|>\n<|emotion|>{"emotion":"Joy","intensity":"low","subtext":""}<|emotion|>Hello there.`;
    const result = parseEmotionBlock(text);
    expect(result).toEqual({ emotion: "Joy", intensity: "low", subtext: "" });
  });

  test("returns null when no <|emotion|> block present", () => {
    expect(parseEmotionBlock("Just some text.")).toBeNull();
  });

  test("returns null for old <emotion> XML format", () => {
    const text = `<emotion>{"emotion":"Fear","intensity":"high","subtext":"Hiding something"}</emotion>`;
    expect(parseEmotionBlock(text)).toBeNull();
  });

  test("returns null for malformed JSON inside block", () => {
    expect(parseEmotionBlock("<|emotion|>{bad json}<|emotion|>")).toBeNull();
  });

  test("parses emotion with literal newline in subtext", () => {
    const text = `<|emotion|>{"emotion":"Fear","intensity":"high","subtext":"The models were preventing\n collapse; this will be cited in post-mortems"}<|emotion|>`;
    const result = parseEmotionBlock(text);
    expect(result).not.toBeNull();
    expect(result?.emotion).toBe("Fear");
    expect(result?.subtext).toContain("preventing  collapse");
  });

  test("returns null if emotion value is invalid", () => {
    const text = `<|emotion|>{"emotion":"Neutral","intensity":"low","subtext":""}<|emotion|>`;
    expect(parseEmotionBlock(text)).toBeNull();
  });
});
