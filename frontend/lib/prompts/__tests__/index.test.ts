import { describe, expect, test } from "bun:test";
import { buildCharacterPrompt } from "../index";
import type { CharacterSearchResult } from "@open-ormus/shared";

const mockSheet: CharacterSearchResult = {
  name: "Walter White",
  imageUrl: null,
  shortDescription: "A 50-year-old high school chemistry teacher, lean and intense, with a shaved head and a goatee.",
  firstAppearanceDate: "2008-01-20",
  personality: {
    personalityTraits: ["methodical", "prideful", "brilliant"],
    backstory: "A chemistry genius who turned to manufacturing methamphetamine after a terminal cancer diagnosis.",
    relationships: { "Jesse Pinkman": "former student, business partner", "Skyler White": "estranged wife" },
    speechPatterns: ["precise and measured", "rarely uses slang", "speaks with authority"],
    values: ["pride", "legacy", "control"],
    fears: ["dying without meaning", "being seen as weak"],
    goals: ["build an empire", "provide for his family"],
    notableQuotes: ["I am the one who knocks.", "Say my name."],
    abilities: ["advanced chemistry", "strategic thinking", "manipulating others"],
    copingStyle: ["rationalisation", "dominance assertion"],
    knowledgeScope: {
      chemistry: "expert-level, specialised in methamphetamine synthesis",
      "street life": "learned through experience, still has gaps",
    },
  },
};

describe("buildCharacterPrompt", () => {
  test("includes the character name in the output", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting in a parking lot.");
    expect(result).toContain("Walter White");
  });

  test("instructs the character to always respond in English", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("Always respond in English");
  });

  test("includes values in the psychology section", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("pride");
    expect(result).toContain("legacy");
  });

  test("includes speech patterns", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("precise and measured");
  });

  test("includes a notable quote verbatim", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("I am the one who knocks.");
  });

  test("formats knowledgeScope as bullet lines", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("- chemistry: expert-level");
  });

  test("includes the scene context", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting in a parking lot.");
    expect(result).toContain("A tense meeting in a parking lot.");
  });

  test("includes physical action instruction", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("italics");
  });

  test("renders sections in the correct order", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    const idx = (s: string) => result.indexOf(s);
    expect(idx("## Identity")).toBeLessThan(idx("## Personality"));
    expect(idx("## Personality")).toBeLessThan(idx("## Psychology"));
    expect(idx("## Psychology")).toBeLessThan(idx("## How You Speak"));
    expect(idx("## How You Speak")).toBeLessThan(idx("## What You Know"));
    expect(idx("## What You Know")).toBeLessThan(idx("## Your Relationships"));
    expect(idx("## Your Relationships")).toBeLessThan(idx("## Your Abilities"));
    expect(idx("## Your Abilities")).toBeLessThan(idx("## Instructions"));
    expect(idx("## Instructions")).toBeLessThan(idx("## Scene"));
  });
});

describe("buildCharacterPrompt — cast and format", () => {
  test("includes Scene Cast section when other participants provided", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.", ["Jesse Pinkman", "Hank Schrader"]);
    expect(result).toContain("## Scene Cast");
    expect(result).toContain("Jesse Pinkman");
    expect(result).toContain("Hank Schrader");
  });

  test("omits Scene Cast section when no other participants", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.", []);
    expect(result).not.toContain("## Scene Cast");
  });

  test("omits Scene Cast section when param is omitted (default)", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).not.toContain("## Scene Cast");
  });

  test("output format uses <|reasoning|> tags", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("<|reasoning|>");
  });

  test("output format uses <|emotion|> tags", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("<|emotion|>");
  });

  test("output format does not reference <dialogue> or </dialogue>", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).not.toContain("<dialogue>");
    expect(result).not.toContain("</dialogue>");
  });

  test("reasoning block instruction emphasises privacy", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).toContain("private");
  });

  test("includes Engagement section when other participants provided", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.", ["Jesse Pinkman"]);
    expect(result).toContain("## Engagement");
    expect(result).toContain("React directly to what the last speaker said");
  });

  test("omits Engagement section when no other participants", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.");
    expect(result).not.toContain("## Engagement");
  });

  test("Engagement appears after Scene Cast and before Scene when participants provided", () => {
    const result = buildCharacterPrompt(mockSheet, "A tense meeting.", ["Jesse Pinkman"]);
    const idx = (s: string) => result.indexOf(s);
    expect(idx("## Scene Cast")).toBeLessThan(idx("## Engagement"));
    expect(idx("## Engagement")).toBeLessThan(idx("\n## Scene\n"));
  });
});
