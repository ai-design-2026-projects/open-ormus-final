import { describe, test, expect } from "bun:test";
import {
  buildOrchestratorSystemPrompt,
  buildOrchestratorMessages,
} from "../conversation/build-orchestrator-messages";

type Participant = { characterId: string; character: { name: string } };
type Msg = {
  characterId: string;
  character: { name: string };
  content: string;
  reasoning: string | null;
};

const p = (id: string, name: string): Participant => ({
  characterId: id,
  character: { name },
});

const m = (
  characterId: string,
  name: string,
  content: string,
  reasoning: string | null = null,
): Msg => ({ characterId, character: { name }, content, reasoning });

const PARTICIPANTS = [p("id-a", "Alice"), p("id-b", "Bob")];

describe("buildOrchestratorSystemPrompt", () => {
  test("contains character ids and names", () => {
    const prompt = buildOrchestratorSystemPrompt(PARTICIPANTS);
    expect(prompt).toContain("id-a");
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("id-b");
    expect(prompt).toContain("Bob");
  });

  test("does not contain sheets or extra character data", () => {
    const prompt = buildOrchestratorSystemPrompt(PARTICIPANTS);
    expect(prompt).not.toContain("sheet");
    expect(prompt).not.toContain("personality");
  });
});

describe("buildOrchestratorMessages", () => {
  test("empty messages — returns only scene-start user message", () => {
    const result = buildOrchestratorMessages([]);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content as string).toContain("scene has just begun");
  });

  test("one message — scene-start + assistant + final user", () => {
    const result = buildOrchestratorMessages([m("id-a", "Alice", "Hello")]);
    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content as string).toContain("scene has just begun");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content).toBe("id-a");
    expect(result[2]!.role).toBe("user");
    expect(result[2]!.content as string).toContain("Alice");
    expect(result[2]!.content as string).toContain("Hello");
    expect(result[2]!.content as string).toContain("Who speaks next");
  });

  test("two messages — correct historical pairs and final user", () => {
    const result = buildOrchestratorMessages([
      m("id-a", "Alice", "Hello"),
      m("id-b", "Bob", "Hi there"),
    ]);
    // scene-start, asst(id-a), user(alice's line), asst(id-b), user(bob's line)
    expect(result).toHaveLength(5);
    expect(result[1]!.content).toBe("id-a");
    expect(result[2]!.content as string).toContain("Alice");
    expect(result[2]!.content as string).toContain("Hello");
    expect(result[3]!.content).toBe("id-b");
    expect(result[4]!.content as string).toContain("Bob");
    expect(result[4]!.content as string).toContain("Hi there");
  });

  test("reasoning null — no Private thoughts line in that turn", () => {
    const result = buildOrchestratorMessages([
      m("id-a", "Alice", "Hello", null),
      m("id-b", "Bob", "Hi"),
    ]);
    // user turn for Alice's line (index 2) should have no "Private thoughts"
    expect(result[2]!.content as string).not.toContain("Private thoughts");
  });

  test("reasoning present — Private thoughts line included in that turn", () => {
    const result = buildOrchestratorMessages([
      m("id-a", "Alice", "Hello", "I am nervous"),
      m("id-b", "Bob", "Hi"),
    ]);
    expect(result[2]!.content as string).toContain("Private thoughts");
    expect(result[2]!.content as string).toContain("I am nervous");
  });

  test("always starts with a user turn", () => {
    expect(buildOrchestratorMessages([])[0]!.role).toBe("user");
    expect(buildOrchestratorMessages([m("id-a", "Alice", "Hi")])[0]!.role).toBe("user");
  });

  test("always ends with a user turn", () => {
    const single = buildOrchestratorMessages([m("id-a", "Alice", "Hi")]);
    expect(single[single.length - 1]!.role).toBe("user");

    const two = buildOrchestratorMessages([
      m("id-a", "Alice", "Hi"),
      m("id-b", "Bob", "Hey"),
    ]);
    expect(two[two.length - 1]!.role).toBe("user");
  });
});
