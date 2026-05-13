import { describe, test, expect } from "bun:test";
import { characterSearchHandler } from "./character_search.service";

const validCharacter = {
  name: "Walter White",
  imageUrl: null,
  shortDescription: "Chemistry teacher turned drug lord.",
  firstAppearanceDate: "2008-01-20",
  confidence: 3,
  personality: {
    personalityTraits: ["intelligent", "prideful"],
    backstory: "High school chemistry teacher diagnosed with cancer.",
    relationships: { "Jesse Pinkman": "former student and partner" },
    speechPatterns: ["measured", "precise"],
    values: ["family", "pride"],
    fears: ["obscurity", "death"],
    goals: ["provide for family", "build empire"],
    notableQuotes: ["I am the one who knocks."],
    abilities: ["chemistry", "manipulation"],
    copingStyle: ["denial", "rationalization"],
    knowledgeScope: { chemistry: "expert" },
  },
};

const mockSuccess = { answer: async () => ({ answer: validCharacter }) };
const mockThrows = { answer: async () => { throw new Error("network fail"); } };
const mockNotFound = {
  answer: async () => ({
    answer: {
      ...validCharacter,
      confidence: 0,
      name: "",
      shortDescription: "",
      personality: {
        ...validCharacter.personality,
        personalityTraits: [],
        backstory: "",
        relationships: {},
        speechPatterns: [],
        values: [],
        fears: [],
        goals: [],
        notableQuotes: [],
        abilities: [],
        copingStyle: [],
        knowledgeScope: {},
      },
    },
  }),
};

describe("characterSearchHandler", () => {
  test("returns character on valid Exa response", async () => {
    const result = await characterSearchHandler({ query: "Walter White" }, mockSuccess);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.name).toBe("Walter White");
    expect(result.confidence).toBe(3);
  });

  test("returns search_failed when Exa throws", async () => {
    const result = await characterSearchHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns character_not_found when confidence is 0", async () => {
    const result = await characterSearchHandler({ query: "x" }, mockNotFound);
    expect(result).toEqual({ error: "character_not_found" });
  });

  test("returns parse_failed when answer is bad JSON string", async () => {
    const mock = { answer: async () => ({ answer: "bad{json" }) };
    const result = await characterSearchHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when answer fails schema validation", async () => {
    const mock = { answer: async () => ({ answer: { wrong: true } }) };
    const result = await characterSearchHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });
});
