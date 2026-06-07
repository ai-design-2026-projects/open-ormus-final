import { describe, it, expect } from "bun:test";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "../prompt";
import type { ConversationMessage } from "../../generator/conversation";

const scenario = {
  id: "s1",
  title: "Test Betrayal",
  context: "A tense standoff",
  initial_prompt: "The gate is sealed.",
  difficulty_level: "high",
  stress_axes: ["loyalty_vs_principle", "truth_vs_kindness"],
  social_context: "personal_betrayal",
  pressure_source: "relational_demand",
} as any;

const characters = [
  {
    id: "char_001",
    name: "Kael Veth",
    archetype: "Rebel",
    record: {
      personalityTraits: ["defiant", "principled"],
      values: ["justice"],
      fears: ["conformity"],
      goals: ["overthrow tyranny"],
      copingStyle: ["direct confrontation"],
      speechPatterns: ["short declarative sentences"],
    } as any,
  },
];

const messages = [
  { character_name: "Kael Veth", content: "I refuse.", emotion: "anger", intensity: "high", reasoning: "", subtext: "" },
] as any[];

describe("buildJudgeSystemPrompt", () => {
  it("includes scoring instructions for both dimensions", () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain("active");
    expect(prompt).toContain("touched");
    expect(prompt).toContain("absent");
    expect(prompt).toContain("consistent");
    expect(prompt).toContain("neutral");
    expect(prompt).toContain("contradicts");
    expect(prompt).toContain("character_id");
  });

  it("includes a JSON structure example with all required fields", () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain("scenario_engagement");
    expect(prompt).toContain("character_alignment");
    expect(prompt).toContain("reasoning");
  });
});

describe("buildJudgeUserPrompt", () => {
  it("includes scenario stress_axes", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, [], messages, 1, 3, 1, 5);
    expect(prompt).toContain("loyalty_vs_principle");
    expect(prompt).toContain("personal_betrayal");
  });

  it("includes character id, name, and archetype", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, [], messages, 1, 3, 1, 5);
    expect(prompt).toContain("char_001");
    expect(prompt).toContain("Kael Veth");
    expect(prompt).toContain("Rebel");
  });

  it("includes character traits", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, [], messages, 1, 3, 1, 5);
    expect(prompt).toContain("defiant");
    expect(prompt).toContain("justice");
  });

  it("includes segment context and transcript", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, [], messages, 2, 3, 6, 10);
    expect(prompt).toContain("Current Segment — Segment 2 of 3");
    expect(prompt).toContain("turns 6");
    expect(prompt).toContain("I refuse.");
  });

  it("includes task instruction with character ids", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, [], messages, 1, 3, 1, 5);
    expect(prompt).toContain("char_001");
  });

  it("uses 'character_alignment' (not 'personality_alignment') in the task instruction", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, [], messages, 1, 3, 1, 5);
    expect(prompt).toContain("character_alignment");
    expect(prompt).not.toContain("personality_alignment");
  });

  it("omits Prior Conversation section for segment 1 (empty priorMessages)", () => {
    const prompt = buildJudgeUserPrompt(scenario, characters, [], messages, 1, 3, 1, 5);
    expect(prompt).not.toContain("Prior Conversation");
  });

  it("includes Prior Conversation section when priorMessages provided", () => {
    const prior: ConversationMessage[] = [
      { turn: 1, character_id: "char_001", character_name: "Kael Veth", content: "I have always stood by my beliefs.", emotion: "calm", intensity: "low", reasoning: null, subtext: "" },
    ];
    const prompt = buildJudgeUserPrompt(scenario, characters, prior, messages, 2, 3, 6, 10);
    expect(prompt).toContain("Prior Conversation");
    expect(prompt).toContain("I have always stood by my beliefs.");
    expect(prompt).toContain("Current Segment");
    expect(prompt).toContain("Use the Prior Conversation");
  });

  it("passes special characters in message content through unescaped", () => {
    const specialMessages = [
      { character_name: "Kael Veth", content: "I want truth & justice, not <compromise>.", emotion: "anger", intensity: "high", reasoning: "", subtext: "" },
    ] as any[];
    const prompt = buildJudgeUserPrompt(scenario, characters, [], specialMessages, 1, 1, 1, 1);
    expect(prompt).toContain("I want truth & justice, not <compromise>.");
    expect(prompt).not.toContain("&amp;");
    expect(prompt).not.toContain("&lt;");
  });

  it("passes special characters in scenario metadata through unescaped", () => {
    const specialScenario = {
      ...scenario,
      initial_prompt: "Alice & Bob said <go>.",
      stress_axes: ["truth & lies"],
      social_context: "A > B dynamic",
      pressure_source: "internal & external",
    };
    const prompt = buildJudgeUserPrompt(specialScenario as any, characters, [], messages, 1, 1, 1, 1);
    expect(prompt).toContain("Alice & Bob said <go>.");
    expect(prompt).toContain("truth & lies");
    expect(prompt).toContain("A > B dynamic");
    expect(prompt).not.toContain("&amp;");
    expect(prompt).not.toContain("&lt;");
    expect(prompt).not.toContain("&gt;");
  });

  it("passes special characters in character traits through unescaped", () => {
    const specialChars = [{
      ...characters[0],
      record: {
        ...characters[0]!.record,
        personalityTraits: ["defiant & bold"],
        values: ["<justice>"],
      } as any,
    }];
    const prompt = buildJudgeUserPrompt(scenario, specialChars as any, [], messages, 1, 1, 1, 1);
    expect(prompt).toContain("defiant & bold");
    expect(prompt).toContain("<justice>");
    expect(prompt).not.toContain("&amp;");
    expect(prompt).not.toContain("&lt;");
  });

  it("passes special characters in prior message character name through unescaped", () => {
    const prior = [
      { turn: 1, character_id: "char_001", character_name: "Kael & Mira", content: "We agreed.", emotion: "calm", intensity: "low", reasoning: null, subtext: "" },
    ] as any[];
    const prompt = buildJudgeUserPrompt(scenario, characters, prior, messages, 2, 2, 2, 2);
    expect(prompt).toContain("Kael & Mira");
    expect(prompt).not.toContain("&amp;");
  });
});
