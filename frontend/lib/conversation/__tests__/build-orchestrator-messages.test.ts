import { describe, expect, test } from "bun:test";
import {
  buildOrchestratorSystemPrompt,
  buildOrchestratorMessages,
  type OrchestratorParticipant,
  type OrchestratorMessage,
} from "../build-orchestrator-messages";

const charParticipants: OrchestratorParticipant[] = [
  { characterId: "char-1", isUserParticipant: false, character: { name: "Alice" } },
  { characterId: "char-2", isUserParticipant: false, character: { name: "Bob" } },
];

const withUser: OrchestratorParticipant[] = [
  { characterId: "char-1", isUserParticipant: false, character: { name: "Alice" } },
  { characterId: null, isUserParticipant: true, userDisplayName: "Dave", character: null },
];

describe("buildOrchestratorSystemPrompt", () => {
  test("lists character participants by id and name", () => {
    const prompt = buildOrchestratorSystemPrompt(charParticipants);
    expect(prompt).toContain("id: char-1 | Name: Alice");
    expect(prompt).toContain("id: char-2 | Name: Bob");
  });

  test("lists user participant with sentinel id 'user' and displayName", () => {
    const prompt = buildOrchestratorSystemPrompt(withUser);
    expect(prompt).toContain("id: user | Name: Dave");
  });

  test("omits null from character list", () => {
    const prompt = buildOrchestratorSystemPrompt(withUser);
    expect(prompt).not.toContain("id: null");
  });
});

describe("buildOrchestratorMessages — user messages in history", () => {
  const userMessage: OrchestratorMessage = {
    characterId: null,
    authorUserId: "user-uuid",
    character: null,
    authorName: "Dave",
    content: "Hello there.",
    reasoning: null,
  };
  const charMessage: OrchestratorMessage = {
    characterId: "char-1",
    authorUserId: null,
    character: { name: "Alice" },
    authorName: null,
    content: "Hi Dave.",
    reasoning: null,
  };

  test("formats user message with authorName in history", () => {
    const msgs = buildOrchestratorMessages([userMessage, charMessage]);
    const hasUserLine = msgs.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("[Dave]:")
    );
    expect(hasUserLine).toBe(true);
  });

  test("formats character message with character.name in history", () => {
    const msgs = buildOrchestratorMessages([userMessage, charMessage]);
    const hasAliceLine = msgs.some(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("[Alice]:")
    );
    expect(hasAliceLine).toBe(true);
  });
});
