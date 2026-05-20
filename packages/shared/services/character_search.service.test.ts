import { describe, test, expect } from "bun:test";
import {
  characterSearchHandler,
  characterBasicsHandler,
  characterDetailsHandler,
} from "./character_search.service";

// ── Shared flat mock payload ──────────────────────────────────────────────────
// All fields at root level. Zod safeParse strips what each sub-schema doesn't need.
const flatCharacter = {
  name: "Walter White",
  imageUrl: null,
  shortDescription: "Chemistry teacher turned drug lord.",
  firstAppearanceDate: "2008-01-20",
  confidence: 3 as const,
  // personality fields (flat — matches PERSONALITY_OUTPUT_SCHEMA)
  personalityTraits: ["intelligent", "prideful"],
  backstory: "High school chemistry teacher diagnosed with cancer.",
  speechPatterns: ["measured", "precise"],
  values: ["family", "pride"],
  fears: ["obscurity", "death"],
  goals: ["provide for family", "build empire"],
  notableQuotes: ["I am the one who knocks."],
  abilities: ["chemistry", "manipulation"],
  copingStyle: ["denial", "rationalization"],
  // connections fields (flat — matches CONNECTIONS_OUTPUT_SCHEMA array format)
  relationships: [{ characterName: "Jesse Pinkman", description: "former student and partner" }],
  knowledgeScope: [{ domain: "chemistry", description: "expert" }],
};

const mockSuccess = { answer: async () => ({ answer: flatCharacter }) };
const mockThrows = {
  answer: async () => {
    throw new Error("network fail");
  },
};
const mockNotFound = {
  answer: async () => ({
    answer: {
      ...flatCharacter,
      confidence: 0,
      name: "",
      shortDescription: "",
    },
  }),
};

// ── characterBasicsHandler ────────────────────────────────────────────────────

describe("characterBasicsHandler", () => {
  test("returns basics on valid Exa response", async () => {
    const result = await characterBasicsHandler({ query: "Walter White" }, mockSuccess);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.name).toBe("Walter White");
    expect(result.confidence).toBe(3);
    expect(result.shortDescription).toBe("Chemistry teacher turned drug lord.");
  });

  test("returns search_failed when Exa throws", async () => {
    const result = await characterBasicsHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns character_not_found when confidence is 0", async () => {
    const result = await characterBasicsHandler({ query: "x" }, mockNotFound);
    expect(result).toEqual({ error: "character_not_found" });
  });

  test("returns parse_failed when answer is bad JSON string", async () => {
    const mock = { answer: async () => ({ answer: "bad{json" }) };
    const result = await characterBasicsHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when answer fails schema validation", async () => {
    const mock = { answer: async () => ({ answer: { wrong: true } }) };
    const result = await characterBasicsHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("retries up to 3 times on transient error then succeeds", async () => {
    let calls = 0;
    const mock = {
      answer: async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return { answer: flatCharacter };
      },
    };
    const result = await characterBasicsHandler({ query: "Walter White" }, mock);
    if ("error" in result) throw new Error(`unexpected: ${result.error}`);
    expect(result.name).toBe("Walter White");
    expect(calls).toBe(3);
  });

  test("returns search_failed after 3 failed retries", async () => {
    let calls = 0;
    const mock = {
      answer: async () => {
        calls++;
        throw new Error("permanent");
      },
    };
    const result = await characterBasicsHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "search_failed" });
    expect(calls).toBe(3);
  });
});

// ── characterDetailsHandler ───────────────────────────────────────────────────

describe("characterDetailsHandler", () => {
  const detailsArgs = {
    query: "Walter White, Breaking Bad",
    name: "Walter White",
    shortDescription: "Chemistry teacher turned drug lord.",
  };

  test("merges personality and connections on valid Exa response", async () => {
    const result = await characterDetailsHandler(detailsArgs, mockSuccess);
    if ("error" in result) throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(result.personalityTraits).toEqual(["intelligent", "prideful"]);
    expect(result.relationships).toEqual({ "Jesse Pinkman": "former student and partner" });
    expect(result.knowledgeScope).toEqual({ chemistry: "expert" });
    expect(result.backstory).toBe("High school chemistry teacher diagnosed with cancer.");
  });

  test("returns search_failed when Exa throws on both sub-requests", async () => {
    const result = await characterDetailsHandler(detailsArgs, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns parse_failed when personality response fails schema", async () => {
    const mock = { answer: async () => ({ answer: { wrong: true } }) };
    const result = await characterDetailsHandler(detailsArgs, mock);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("uses enriched query (name + shortDescription + original query)", async () => {
    const capturedQueries: string[] = [];
    const mock = {
      answer: async (query: string) => {
        capturedQueries.push(query);
        return { answer: flatCharacter };
      },
    };
    await characterDetailsHandler(detailsArgs, mock);
    expect(capturedQueries.length).toBe(2);
    const expectedQuery = `${detailsArgs.name}: ${detailsArgs.shortDescription}, ${detailsArgs.query}`;
    for (const q of capturedQueries) {
      expect(q).toBe(expectedQuery);
    }
  });

  test("returns search_failed if personality sub-request fails", async () => {
    const mock = {
      answer: async (_q: string, opts?: Record<string, unknown>) => {
        const prompt = (opts?.systemPrompt as string) ?? "";
        if (prompt.includes("personality fields")) throw new Error("personality fail");
        return { answer: flatCharacter };
      },
    };
    const result = await characterDetailsHandler(detailsArgs, mock);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns search_failed if connections sub-request fails", async () => {
    const mock = {
      answer: async (_q: string, opts?: Record<string, unknown>) => {
        const prompt = (opts?.systemPrompt as string) ?? "";
        if (prompt.includes("relationships and knowledge scope")) throw new Error("connections fail");
        return { answer: flatCharacter };
      },
    };
    const result = await characterDetailsHandler(detailsArgs, mock);
    expect(result).toEqual({ error: "search_failed" });
  });
});

// ── characterSearchHandler (wrapper) ─────────────────────────────────────────

describe("characterSearchHandler", () => {
  test("returns full CharacterSearchResult on valid Exa response", async () => {
    const result = await characterSearchHandler({ query: "Walter White" }, mockSuccess);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    // root-level basics
    expect(result.name).toBe("Walter White");
    expect(result.confidence).toBe(3);
    expect(result.imageUrl).toBeNull();
    expect(result.shortDescription).toBe("Chemistry teacher turned drug lord.");
    // nested personality
    expect(result.personality.personalityTraits).toEqual(["intelligent", "prideful"]);
    expect(result.personality.relationships).toEqual({
      "Jesse Pinkman": "former student and partner",
    });
    expect(result.personality.knowledgeScope).toEqual({ chemistry: "expert" });
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
