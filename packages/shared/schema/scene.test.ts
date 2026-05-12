import { describe, test, expect } from "bun:test";
import {
  SceneSimulateInputSchema,
  SceneSimulateInputShape,
  SceneResultSchema,
} from "./scene";

describe("SceneSimulateInputSchema", () => {
  test("parses valid input", () => {
    const result = SceneSimulateInputSchema.parse({
      characterIds: ["id-1", "id-2"],
      setting: "a foggy tavern",
      prompt: "The two characters meet for the first time",
    });
    expect(result.characterIds).toEqual(["id-1", "id-2"]);
  });

  test("rejects empty characterIds", () => {
    expect(() =>
      SceneSimulateInputSchema.parse({
        characterIds: [],
        setting: "x",
        prompt: "y",
      })
    ).toThrow();
  });
});

describe("SceneSimulateInputShape", () => {
  test("is a plain object of zod fields", () => {
    expect(typeof SceneSimulateInputShape).toBe("object");
    expect(typeof SceneSimulateInputShape.setting.parse).toBe("function");
  });
});

describe("SceneResultSchema", () => {
  test("parses valid result", () => {
    const result = SceneResultSchema.parse({
      sceneId: "scene-123",
      setting: "a tavern",
      prompt: "they meet",
      dialogue: [{ characterId: "id-1", line: "Hello." }],
    });
    expect(result.dialogue).toHaveLength(1);
  });
});
