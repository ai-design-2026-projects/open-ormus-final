import { mock } from "bun:test";

const mockGetStore = mock(() => "test-user-id" as string | undefined);

mock.module("../../auth/context.js", () => ({
  userIdStorage: { getStore: mockGetStore },
}));

mock.module("../../auth/internal-token.js", () => ({
  mintInternalToken: () => "mock-jwt-token",
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { conversationJobStatusHandler } from "./conversation_job_status.js";

const mockRunningPayload = {
  status: "running",
  doneTurns: 2,
  totalTurns: 5,
};

const mockCompletedPayload = {
  status: "completed",
  doneTurns: 5,
  totalTurns: 5,
  messages: [],
};

describe("conversationJobStatusHandler", () => {
  beforeEach(() => {
    mockGetStore.mockImplementation(() => "test-user-id");
    process.env["FRONTEND_INTERNAL_URL"] = "http://localhost:3000";
  });

  test("returns job status from frontend API", async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => mockRunningPayload,
    } as unknown as Response));

    const result = await conversationJobStatusHandler("job-abc");
    expect(result.status).toBe("running");
    expect(result.doneTurns).toBe(2);
    expect(result.totalTurns).toBe(5);
  });

  test("calls correct URL with Authorization header", async () => {
    const mockFetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => mockCompletedPayload,
    } as unknown as Response));
    globalThis.fetch = mockFetch;

    await conversationJobStatusHandler("job-xyz");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/internal/conversation-jobs/job-xyz");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer mock-jwt-token");
  });

  test("throws on 404", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    } as unknown as Response));

    await expect(conversationJobStatusHandler("missing-job")).rejects.toThrow(
      "Job missing-job not found"
    );
  });

  test("throws on other non-ok status", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response));

    await expect(conversationJobStatusHandler("job-abc")).rejects.toThrow(
      "Failed to get job status: 500"
    );
  });
});
