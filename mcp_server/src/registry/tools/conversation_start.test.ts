import { mock } from "bun:test";

const mockGetStore = mock(() => "test-user-id" as string | undefined);

mock.module("../../auth/context.js", () => ({
  userIdStorage: { getStore: mockGetStore },
}));

mock.module("../../auth/internal-token.js", () => ({
  mintInternalToken: () => "mock-jwt-token",
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { conversationStartHandler } from "./conversation_start.js";

const VALID_UUID_1 = "00000000-0000-0000-0000-000000000001";
const VALID_UUID_2 = "00000000-0000-0000-0000-000000000002";

const mockFetchSuccess = mock(async () => ({
  ok: true,
  status: 202,
  json: async () => ({ conversationId: "conv-1", jobId: "job-1" }),
} as unknown as Response));

describe("conversationStartHandler", () => {
  beforeEach(() => {
    mockFetchSuccess.mockClear();
    mockGetStore.mockImplementation(() => "test-user-id");
    globalThis.fetch = mockFetchSuccess;
    process.env["FRONTEND_INTERNAL_URL"] = "http://localhost:3000";
  });

  test("calls correct endpoint with Authorization header", async () => {
    await conversationStartHandler({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "A tense scene.",
      turnStrategy: "ROUND_ROBIN",
      turns: 5,
    });

    expect(mockFetchSuccess.mock.calls).toHaveLength(1);
    const [url, init] = mockFetchSuccess.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/internal/conversation-jobs");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer mock-jwt-token");
    expect(init.method).toBe("POST");
  });

  test("returns conversationId and jobId on success", async () => {
    const result = await conversationStartHandler({
      characterIds: [VALID_UUID_1, VALID_UUID_2],
      context: "Scene.",
      turnStrategy: "ORCHESTRATOR",
      turns: 3,
    });

    expect(result.conversationId).toBe("conv-1");
    expect(result.jobId).toBe("job-1");
  });

  test("throws on non-ok response", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    } as unknown as Response));

    await expect(
      conversationStartHandler({
        characterIds: [VALID_UUID_1, VALID_UUID_2],
        context: "Scene.",
        turnStrategy: "ROUND_ROBIN",
        turns: 3,
      })
    ).rejects.toThrow("Failed to start conversation");
  });

  test("throws if userId not in context", async () => {
    mockGetStore.mockImplementation(() => undefined);

    await expect(
      conversationStartHandler({
        characterIds: [VALID_UUID_1, VALID_UUID_2],
        context: "Scene.",
        turnStrategy: "ROUND_ROBIN",
        turns: 3,
      })
    ).rejects.toThrow("userId not in context");
  });
});
