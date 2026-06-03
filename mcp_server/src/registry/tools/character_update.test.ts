import { mock } from "bun:test";

// Mock processAndStorePictures
mock.module("@open-ormus/shared/services/character_picture.service", () => ({
  processAndStorePictures: mock(async () => []),
}));

const validSheet = {
  name: "Arthur Updated",
  shortDescription: "Updated description",
  firstAppearanceDate: "500 AD",
  personality: {
    personalityTraits: ["wise"],
    backstory: "Changed backstory",
    relationships: {},
    speechPatterns: [],
    values: ["wisdom"],
    fears: ["loss"],
    goals: ["peace"],
    notableQuotes: [],
    abilities: ["strategy"],
    copingStyle: ["meditation"],
    knowledgeScope: {},
  },
};

const baseRow = {
  id: "00000000-0000-0000-0000-000000000001",
  userId: "test-user",
  name: "Arthur Updated",
  sheet: validSheet,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-06-01"),
  archivedAt: null,
};

const mockUpdateMany = mock(async () => ({ count: 1 }));
const mockFindFirst = mock(async () => ({ ...baseRow }));
const mockFindManyPictures = mock(async () => []);

mock.module("../../db.js", () => ({
  prisma: {
    character: {
      updateMany: mockUpdateMany,
      findFirst: mockFindFirst,
    },
    characterPicture: {
      findMany: mockFindManyPictures,
    },
  },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterUpdateHandler } from "./character_update";
import { userIdStorage } from "../../auth/context";

const validInput = {
  id: "00000000-0000-0000-0000-000000000001",
  sheet: validSheet,
};

describe("characterUpdateHandler", () => {
  beforeEach(() => {
    mockUpdateMany.mockClear();
    mockFindFirst.mockClear();
    mockFindManyPictures.mockClear();
  });

  test("updates character and returns updated record with pictures array", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    if ("error" in result) throw new Error("expected success");
    expect(result.name).toBe("Arthur Updated");
    expect(result.archivedAt).toBeNull();
    expect(result.pictures).toEqual([]);
  });

  test("scopes update to current userId", async () => {
    await userIdStorage.run("test-user", () => characterUpdateHandler(validInput));
    const updateCall = mockUpdateMany.mock.calls[0]?.[0] as {
      where: { id: string; userId: string };
    };
    expect(updateCall.where.userId).toBe("test-user");
    expect(updateCall.where.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  test("returns not_found when character does not exist", async () => {
    mockFindFirst.mockImplementationOnce(async () => null);
    const result = await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    expect(result).toEqual({ error: "not_found" });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("returns archived when character is archived", async () => {
    mockFindFirst.mockImplementationOnce(async () => ({
      ...baseRow,
      archivedAt: new Date("2026-01-15"),
    }));
    const result = await userIdStorage.run("test-user", () =>
      characterUpdateHandler(validInput)
    );
    expect(result).toEqual({ error: "archived" });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test("throws if userId not in context", async () => {
    expect(() => characterUpdateHandler(validInput)).toThrow();
  });
});
