import { describe, test, expect } from "bun:test";
import { showSearchHandler } from "./show_search.service";

const validPayload = {
  results: [
    {
      title: "Money Heist",
      description: "A heist drama.",
      characters: ["Berlin", "Tokyo"],
      year: 2017,
      genre: "Crime",
    },
  ],
};

const mockSuccess = { answer: async (_q: unknown, _o: unknown) => ({ answer: validPayload }) };
const mockThrows = { answer: async () => { throw new Error("network fail"); } };
const mockBadJson = { answer: async () => ({ answer: "not-json{{{" }) };
const mockBadSchema = { answer: async () => ({ answer: { wrong: true } }) };

describe("showSearchHandler", () => {
  test("returns results on valid Exa response", async () => {
    const result = await showSearchHandler({ query: "Money Heist" }, mockSuccess);
    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.results[0]?.title).toBe("Money Heist");
  });

  test("returns search_failed when Exa throws", async () => {
    const result = await showSearchHandler({ query: "x" }, mockThrows);
    expect(result).toEqual({ error: "search_failed" });
  });

  test("returns parse_failed when answer is bad JSON string", async () => {
    const result = await showSearchHandler({ query: "x" }, mockBadJson);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns parse_failed when answer fails schema validation", async () => {
    const result = await showSearchHandler({ query: "x" }, mockBadSchema);
    expect(result).toEqual({ error: "parse_failed" });
  });

  test("returns results when answer is an object (not string)", async () => {
    const mock = { answer: async () => ({ answer: validPayload }) };
    const result = await showSearchHandler({ query: "x" }, mock);
    expect("results" in result).toBe(true);
  });
});
