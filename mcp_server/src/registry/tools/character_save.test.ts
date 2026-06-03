import { mock } from "bun:test";

// Mock processAndStorePictures — skipped when imageUrl is null
mock.module("@open-ormus/shared/services/character_picture.service", () => ({
  processAndStorePictures: mock(async () => []),
}));

const mockCharacterCreate = mock(async () => ({
  id: "00000000-0000-0000-0000-000000000099",
  userId: "test-user",
  name: "Arthur",
  sheet: {
    name: "Arthur",
    shortDescription: "Legendary king",
    firstAppearanceDate: "500 AD",
    personality: {
      personalityTraits: ["brave"],
      backstory: "Born of nobility",
      relationships: {},
      speechPatterns: [],
      values: ["justice"],
      fears: ["failure"],
      goals: ["peace"],
      notableQuotes: [],
      abilities: ["leadership"],
      copingStyle: ["prayer"],
      knowledgeScope: {},
    },
  },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
}));

mock.module("../../db.js", () => ({
  prisma: {
    character: { create: mockCharacterCreate },
    characterPicture: { findMany: mock(async () => []) },
  },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterSaveHandler } from "./character_save";
import { userIdStorage } from "../../auth/context";

const validInput = {
  name: "Arthur",
  imageUrl: null as string | null,
  shortDescription: "Legendary king",
  firstAppearanceDate: "500 AD",
  personality: {
    personalityTraits: ["brave"],
    backstory: "Born of nobility",
    relationships: {} as Record<string, string>,
    speechPatterns: [] as string[],
    values: ["justice"],
    fears: ["failure"],
    goals: ["peace"],
    notableQuotes: [] as string[],
    abilities: ["leadership"],
    copingStyle: ["prayer"],
    knowledgeScope: {} as Record<string, string>,
  },
};

describe("characterSaveHandler", () => {
  beforeEach(() => {
    mockCharacterCreate.mockClear();
  });

  test("creates character and returns SavedCharacterRecord with pictures array", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterSaveHandler(validInput)
    );
    expect(result.id).toBe("00000000-0000-0000-0000-000000000099");
    expect(result.name).toBe("Arthur");
    expect(result.pictures).toEqual([]);
    expect(result.createdAt).toBeTruthy();
  });

  test("calls prisma.character.create with correct userId and name", async () => {
    await userIdStorage.run("test-user", () => characterSaveHandler(validInput));
    expect(mockCharacterCreate).toHaveBeenCalledTimes(1);
    const call = mockCharacterCreate.mock.calls[0]?.[0] as {
      data: { userId: string; name: string; sheet: unknown };
    };
    expect(call.data.userId).toBe("test-user");
    expect(call.data.name).toBe("Arthur");
  });

  test("does not include imageUrl in the sheet data passed to create", async () => {
    await userIdStorage.run("test-user", () => characterSaveHandler(validInput));
    const call = mockCharacterCreate.mock.calls[0]?.[0] as {
      data: { sheet: Record<string, unknown> };
    };
    expect(call.data.sheet).not.toHaveProperty("imageUrl");
  });

  test("throws if userId not in context", async () => {
    expect(() => characterSaveHandler(validInput)).toThrow();
  });
});
