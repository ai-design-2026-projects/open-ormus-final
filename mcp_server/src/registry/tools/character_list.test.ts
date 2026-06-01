import { mock } from "bun:test";

const mockSheet = {
  name: "Arthur",
  imageUrl: null,
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
};

const mockFindMany = mock(async () => [
  {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "test-user",
    name: "Arthur",
    sheet: mockSheet,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    archivedAt: null,
  },
]);

mock.module("../../db.js", () => ({
  prisma: { character: { findMany: mockFindMany } },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterListHandler } from "./character_list";
import { userIdStorage } from "../../auth/context";

describe("characterListHandler", () => {
  beforeEach(() => {
    mockFindMany.mockClear();
  });

  test("returns list of saved characters for current user", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterListHandler()
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Arthur");
    expect(result[0]?.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(result[0]?.archivedAt).toBeNull();
  });

  test("queries only active (non-archived) characters for current user", async () => {
    await userIdStorage.run("test-user", () => characterListHandler());
    const call = mockFindMany.mock.calls[0]?.[0] as {
      where: { userId: string; archivedAt: null };
    };
    expect(call.where.userId).toBe("test-user");
    expect(call.where.archivedAt).toBeNull();
  });

  test("returns empty array when user has no characters", async () => {
    mockFindMany.mockImplementation(async () => []);
    const result = await userIdStorage.run("test-user", () =>
      characterListHandler()
    );
    expect(result).toEqual([]);
  });

  test("throws if userId not in context", async () => {
    expect(() => characterListHandler()).toThrow();
  });
});
