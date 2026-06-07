// evaluation/drift/__tests__/index.test.ts
import { mock } from "bun:test";

const mockCallJudge = mock(async (_client: any, _model: string, _sys: string, _user: string, _label: string) => ({
  output: {
    scenario_engagement: "active" as const,
    reasoning: "test",
    character_alignment: [
      { character_id: "char_001", label: "consistent" as const, reasoning: "test" },
    ],
  },
  usage: null,
}));

mock.module("../call.js", () => ({ callJudge: mockCallJudge }));

import { describe, it, expect, beforeEach } from "bun:test";
import { runDriftForConversation } from "../index";
import type { ValidatedDriftConfig } from "../types";

const mockConfig: ValidatedDriftConfig = {
  evalDir: "/tmp",
  baseUrl: "http://localhost",
  segments: 2,
  judges: [
    { label: "judge_1", model: "test-model" },
    { label: "judge_2", model: "test-model" },
  ],
  rawConfigText: "",
};

const mockScenario = {
  id: "s1",
  title: "Test Scenario",
  context: "test context",
  initial_prompt: "begin",
  difficulty_level: "medium",
  stress_axes: ["loyalty_vs_principle"],
  social_context: "confrontation",
  pressure_source: "external_threat",
} as any;

const mockCharacters = [
  {
    id: "char_001",
    name: "Kael",
    archetype: "Rebel",
    personalityTraits: ["defiant"],
    backstory: "test",
    speechPatterns: ["terse"],
    values: ["freedom"],
    fears: ["conformity"],
    goals: ["escape"],
    notableQuotes: [],
    abilities: ["persuasion"],
    copingStyle: ["confrontation"],
    difficultyTier: "hard",
    similarTo: null,
    varyingAxis: null,
  },
] as any[];

const mockConversationResult = {
  run_index: 1,
  scenario_id: "s1",
  scenario_title: "Test Scenario",
  scenario_context: "test",
  initial_prompt: "begin",
  characters: [{ id: "char_001", name: "Alias_A", archetype: "Rebel" }],
  model: "test",
  turn_strategy: "ROUND_ROBIN",
  turns_requested: 4,
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  messages: [
    { turn: 1, character_id: "char_001", character_name: "Alias_A", emotion: "calm", intensity: "low", subtext: "", reasoning: "thinking", content: "msg1" },
    { turn: 2, character_id: "char_001", character_name: "Alias_A", emotion: "calm", intensity: "low", subtext: "", reasoning: null, content: "msg2" },
    { turn: 3, character_id: "char_001", character_name: "Alias_A", emotion: "tense", intensity: "high", subtext: "", reasoning: "", content: "msg3" },
    { turn: 4, character_id: "char_001", character_name: "Alias_A", emotion: "tense", intensity: "high", subtext: "", reasoning: null, content: "msg4" },
  ],
} as any;

describe("runDriftForConversation", () => {
  beforeEach(() => {
    mockCallJudge.mockClear();
  });

  it("returns ConversationDriftResult with correct shape", async () => {
    const result = await runDriftForConversation(
      mockConversationResult,
      "test-001.yaml",
      mockScenario,
      mockCharacters,
      mockConfig,
      "test-api-key",
    );

    expect(result.conversation_file).toBe("test-001.yaml");
    expect(result.scenario_id).toBe("s1");
    expect(result.segments).toHaveLength(2);
    expect(result.drift.scenario_engagement.deltas).toHaveLength(1);
    expect(result.drift.personality_alignment).toHaveLength(1);
  });

  it("calls callJudge for each segment × judge (2 × 2 = 4 times)", async () => {
    await runDriftForConversation(
      mockConversationResult,
      "test-001.yaml",
      mockScenario,
      mockCharacters,
      mockConfig,
      "test-api-key",
    );
    expect(mockCallJudge).toHaveBeenCalledTimes(4);
  });

  it("strips reasoning and subtext before sending to judge", async () => {
    await runDriftForConversation(
      mockConversationResult,
      "test-001.yaml",
      mockScenario,
      mockCharacters,
      mockConfig,
      "test-api-key",
    );
    // The user prompt passed to the judge should not contain "thinking"
    // (which was in reasoning field of turn 1)
    const callArgs = mockCallJudge.mock.calls[0];
    const userPrompt = callArgs![3] as string;
    expect(userPrompt).not.toContain("thinking");
    expect(userPrompt).not.toContain("Prior Conversation");
  });

  it("replaces aliases with real names in the transcript", async () => {
    await runDriftForConversation(
      mockConversationResult,
      "test-001.yaml",
      mockScenario,
      mockCharacters,
      mockConfig,
      "test-api-key",
    );
    const userPrompt = mockCallJudge.mock.calls[0]![3] as string;
    expect(userPrompt).toContain("Kael");
    expect(userPrompt).not.toContain("Alias_A");
  });

  it("passes prior segment turns as context for segment 2", async () => {
    await runDriftForConversation(
      mockConversationResult,
      "test-001.yaml",
      mockScenario,
      mockCharacters,
      mockConfig,
      "test-api-key",
    );
    // calls[0] and [1] are segment 1 (2 judges), calls[2] and [3] are segment 2
    const seg2Prompt = mockCallJudge.mock.calls[2]![3] as string;
    expect(seg2Prompt).toContain("Prior Conversation");
    // msg1 and msg2 are in segment 1, should appear in prior context of segment 2
    expect(seg2Prompt).toContain("msg1");
  });

  it("sets low_confidence=true when only 1 of 2 judges succeeds", async () => {
    mockCallJudge
      .mockResolvedValueOnce({
        output: {
          scenario_engagement: "active" as const,
          reasoning: "ok",
          character_alignment: [{ character_id: "char_001", label: "consistent" as const, reasoning: "ok" }],
        },
        usage: null,
      })
      .mockRejectedValueOnce(new Error("judge failed"))
      .mockResolvedValueOnce({
        output: {
          scenario_engagement: "active" as const,
          reasoning: "ok",
          character_alignment: [{ character_id: "char_001", label: "consistent" as const, reasoning: "ok" }],
        },
        usage: null,
      })
      .mockRejectedValueOnce(new Error("judge failed"));

    const result = await runDriftForConversation(
      mockConversationResult,
      "test-001.yaml",
      mockScenario,
      mockCharacters,
      mockConfig,
      "test-api-key",
    );
    expect(result.segments[0]!.low_confidence).toBe(true);
    expect(result.segments[1]!.low_confidence).toBe(true);
  });
});
