import { describe, test, expect } from "bun:test";
import {
  ConversationStartInputSchema,
  ConversationJobStatusSchema,
} from "./conversation_start";

const VALID_UUID_1 = "00000000-0000-0000-0000-000000000001";
const VALID_UUID_2 = "00000000-0000-0000-0000-000000000002";

describe("ConversationStartInputSchema", () => {
  test("valid input with all fields passes", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "A tense negotiation in a dark room.",
      turnStrategy: "ROUND_ROBIN",
      turns: 5,
      title: "Negotiation Scene",
    });
    expect(result.success).toBe(true);
  });

  test("title is optional", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context here",
      turnStrategy: "ORCHESTRATOR",
      turns: 3,
    });
    expect(result.success).toBe(true);
  });

  test("requires at least 2 characterIds", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1],
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 3,
    });
    expect(result.success).toBe(false);
  });

  test("rejects turns = 0", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 0,
    });
    expect(result.success).toBe(false);
  });

  test("rejects turns = 501", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 501,
    });
    expect(result.success).toBe(false);
  });

  test("accepts turns = 1 and turns = 500", () => {
    const base = {
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context",
      turnStrategy: "ORCHESTRATOR" as const,
    };
    expect(ConversationStartInputSchema.safeParse({ ...base, turns: 1 }).success).toBe(true);
    expect(ConversationStartInputSchema.safeParse({ ...base, turns: 500 }).success).toBe(true);
  });

  test("rejects invalid turn strategy", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Context",
      turnStrategy: "RANDOM",
      turns: 3,
    });
    expect(result.success).toBe(false);
  });

  test("rejects malformed UUID in characterIds", () => {
    const result = ConversationStartInputSchema.safeParse({
      characterIds: ["not-a-uuid", VALID_UUID_2],
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 3,
    });
    expect(result.success).toBe(false);
  });

  test("rejects more than 20 characterIds", () => {
    const ids = Array.from({ length: 21 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const result = ConversationStartInputSchema.safeParse({
      characterIds: ids,
      context: "Context",
      turnStrategy: "ROUND_ROBIN",
      turns: 3,
    });
    expect(result.success).toBe(false);
  });
});

describe("ConversationJobStatusSchema", () => {
  test("pending status passes", () => {
    const result = ConversationJobStatusSchema.safeParse({
      status: "pending",
      doneTurns: 0,
      totalTurns: 5,
    });
    expect(result.success).toBe(true);
  });

  test("completed status with messages passes", () => {
    const result = ConversationJobStatusSchema.safeParse({
      status: "completed",
      doneTurns: 5,
      totalTurns: 5,
      messages: [
        {
          id: VALID_UUID_1,
          conversationId: VALID_UUID_2,
          characterId: VALID_UUID_1,
          authorUserId: null,
          characterName: "Arthur",
          content: "Hello.",
          reasoning: null,
          emotion: "Joy",
          intensity: "low",
          subtext: "",
          createdAt: "2026-06-03T00:00:00.000Z",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("failed status with error passes", () => {
    const result = ConversationJobStatusSchema.safeParse({
      status: "failed",
      doneTurns: 2,
      totalTurns: 5,
      error: "LLM error",
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown status", () => {
    const result = ConversationJobStatusSchema.safeParse({
      status: "unknown",
      doneTurns: 0,
      totalTurns: 5,
    });
    expect(result.success).toBe(false);
  });
});
