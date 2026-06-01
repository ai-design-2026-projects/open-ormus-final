import { describe, test, expect } from "bun:test";
import {
  CharacterSaveInputSchema,
  CharacterSaveInputShape,
  CharacterUpdateInputSchema,
  CharacterDeleteInputSchema,
  SavedCharacterRecordSchema,
} from "./character_saved";

const validPersonality = {
  personalityTraits: ["brave", "cunning"],
  backstory: "Grew up in the north",
  relationships: { Merlin: "mentor" },
  speechPatterns: ["speaks formally"],
  values: ["loyalty"],
  fears: ["betrayal"],
  goals: ["unite the kingdom"],
  notableQuotes: ["A king serves his people."],
  abilities: ["sword fighting"],
  copingStyle: ["stoicism"],
  knowledgeScope: { history: "expert" },
};

const validSheet = {
  name: "Arthur",
  imageUrl: null,
  shortDescription: "Legendary king",
  firstAppearanceDate: "500 AD",
  personality: validPersonality,
};

describe("CharacterSaveInputSchema", () => {
  test("parses valid save input", () => {
    const result = CharacterSaveInputSchema.parse(validSheet);
    expect(result.name).toBe("Arthur");
    expect(result.personality.personalityTraits).toEqual(["brave", "cunning"]);
  });

  test("rejects empty name", () => {
    expect(() =>
      CharacterSaveInputSchema.parse({ ...validSheet, name: "" })
    ).toThrow();
  });

  test("accepts null imageUrl", () => {
    const result = CharacterSaveInputSchema.parse({ ...validSheet, imageUrl: null });
    expect(result.imageUrl).toBeNull();
  });
});

describe("CharacterSaveInputShape", () => {
  test("is a plain object of Zod fields", () => {
    expect(typeof CharacterSaveInputShape).toBe("object");
    expect(typeof CharacterSaveInputShape.name.parse).toBe("function");
  });
});

describe("CharacterUpdateInputSchema", () => {
  test("parses valid update input", () => {
    const result = CharacterUpdateInputSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      sheet: validSheet,
    });
    expect(result.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(result.sheet.name).toBe("Arthur");
  });

  test("rejects non-uuid id", () => {
    expect(() =>
      CharacterUpdateInputSchema.parse({ id: "not-a-uuid", sheet: validSheet })
    ).toThrow();
  });
});

describe("CharacterDeleteInputSchema", () => {
  test("parses valid id", () => {
    const result = CharacterDeleteInputSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  test("rejects non-uuid id", () => {
    expect(() =>
      CharacterDeleteInputSchema.parse({ id: "bad" })
    ).toThrow();
  });
});

describe("SavedCharacterRecordSchema", () => {
  test("parses valid DB record", () => {
    const record = SavedCharacterRecordSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      name: "Arthur",
      sheet: validSheet,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
    });
    expect(record.name).toBe("Arthur");
    expect(record.sheet.personality.personalityTraits).toEqual(["brave", "cunning"]);
  });
});
