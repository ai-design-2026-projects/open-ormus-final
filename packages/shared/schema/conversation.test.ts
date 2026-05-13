import { describe, expect, test } from "bun:test";
import {
  CreateConversationInputSchema,
  ConversationListItemSchema,
  ConversationRecordSchema,
  MessageRecordSchema,
} from "./conversation";

describe("CreateConversationInputSchema", () => {
  test("accepts valid input", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "Test scene",
      context: "A dark forest at midnight.",
      characterIds: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty title", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "",
      context: "Some context",
      characterIds: ["11111111-1111-1111-1111-111111111111"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty context", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "Title",
      context: "",
      characterIds: ["11111111-1111-1111-1111-111111111111"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty characterIds array", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "Title",
      context: "Context",
      characterIds: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid UUID in characterIds", () => {
    const result = CreateConversationInputSchema.safeParse({
      title: "Title",
      context: "Context",
      characterIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });
});

describe("MessageRecordSchema", () => {
  test("accepts valid message record", () => {
    const result = MessageRecordSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      conversationId: "22222222-2222-2222-2222-222222222222",
      characterId: "33333333-3333-3333-3333-333333333333",
      characterName: "Alice",
      content: "Hello there.",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});

describe("ConversationListItemSchema", () => {
  test("accepts item with null lastMessage", () => {
    const result = ConversationListItemSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Scene 1",
      createdAt: new Date().toISOString(),
      participants: [
        { characterId: "22222222-2222-2222-2222-222222222222", name: "Alice" },
      ],
      lastMessage: null,
    });
    expect(result.success).toBe(true);
  });

  test("accepts item with lastMessage", () => {
    const result = ConversationListItemSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Scene 1",
      createdAt: new Date().toISOString(),
      participants: [
        { characterId: "22222222-2222-2222-2222-222222222222", name: "Alice" },
      ],
      lastMessage: {
        characterName: "Alice",
        content: "Hello.",
        createdAt: new Date().toISOString(),
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("ConversationRecordSchema", () => {
  test("accepts valid conversation record", () => {
    const result = ConversationRecordSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Scene 1",
      context: "Forest at night.",
      createdAt: new Date().toISOString(),
      participants: [
        {
          characterId: "22222222-2222-2222-2222-222222222222",
          name: "Alice",
          turnOrder: 0,
        },
      ],
      messages: [],
    });
    expect(result.success).toBe(true);
  });
});
