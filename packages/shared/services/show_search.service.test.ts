import { describe, test, expect } from "bun:test";
import { showSearchHandler } from "./show_search.service";

// First call returns show metadata (no characters).
// Second call (per show) returns characters.
const metadataPayload = {
  results: [
    { title: "Money Heist", description: "A heist drama.", year: 2017, genre: "Crime" },
  ],
};
const charactersPayload = { characters: ["Berlin", "Tokyo", "Professor"] };

let callCount = 0;
const mockTwoCalls = {
  answer: async (_query: string) => {
    callCount++;
    if (callCount === 1) return { answer: metadataPayload };
    return { answer: charactersPayload };
  },
};

const mockThrows = { answer: async () => { throw new Error("network fail"); } };
const mockBadJson = { answer: async () => ({ answer: "not-json{{{" }) };
const mockBadSchema = { answer: async () => ({ answer: { wrong: true } }) };

describe("showSearchHandler", () => {
  test("makes two Exa calls: metadata then characters per show", async () => {
    callCount = 0;
    const result = await showSearchHandler({ query: "Money Heist" }, mockTwoCalls);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(callCount).toBe(2);
    expect(result.results[0]?.title).toBe("Money Heist");
    expect(result.results[0]?.characters).toEqual(["Berlin", "Tokyo", "Professor"]);
  });

  test("deduplicates shows with same normalised title", async () => {
    const dupMetadata = {
      results: [
        { title: "Money Heist", description: "A heist drama.", year: 2017, genre: "Crime" },
        { title: "Money Heist (La casa de papel)", description: "Same show.", year: 2017, genre: "Crime" },
      ],
    };
    let c = 0;
    const mock = {
      answer: async () => {
        c++;
        if (c === 1) return { answer: dupMetadata };
        return { answer: charactersPayload };
      },
    };
    const result = await showSearchHandler({ query: "Money Heist" }, mock);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.results.length).toBe(1);
    expect(result.results[0]?.title).toBe("Money Heist");
  });

  test("returns search_failed when first Exa call throws", async () => {
    const result = await showSearchHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns search_failed when character lookup throws", async () => {
    let c = 0;
    const mock = {
      answer: async () => {
        c++;
        if (c === 1) return { answer: metadataPayload };
        throw new Error("char lookup fail");
      },
    };
    const result = await showSearchHandler({ query: "x" }, mock);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns parse_failed when metadata answer fails schema validation", async () => {
    const result = await showSearchHandler({ query: "x" }, mockBadSchema);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when metadata answer is bad JSON string", async () => {
    const result = await showSearchHandler({ query: "x" }, mockBadJson);
    expect(result).toEqual({ error: "parse_failed" });
  });
});
