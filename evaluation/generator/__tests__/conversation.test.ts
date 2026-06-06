import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock generateTurn before importing conversation.ts
const mockGenerateTurn = mock(async function* () {
  yield { type: "thinking" as const };
  yield { type: "token" as const, text: "Hello." };
  yield { type: "thinking_done" as const };
  return {
    characterId: "char_001",
    characterName: "Tavon Rell",
    content: "Hello.",
    reasoning: "Starting the scene.",
    emotion: { emotion: "Joy", intensity: "low" as const, subtext: "Feeling cautious." },
  };
});

// Path is relative to THIS test file (evaluation/generator/__tests__/),
// which is 3 levels up from the repo root — same absolute path as the
// "../../packages/shared/conversation/turn" import in conversation.ts.
mock.module("../../../packages/shared/conversation/turn", () => ({
  generateTurn: mockGenerateTurn,
}));

import { runConversation } from "../conversation";
import type { ValidatedRun } from "../config";
import { buildAliasMap } from "../../judge/alias";

const mockRun: ValidatedRun = {
  index: 1,
  scenario: {
    id: "scenario_001",
    title: "Test Scenario",
    context: "Two characters meet.",
    initial_prompt: "They look at each other.",
    difficulty_level: "baseline",
    stress_axes: [],
    social_context: "group_conflict",
    pressure_source: "external_force",
  },
  characters: [
    {
      id: "char_001",
      name: "Tavon Rell",
      archetype: "Rebel",
      personalityTraits: ["bold"],
      backstory: "A rebel.",
      speechPatterns: ["short sentences"],
      values: ["freedom"],
      fears: ["complicity"],
      goals: ["expose truth"],
      notableQuotes: ["No walls."],
      abilities: ["oratory"],
      copingStyle: ["action"],
      difficultyTier: "distinctive",
      similarTo: null,
      varyingAxis: null,
    },
    {
      id: "char_002",
      name: "Senne Vorhal",
      archetype: "Martyr",
      personalityTraits: ["quiet"],
      backstory: "A witness.",
      speechPatterns: ["measured"],
      values: ["truth"],
      fears: ["silence"],
      goals: ["bear witness"],
      notableQuotes: ["I was there."],
      abilities: ["documentation"],
      copingStyle: ["endurance"],
      difficultyTier: "distinctive",
      similarTo: null,
      varyingAxis: null,
    },
  ],
  turns: 2,
  model: "claude-haiku-4-5",
  turn_strategy: "ROUND_ROBIN",
};

const aliasMap = buildAliasMap(["Tavon Rell", "Senne Vorhal"]);

describe("runConversation", () => {
  beforeEach(() => {
    mockGenerateTurn.mockClear();
  });

  it("calls generateTurn once per turn", async () => {
    await runConversation(mockRun, "http://localhost:4000", "test-key", aliasMap);
    expect(mockGenerateTurn.mock.calls.length).toBe(2);
  });

  it("concatenates context and initial_prompt", async () => {
    await runConversation(mockRun, "http://localhost:4000", "test-key", aliasMap);
    const firstCall = mockGenerateTurn.mock.calls[0];
    const input = firstCall?.[0] as { context: string };
    expect(input.context).toBe("Two characters meet.\n\nThey look at each other.");
  });

  it("returns correct metadata on success", async () => {
    const result = await runConversation(mockRun, "http://localhost:4000", "test-key", aliasMap);
    expect(result.run_index).toBe(1);
    expect(result.scenario_id).toBe("scenario_001");
    expect(result.turns_requested).toBe(2);
    expect(result.messages).toHaveLength(2);
    expect(result.completed_at).toBeDefined();
  });

  it("throws when generateTurn throws", async () => {
    mockGenerateTurn.mockImplementationOnce(async function* () {
      throw new Error("LITELLM_ERROR: connection refused");
      yield { type: "thinking" as const };
    });
    await expect(
      runConversation(mockRun, "http://localhost:4000", "test-key", aliasMap)
    ).rejects.toThrow("LITELLM_ERROR");
  });
});
