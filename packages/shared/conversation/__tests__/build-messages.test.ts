import { describe, test, expect } from "bun:test";
import { buildCharacterMessages } from "../build-messages";

type Msg = {
  characterId: string;
  character: { name: string };
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
  reasoning: string | null;
};

const msg = (
  characterId: string,
  name: string,
  content: string,
  reasoning: string | null = null,
): Msg => ({
  characterId,
  character: { name },
  content,
  emotion: "Joy",
  intensity: "low",
  subtext: "",
  reasoning,
});

describe("buildCharacterMessages", () => {
  test("single user message when character has never spoken and no history", () => {
    const result = buildCharacterMessages([], "a", "Alice");
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toContain("Continue as Alice");
  });

  test("single user message when character has never spoken and others have", () => {
    const history = [msg("b", "Bob", "Hello"), msg("c", "Carol", "Hi")];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    const content = result[0]!.content as string;
    expect(content).toContain("Bob");
    expect(content).toContain("Carol");
    expect(content).toContain("Continue as Alice");
  });

  test("user+assistant+user when character spoke once and others replied", () => {
    const history = [
      msg("b", "Bob", "Question?"),
      msg("a", "Alice", "My answer."),
      msg("b", "Bob", "Follow-up?"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content as string).toContain("My answer.");
    expect(result[1]!.content as string).toContain("<|emotion|>");
    expect(result[2]!.role).toBe("user");
    expect(result[2]!.content as string).toContain("Follow-up");
  });

  test("historical assistant message includes <|reasoning|> prefix when reasoning is present", () => {
    const history = [
      msg("a", "Alice", "My answer.", "I was nervous about this."),
      msg("b", "Bob", "Follow-up?"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    const assistantTurn = result.find((m) => m.role === "assistant");
    expect(assistantTurn?.content as string).toContain(
      "<|reasoning|>I was nervous about this.<|reasoning|>",
    );
    expect(assistantTurn?.content as string).toContain("<|emotion|>");
    expect(assistantTurn?.content as string).toContain("My answer.");
  });

  test("historical assistant message omits <|reasoning|> prefix when reasoning is null", () => {
    const history = [
      msg("a", "Alice", "My answer.", null),
      msg("b", "Bob", "Follow-up?"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    const assistantTurn = result.find((m) => m.role === "assistant");
    expect(assistantTurn?.content as string).not.toContain("<|reasoning|>");
    expect(assistantTurn?.content as string).toContain("<|emotion|>");
  });

  test("reasoning is not exposed to other characters", () => {
    // Carol's messages (user turns when building for Alice) must never contain reasoning
    const history = [
      msg("b", "Bob", "Hey"),
      msg("c", "Carol", "Hello.", "Carol's private thought"),
      msg("a", "Alice", "Hi there."),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    // user turns should not contain Carol's reasoning
    const userTurns = result.filter((m) => m.role === "user");
    for (const turn of userTurns) {
      expect(turn.content as string).not.toContain("Carol's private thought");
    }
  });

  test("character spoke first — synthetic scene-start user turn is inserted", () => {
    const history = [
      msg("a", "Alice", "I begin."),
      msg("b", "Bob", "Reply."),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content as string).toContain("I begin.");
    expect(result[1]!.content as string).toContain("<|emotion|>");
  });

  test("three-character conversation groups others correctly", () => {
    const history = [
      msg("b", "Bob", "B line 1"),
      msg("a", "Alice", "A line 1"),
      msg("b", "Bob", "B line 2"),
      msg("c", "Carol", "C line 1"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result).toHaveLength(4);
    expect(result[2]!.role).toBe("user");
    const bundled = result[2]!.content as string;
    expect(bundled).toContain("Bob");
    expect(bundled).toContain("Carol");
  });

  test("always ends with a user turn", () => {
    const history = [msg("b", "Bob", "Hey"), msg("a", "Alice", "Hello")];
    const result = buildCharacterMessages(history, "a", "Alice");
    expect(result[result.length - 1]!.role).toBe("user");
  });

  test("first message is always user role", () => {
    const cases = [
      [],
      [msg("b", "Bob", "Hi")],
      [msg("a", "Alice", "First")],
    ];
    for (const history of cases) {
      const result = buildCharacterMessages(history, "a", "Alice");
      expect(result[0]!.role).toBe("user");
    }
  });
});
