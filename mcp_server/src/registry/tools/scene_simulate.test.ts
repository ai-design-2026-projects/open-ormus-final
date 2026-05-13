import { mock } from "bun:test";

const mockFindFirst = mock(async (args: { where: { id: string; userId: string } }) => {
  if (args.where.id === "nonexistent-id") return null;
  return { id: args.where.id, userId: args.where.userId };
});

mock.module("../../db.js", () => ({
  prisma: { character: { findFirst: mockFindFirst } },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { sceneSimulateHandler } from "./scene_simulate";
import { userIdStorage } from "../../auth/context";

describe("sceneSimulateHandler", () => {
  beforeEach(() => {
    mockFindFirst.mockClear();
    mockFindFirst.mockImplementation(async (args: { where: { id: string; userId: string } }) => {
      if (args.where.id === "nonexistent-id") return null;
      return { id: args.where.id, userId: args.where.userId };
    });
  });

  test("returns dialogue with one line per character", async () => {
    const result = await userIdStorage.run("test-user", () =>
      sceneSimulateHandler({
        characterIds: [
          "00000000-0000-0000-0000-000000000001",
          "00000000-0000-0000-0000-000000000002",
        ],
        setting: "a foggy tavern",
        prompt: "The two meet for the first time",
      })
    );
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.dialogue).toHaveLength(2);
      expect(result.dialogue[0]?.characterId).toBe(
        "00000000-0000-0000-0000-000000000001"
      );
      expect(result.sceneId).toBeTruthy();
      expect(result.setting).toBe("a foggy tavern");
    }
  });

  test("returns character_not_found for unknown characterId", async () => {
    const result = await userIdStorage.run("test-user", () =>
      sceneSimulateHandler({
        characterIds: ["nonexistent-id"],
        setting: "x",
        prompt: "y",
      })
    );
    expect(result).toEqual({ error: "character_not_found", id: "nonexistent-id" });
  });

  test("throws if userId not in context", async () => {
    expect(() =>
      sceneSimulateHandler({
        characterIds: ["00000000-0000-0000-0000-000000000001"],
        setting: "x",
        prompt: "y",
      })
    ).toThrow();
  });
});
