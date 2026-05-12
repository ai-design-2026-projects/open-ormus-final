import { describe, test, expect } from "bun:test";
import {
  CharacterCreateInputSchema,
  CharacterCreateInputShape,
  CharacterRecordSchema,
} from "./character";

describe("CharacterCreateInputSchema", () => {
  test("parses valid input", () => {
    const result = CharacterCreateInputSchema.parse({
      name: "Aria",
      description: "A wanderer",
      traits: ["curious", "brave"],
    });
    expect(result.name).toBe("Aria");
    expect(result.traits).toEqual(["curious", "brave"]);
  });

  test("rejects empty name", () => {
    expect(() =>
      CharacterCreateInputSchema.parse({ name: "", description: "x", traits: [] })
    ).toThrow();
  });
});

describe("CharacterCreateInputShape", () => {
  test("is a plain object of zod fields", () => {
    expect(typeof CharacterCreateInputShape).toBe("object");
    expect(typeof CharacterCreateInputShape.name.parse).toBe("function");
  });
});

describe("CharacterRecordSchema", () => {
  test("parses valid record", () => {
    const record = CharacterRecordSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Aria",
      description: "A wanderer",
      traits: ["curious"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(record.id).toBe("00000000-0000-0000-0000-000000000001");
  });
});
