import { describe, test, expect } from "bun:test";
import { sceneSimulateHandler } from "./scene_simulate";

describe("sceneSimulateHandler", () => {
  test("returns dialogue with one line per character", async () => {
    const result = await sceneSimulateHandler({
      characterIds: [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ],
      setting: "a foggy tavern",
      prompt: "The two meet for the first time",
    });
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
    const result = await sceneSimulateHandler({
      characterIds: ["nonexistent-id"],
      setting: "x",
      prompt: "y",
    });
    expect(result).toEqual({ error: "character_not_found", id: "nonexistent-id" });
  });
});
