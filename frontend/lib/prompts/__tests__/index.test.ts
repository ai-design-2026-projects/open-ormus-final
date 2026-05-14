import { describe, expect, test } from "bun:test";
import { buildCharacterPrompt } from "../index";
import type { CharacterSearchResult } from "@open-ormus/shared";

const mockSheet: CharacterSearchResult = {
  name: "Walter White",
  imageUrl: null,
  shortDescription: "A 50-year-old high school chemistry teacher, lean and intense, with a shaved head and a goatee.",
  firstAppearanceDate: "2008-01-20",
  confidence: 3,
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
