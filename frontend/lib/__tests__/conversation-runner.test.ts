// frontend/lib/__tests__/conversation-runner.test.ts
import { mock } from "bun:test";

// Mock paths must match the import specifiers used inside runner.ts
mock.module("@/lib/prisma", () => ({
  prisma: {
    conversationJob: {
      update: async () => ({}),
    },
  },
}));

mock.module("@/lib/conversation/next", () => ({
  generateNextTurnStream: async function* (_conversationId: string, _userId: string) {
    yield "hello";
    yield " world";
  },
}));

import { describe, test, expect } from "bun:test";
import { startJob, subscribeToJob } from "../jobs/runner";

describe("subscribeToJob", () => {
  test("receives token events in order", async () => {
    const received: string[] = [];

    await new Promise<void>((resolve) => {
      const unsub = subscribeToJob("job-a", {
        onToken: (t) => received.push(t),
        onTurnDone: () => {},
        onDone: () => { unsub(); resolve(); },
        onError: (e) => { unsub(); throw new Error(e); },
      });

      void startJob("job-a", "conv-a", "user-a", 1);
    });

    expect(received).toEqual(["hello", " world"]);
  });

  test("receives turn_done with correct count", async () => {
    const turnsDone: number[] = [];

    await new Promise<void>((resolve) => {
      const unsub = subscribeToJob("job-b", {
        onToken: () => {},
        onTurnDone: (done) => turnsDone.push(done),
        onDone: () => { unsub(); resolve(); },
        onError: (e) => { unsub(); throw new Error(e); },
      });

      void startJob("job-b", "conv-b", "user-b", 2);
    });

    expect(turnsDone).toEqual([1, 2]);
  });

  test("unsubscribe stops receiving events", async () => {
    const received: string[] = [];

    await new Promise<void>((resolve) => {
      const unsub = subscribeToJob("job-c", {
        onToken: (t) => { received.push(t); unsub(); },
        onTurnDone: () => {},
        onDone: () => resolve(),
        onError: () => resolve(),
      });

      void startJob("job-c", "conv-c", "user-c", 1);
    });

    expect(received).toHaveLength(1);
  });
});
