import { describe, test, expect } from "bun:test";
import { buildCharacterMessages } from "../conversation/build-messages";

// Minimal message shape matching what next.ts passes
type Msg = {
  characterId: string;
  character: { name: string };
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
};

const msg = (characterId: string, name: string, content: string): Msg => ({
  characterId,
  character: { name },
  content,
  emotion: "Joy",
  intensity: "low",
  subtext: "",
});

describe("buildCharacterMessages", () => {
  test("single user message when character has never spoken and no history", () => {
    const result = buildCharacterMessages([], "a", "Alice", "");
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toContain("Continue as Alice");
  });

  test("single user message when character has never spoken and others have", () => {
    const history = [msg("b", "Bob", "Hello"), msg("c", "Carol", "Hi")];
    const result = buildCharacterMessages(history, "a", "Alice", "");
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
    const result = buildCharacterMessages(history, "a", "Alice", "");
    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content as string).toContain("My answer.");
    expect(result[1]!.content as string).toContain("<dialogue>");
    expect(result[1]!.content as string).toContain("<emotion>");
    expect(result[2]!.role).toBe("user");
    expect(result[2]!.content as string).toContain("Follow-up");
  });

  test("reasoning injected into last user message only", () => {
    const history = [msg("b", "Bob", "Hey")];
    const result = buildCharacterMessages(history, "a", "Alice", "I feel nervous.");
    const last = result[result.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content as string).toContain("I feel nervous.");
    // Earlier turns (if any) must NOT contain reasoning
    result.slice(0, -1).forEach((turn) => {
      expect(turn.content as string).not.toContain("I feel nervous.");
    });
  });

  test("no reasoning prefix when reasoning is empty string", () => {
    const history = [msg("b", "Bob", "Hey")];
    const result = buildCharacterMessages(history, "a", "Alice", "");
    const last = result[result.length - 1]!;
    expect(last.content as string).not.toContain("private thoughts");
  });

  test("character spoke first — synthetic scene-start user turn is inserted", () => {
    const history = [
      msg("a", "Alice", "I begin."),
      msg("b", "Bob", "Reply."),
    ];
    const result = buildCharacterMessages(history, "a", "Alice", "");
    // Must start with user turn (scene start), then assistant (Alice's first line)
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.content as string).toContain("I begin.");
    expect(result[1]!.content as string).toContain("<dialogue>");
    expect(result[1]!.content as string).toContain("<emotion>");
  });

  test("three-character conversation groups others correctly", () => {
    // A, B, C take turns: B then C speak before A's second turn
    const history = [
      msg("b", "Bob", "B line 1"),
      msg("a", "Alice", "A line 1"),
      msg("b", "Bob", "B line 2"),
      msg("c", "Carol", "C line 1"),
    ];
    const result = buildCharacterMessages(history, "a", "Alice", "");
    // [user(B line 1), assistant(A line 1), user(B line 2 + C line 1), ...trigger]
    expect(result).toHaveLength(4); // user, assistant, user(bundle), user(trigger)
    expect(result[2]!.role).toBe("user");
    const bundled = result[2]!.content as string;
    expect(bundled).toContain("Bob");
    expect(bundled).toContain("Carol");
  });

  test("always ends with a user turn", () => {
    const history = [msg("b", "Bob", "Hey"), msg("a", "Alice", "Hello")];
    const result = buildCharacterMessages(history, "a", "Alice", "");
    expect(result[result.length - 1]!.role).toBe("user");
  });

  test("first message is always user role", () => {
    const cases = [
      [],
      [msg("b", "Bob", "Hi")],
      [msg("a", "Alice", "First")],
    ];
    for (const history of cases) {
      const result = buildCharacterMessages(history, "a", "Alice", "");
      expect(result[0]!.role).toBe("user");
    }
  });
});
