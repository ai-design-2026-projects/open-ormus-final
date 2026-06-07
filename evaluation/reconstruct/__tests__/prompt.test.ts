import { describe, it, expect } from "bun:test";
import {
  buildReconstructorSystemPrompt,
  buildReconstructorUserMessage,
  buildComparatorSystemPrompt,
  buildComparatorUserMessage,
} from "../prompt";

const scenario = {
  id: "s1",
  title: "The Reckoning",
  context: "A tense confrontation at the gate",
  initial_prompt: "The gate is sealed.",
  difficulty_level: "high",
  stress_axes: ["loyalty_vs_principle"],
  social_context: "personal_betrayal",
  pressure_source: "relational_demand",
} as any;

const messages = [
  { turn: 1, character_id: "c1", character_name: "Kael", content: "I refuse to yield.", emotion: "anger", intensity: "high", reasoning: null, subtext: "" },
] as any[];

describe("buildReconstructorSystemPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildReconstructorSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("contains JSON response format keywords", () => {
    const prompt = buildReconstructorSystemPrompt();
    expect(prompt).toContain("not_observed");
    expect(prompt).toContain("items");
    expect(prompt).toContain("JSON");
  });

  it("includes all 6 profile fields in the JSON example", () => {
    const prompt = buildReconstructorSystemPrompt();
    expect(prompt).toContain("personalityTraits");
    expect(prompt).toContain("speechPatterns");
    expect(prompt).toContain("values");
    expect(prompt).toContain("fears");
    expect(prompt).toContain("goals");
    expect(prompt).toContain("copingStyle");
  });

  it("includes totality constraint requiring all fields in response", () => {
    const prompt = buildReconstructorSystemPrompt();
    expect(prompt).toContain("include every field");
    expect(prompt).toContain("output all of them");
  });
});

describe("buildReconstructorUserMessage", () => {
  it("contains the character alias", () => {
    const msg = buildReconstructorUserMessage("Kael", scenario, messages, ["personalityTraits"]);
    expect(msg).toContain("Kael");
  });

  it("contains the scenario title and context", () => {
    const msg = buildReconstructorUserMessage("Kael", scenario, messages, ["personalityTraits"]);
    expect(msg).toContain("The Reckoning");
    expect(msg).toContain("A tense confrontation at the gate");
  });

  it("contains each requested field name and its definition", () => {
    const msg = buildReconstructorUserMessage("Kael", scenario, messages, ["personalityTraits", "values"]);
    expect(msg).toContain("personalityTraits");
    expect(msg).toContain("Stable character traits");
    expect(msg).toContain("values");
    expect(msg).toContain("What this character demonstrably prioritizes");
  });

  it("contains the transcript message content", () => {
    const msg = buildReconstructorUserMessage("Kael", scenario, messages, ["personalityTraits"]);
    expect(msg).toContain("I refuse to yield.");
  });

  it("omits fields not in the requested list", () => {
    const msg = buildReconstructorUserMessage("Kael", scenario, messages, ["personalityTraits"]);
    expect(msg).not.toContain("copingStyle");
  });
});

describe("buildComparatorSystemPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildComparatorSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("contains scoring label keywords and expected JSON structure", () => {
    const prompt = buildComparatorSystemPrompt();
    expect(prompt).toContain("match");
    expect(prompt).toContain("item_scores");
    expect(prompt).toContain("JSON");
  });
});

