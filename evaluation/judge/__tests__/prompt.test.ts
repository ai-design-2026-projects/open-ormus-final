import { describe, it, expect } from "bun:test";
import { buildJudgeSystemPrompt, buildJudgeUserMessage } from "../prompt";
import type { CharacterRecord, ScenarioRecord } from "../../generator/config";
import type { ConversationMessage } from "../../generator/conversation";

const scenario: ScenarioRecord = {
  id: "s1",
  title: "Test Scenario",
  context: "A tense confrontation at the gate",
  initial_prompt: "The gate is sealed.",
  difficulty_level: "high",
  stress_axes: ["loyalty_vs_principle"],
  social_context: "personal_betrayal",
  pressure_source: "relational_demand",
};

const characters: CharacterRecord[] = [
  {
    id: "char_001",
    name: "Alice",
    archetype: "Rebel",
    personalityTraits: ["defiant", "principled"],
    backstory: "Grew up in poverty, vowed to fight injustice.",
    speechPatterns: ["short declarative sentences"],
    values: ["justice", "freedom"],
    fears: ["conformity"],
    goals: ["overthrow tyranny"],
    notableQuotes: ["I refuse to bow."],
    abilities: ["combat", "persuasion"],
    copingStyle: ["direct confrontation"],
    difficultyTier: "hard",
    similarTo: null,
    varyingAxis: null,
  },
  {
    id: "char_002",
    name: "Bob",
    archetype: "Sage",
    personalityTraits: ["wise", "calm"],
    backstory: "A wandering scholar who seeks balance.",
    speechPatterns: ["long rhetorical questions"],
    values: ["truth", "knowledge"],
    fears: ["ignorance"],
    goals: ["enlighten others"],
    notableQuotes: ["Knowledge is the only true power."],
    abilities: ["analysis", "teaching"],
    copingStyle: ["reflection"],
    difficultyTier: "medium",
    similarTo: null,
    varyingAxis: null,
  },
];

const messages: ConversationMessage[] = [
  {
    turn: 1,
    character_id: "char_001",
    character_name: "Shadow",
    content: "I refuse to yield.",
    emotion: "anger",
    intensity: "high",
    reasoning: null,
    subtext: "",
  },
  {
    turn: 2,
    character_id: "char_002",
    character_name: "Phantom",
    content: "Consider what you stand to lose.",
    emotion: "calm",
    intensity: "low",
    reasoning: null,
    subtext: "",
  },
];

const aliasMap: Record<string, string> = {
  Shadow: "Alice",
  Phantom: "Bob",
};

describe("buildJudgeSystemPrompt", () => {
  it("contains 'behavioral analyst'", () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain("behavioral analyst");
  });

  it("contains 'Tier 1'", () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain("Tier 1");
  });

  it("contains 'Tier 2'", () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain("Tier 2");
  });

  it("contains 'Tier 3'", () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain("Tier 3");
  });
});

describe("buildJudgeUserMessage — escaping", () => {
  it("passes & through raw (not &amp;)", () => {
    const specialMessages: ConversationMessage[] = [
      { ...messages[0]!, content: "Truth & justice" },
    ];
    const result = buildJudgeUserMessage(aliasMap, characters, scenario, specialMessages);
    expect(result).toContain("&");
    expect(result).not.toContain("&amp;");
  });

  it("passes < through raw (not &lt;)", () => {
    const specialMessages: ConversationMessage[] = [
      { ...messages[0]!, content: "A < B always" },
    ];
    const result = buildJudgeUserMessage(aliasMap, characters, scenario, specialMessages);
    expect(result).toContain("<");
    expect(result).not.toContain("&lt;");
  });

  it("passes > through raw (not &gt;)", () => {
    const specialMessages: ConversationMessage[] = [
      { ...messages[0]!, content: "A > B always" },
    ];
    const result = buildJudgeUserMessage(aliasMap, characters, scenario, specialMessages);
    expect(result).toContain(">");
    expect(result).not.toContain("&gt;");
  });

  it("passes apostrophe through raw (not &#x27;)", () => {
    const specialMessages: ConversationMessage[] = [
      { ...messages[0]!, content: "It's mine" },
    ];
    const result = buildJudgeUserMessage(aliasMap, characters, scenario, specialMessages);
    expect(result).toContain("'");
    expect(result).not.toContain("&#x27;");
  });
});

describe("buildJudgeUserMessage — no undefined leak", () => {
  it("does not contain the string 'undefined' anywhere", () => {
    const result = buildJudgeUserMessage(aliasMap, characters, scenario, messages);
    expect(result).not.toContain("undefined");
  });
});

describe("buildJudgeUserMessage — data round-trip", () => {
  it("includes the scenario title in the output", () => {
    const result = buildJudgeUserMessage(aliasMap, characters, scenario, messages);
    expect(result).toContain("Test Scenario");
  });

  it("includes a character speechPatterns value in the output", () => {
    const result = buildJudgeUserMessage(aliasMap, characters, scenario, messages);
    expect(result).toContain("short declarative sentences");
  });

  it("includes a transcript message content in the output", () => {
    const result = buildJudgeUserMessage(aliasMap, characters, scenario, messages);
    expect(result).toContain("I refuse to yield.");
  });
});
