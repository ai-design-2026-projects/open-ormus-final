import { describe, expect, it } from "bun:test";
import { buildAliasMap, reconstructAliasMap, realNameToAlias, ALIAS_POOL } from "../alias";
import type { CharacterRecord } from "../../generator/config";

const mockChar = (id: string, name: string): CharacterRecord => ({
  id,
  name,
  archetype: "Test",
  personalityTraits: [],
  backstory: "",
  speechPatterns: [],
  values: [],
  fears: [],
  goals: [],
  notableQuotes: [],
  abilities: [],
  copingStyle: [],
  difficultyTier: "baseline",
  similarTo: null,
  varyingAxis: null,
});

describe("buildAliasMap", () => {
  it("maps first character to Alex, second to Jordan", () => {
    const result = buildAliasMap(["Tavon Rell", "Senne Vorhal"]);
    expect(result["Alex"]).toBe("Tavon Rell");
    expect(result["Jordan"]).toBe("Senne Vorhal");
  });

  it("handles a single character", () => {
    const result = buildAliasMap(["Solo"]);
    expect(result["Alex"]).toBe("Solo");
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("handles max characters (10)", () => {
    const names = Array.from({ length: 10 }, (_, i) => `Char ${i}`);
    const result = buildAliasMap(names);
    expect(Object.keys(result)).toHaveLength(10);
    expect(result[ALIAS_POOL[9]!]).toBe("Char 9");
  });

  it("throws when more than 10 characters provided", () => {
    const names = Array.from({ length: 11 }, (_, i) => `Char ${i}`);
    expect(() => buildAliasMap(names)).toThrow();
  });
});

describe("reconstructAliasMap", () => {
  it("reconstructs alias→real name from conversation characters + dataset", () => {
    const convChars = [
      { id: "char_001", name: "Alex" },
      { id: "char_002", name: "Jordan" },
    ];
    const dataset = [
      mockChar("char_001", "Tavon Rell"),
      mockChar("char_002", "Senne Vorhal"),
      mockChar("char_003", "Other"),
    ];
    const result = reconstructAliasMap(convChars, dataset);
    expect(result["Alex"]).toBe("Tavon Rell");
    expect(result["Jordan"]).toBe("Senne Vorhal");
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("throws when character id not found in dataset", () => {
    const convChars = [{ id: "char_999", name: "Alex" }];
    const dataset = [mockChar("char_001", "Tavon Rell")];
    expect(() => reconstructAliasMap(convChars, dataset)).toThrow();
  });
});

describe("realNameToAlias", () => {
  it("returns the alias for a given real name", () => {
    const map = { Alex: "Tavon Rell", Jordan: "Senne Vorhal" };
    expect(realNameToAlias(map, "Tavon Rell")).toBe("Alex");
    expect(realNameToAlias(map, "Senne Vorhal")).toBe("Jordan");
  });

  it("throws when real name not found", () => {
    const map = { Alex: "Tavon Rell" };
    expect(() => realNameToAlias(map, "Unknown")).toThrow();
  });
});