describe("buildComparatorUserMessage", () => {
  it("contains the field name and its definition", () => {
    const msg = buildComparatorUserMessage("personalityTraits", ["defiant"], ["bold"]);
    expect(msg).toContain("personalityTraits");
    expect(msg).toContain("Stable character traits");
  });

  it("contains the ground-truth items", () => {
    const msg = buildComparatorUserMessage("values", ["justice", "loyalty"], ["freedom"]);
    expect(msg).toContain("justice");
    expect(msg).toContain("loyalty");
  });

  it("contains the reconstructed items", () => {
    const msg = buildComparatorUserMessage("values", ["justice"], ["freedom", "equality"]);
    expect(msg).toContain("freedom");
    expect(msg).toContain("equality");
  });

  it("numbers items from 1 via the addOne Handlebars helper", () => {
    const msg = buildComparatorUserMessage("values", ["justice", "loyalty"], ["freedom", "truth"]);
    expect(msg).toContain("1. justice");
    expect(msg).toContain("2. loyalty");
    expect(msg).toContain("1. freedom");
    expect(msg).toContain("2. truth");
  });

  it("handles empty gtItems without crashing", () => {
    expect(() => buildComparatorUserMessage("values", [], ["freedom"])).not.toThrow();
  });

  it("handles empty reconstructedItems without crashing", () => {
    expect(() => buildComparatorUserMessage("values", ["justice"], [])).not.toThrow();
  });

  it("passes special characters in items through unescaped", () => {
    const msg = buildComparatorUserMessage("values", ["truth & justice"], ["kindness < power"]);
    expect(msg).toContain("truth & justice");
    expect(msg).toContain("kindness < power");
    expect(msg).not.toContain("&amp;");
    expect(msg).not.toContain("&lt;");
  });
});

describe("buildReconstructorUserMessage — edge cases", () => {
  it("handles empty messages list without crashing", () => {
    expect(() => buildReconstructorUserMessage("Kael", scenario, [], ["personalityTraits"])).not.toThrow();
  });

  it("includes all 6 profile fields and their definitions when all requested", () => {
    const allFields = ["personalityTraits", "speechPatterns", "values", "fears", "goals", "copingStyle"] as any[];
    const msg = buildReconstructorUserMessage("Kael", scenario, messages, allFields);
    expect(msg).toContain("Stable character traits");
    expect(msg).toContain("Observable features of how this character constructs sentences");
    expect(msg).toContain("What this character demonstrably prioritizes");
    expect(msg).toContain("What this character avoids");
    expect(msg).toContain("What this character is trying to achieve");
    expect(msg).toContain("How this character manages stress");
  });

  it("passes special characters in message content through unescaped", () => {
    const specialMsgs = [
      { character_name: "Kael", content: "I said <nothing> & meant it — 100%.", emotion: "anger", intensity: "high" },
    ] as any[];
    const msg = buildReconstructorUserMessage("Kael", scenario, specialMsgs, ["personalityTraits"]);
    expect(msg).toContain("I said <nothing> & meant it — 100%.");
    expect(msg).not.toContain("&lt;");
    expect(msg).not.toContain("&amp;");
  });

  it("includes all messages in the transcript, not just the first", () => {
    const multiMsgs = [
      { character_name: "Kael", content: "First line.", emotion: "calm", intensity: "low" },
      { character_name: "Mira", content: "Second line.", emotion: "anger", intensity: "high" },
    ] as any[];
    const msg = buildReconstructorUserMessage("Kael", scenario, multiMsgs, ["personalityTraits"]);
    expect(msg).toContain("First line.");
    expect(msg).toContain("Second line.");
  });

  it("passes special characters in scenario title and context through unescaped", () => {
    const specialScenario = { ...scenario, title: "Truth & Consequences", context: "Where A < B" };
    const msg = buildReconstructorUserMessage("Kael", specialScenario as any, messages, ["personalityTraits"]);
    expect(msg).toContain("Truth & Consequences");
    expect(msg).toContain("Where A < B");
    expect(msg).not.toContain("&amp;");
    expect(msg).not.toContain("&lt;");
  });

  it("passes special characters in alias through unescaped", () => {
    const msg = buildReconstructorUserMessage("Kael & Mira", scenario, messages, ["personalityTraits"]);
    expect(msg).toContain("Kael & Mira");
    expect(msg).not.toContain("&amp;");
  });
});
