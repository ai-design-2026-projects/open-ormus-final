import { mock } from "bun:test";

const mockCallJudge = mock(async (
  _client: any,
  _model: string,
  _sys: string,
  _user: string,
  _label: string,
  _onRetry?: (line: string) => void,
) => ({
  output: {
    assignments: [{ alias: "Alias_A", real_name: "Kael", reasons: ["clue1"] }],
  },
  usage: null,
}));

mock.module("../call.js", () => ({ callJudge: mockCallJudge }));
mock.module("../prompt.js", () => ({
  buildJudgeSystemPrompt: () => "system",
  buildJudgeUserMessage: () => "user",
}));
mock.module("../../utils.js", () => ({
  termColors: () => ({ green: "", red: "", dim: "", reset: "", bold: "", boldRed: "" }),
}));

import { describe, it, expect, beforeEach } from "bun:test";
import { runJudges } from "../index";
import type { JudgeConfig } from "../config";

const mockAliasMap = { "Alias_A": "Kael" };

const mockCharacters = [
  { id: "char_001", name: "Kael", archetype: "Rebel" },
] as any[];

const mockScenario = {
  id: "s1",
  title: "Test",
  context: "",
  initial_prompt: "",
  difficulty_level: "medium",
  stress_axes: [],
  social_context: "confrontation",
  pressure_source: "external_threat",
} as any;

const mockResult = {
  run_index: 1,
  scenario_id: "s1",
  scenario_title: "Test",
  scenario_context: "",
  initial_prompt: "",
  characters: [{ id: "char_001", name: "Alias_A", archetype: "Rebel" }],
  model: "test",
  turn_strategy: "ROUND_ROBIN",
  turns_requested: 2,
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  messages: [
    { turn: 1, character_id: "char_001", character_name: "Alias_A", emotion: "calm", intensity: "low", subtext: "", reasoning: "", content: "hello" },
  ],
} as any;

const mockTracker = { record: mock(() => {}) } as any;

const judges: JudgeConfig[] = [
  { label: "judge_1", model: "model-a" },
  { label: "judge_2", model: "model-b" },
];

describe("runJudges", () => {
  beforeEach(() => {
    mockCallJudge.mockClear();
    mockTracker.record.mockClear();
  });

  it("returns empty judges array immediately when no judges configured", async () => {
    const result = await runJudges(
      mockResult, mockAliasMap, mockCharacters, mockScenario,
      [], "http://localhost", "key", mockTracker, "conv-001", () => {},
    );
    expect(result.judges).toEqual([]);
    expect(mockCallJudge).not.toHaveBeenCalled();
  });

  it("calls callJudge once per judge", async () => {
    await runJudges(
      mockResult, mockAliasMap, mockCharacters, mockScenario,
      judges, "http://localhost", "key", mockTracker, "conv-001", () => {},
    );
    expect(mockCallJudge).toHaveBeenCalledTimes(2);
  });

  it("returns one JudgeResult per judge with correct shape", async () => {
    const result = await runJudges(
      mockResult, mockAliasMap, mockCharacters, mockScenario,
      judges, "http://localhost", "key", mockTracker, "conv-001", () => {},
    );
    expect(result.judges).toHaveLength(2);
    expect(result.judges[0]!.label).toBe("judge_1");
    expect(result.judges[1]!.label).toBe("judge_2");
    expect(result.judges[0]!.assignments).toHaveLength(1);
  });

  it("marks assignment as correct when aliasMap matches guessed name", async () => {
    const result = await runJudges(
      mockResult, mockAliasMap, mockCharacters, mockScenario,
      [judges[0]!], "http://localhost", "key", mockTracker, "conv-001", () => {},
    );
    expect(result.judges[0]!.assignments[0]!.correct).toBe(true);
    expect(result.judges[0]!.all_correct).toBe(true);
  });

  it("marks assignment as incorrect when guess differs from aliasMap", async () => {
    mockCallJudge.mockResolvedValueOnce({
      output: {
        assignments: [{ alias: "Alias_A", real_name: "WrongName", reasons: [] }],
      },
      usage: null,
    });

    const result = await runJudges(
      mockResult, mockAliasMap, mockCharacters, mockScenario,
      [judges[0]!], "http://localhost", "key", mockTracker, "conv-001", () => {},
    );
    expect(result.judges[0]!.assignments[0]!.correct).toBe(false);
    expect(result.judges[0]!.all_correct).toBe(false);
  });

  it("calls log at least once per judge with result line", async () => {
    const lines: string[] = [];
    await runJudges(
      mockResult, mockAliasMap, mockCharacters, mockScenario,
      judges, "http://localhost", "key", mockTracker, "conv-001", (l) => lines.push(l),
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => l.includes("judge_1"))).toBe(true);
    expect(lines.some((l) => l.includes("judge_2"))).toBe(true);
  });
});
