import { describe, test, expect } from "bun:test";
import { runReconstructionForConversation } from "../index";
import type { ValidatedReconstructConfig } from "../types";

function makeMinimalConfig(segments: number): ValidatedReconstructConfig {
  return {
    baseUrl: "http://localhost",
    segments,
    reconstructorModel: "test-model",
    comparators: [{ label: "comparator_1", model: "test-model" }],
    fields: ["personalityTraits"],
    datasetDir: "/tmp",
    outputName: "test",
    rawConfigText: "",
  };
}

describe("runReconstructionForConversation", () => {
  test("throws when messages < segments * 2", async () => {
    const result = {
      scenario_id: "scen_001",
      scenario_title: "Test",
      messages: [
        { turn: 1, character_id: "c1", character_name: "Alice", emotion: "neutral", intensity: "low", subtext: "", reasoning: null, content: "hi" },
        { turn: 2, character_id: "c1", character_name: "Alice", emotion: "neutral", intensity: "low", subtext: "", reasoning: null, content: "bye" },
        { turn: 3, character_id: "c1", character_name: "Alice", emotion: "neutral", intensity: "low", subtext: "", reasoning: null, content: "ok" },
      ],
      characters: [{ id: "c1", name: "Alice" }],
    } as any;

    await expect(
      runReconstructionForConversation(
        result,
        "001.yaml",
        { id: "scen_001", title: "Test", context: "", difficulty_level: "medium", stress_axes: [] } as any,
        [] as any,
        makeMinimalConfig(3),
        "fake-api-key",
      ),
    ).rejects.toThrow("not enough messages for 3 segments");
  });

  test("does not throw the thin-check error when messages >= segments * 2", async () => {
    const messages = Array.from({ length: 6 }, (_, i) => ({
      turn: i + 1,
      character_id: "c1",
      character_name: "Alice",
      emotion: "neutral",
      intensity: "low",
      subtext: "",
      reasoning: null,
      content: `msg ${i + 1}`,
    }));
    const result = {
      scenario_id: "scen_001",
      scenario_title: "Test",
      messages,
      characters: [{ id: "c1", name: "Alice" }],
    } as any;

    const promise = runReconstructionForConversation(
      result,
      "001.yaml",
      { id: "scen_001", title: "Test", context: "", difficulty_level: "medium", stress_axes: [] } as any,
      [] as any,
      makeMinimalConfig(3),
      "fake-api-key",
    );

    // Should NOT throw the thin-conversation error — will throw a different error (network/LLM)
    await expect(promise).rejects.not.toThrow("not enough messages");
  });
});
