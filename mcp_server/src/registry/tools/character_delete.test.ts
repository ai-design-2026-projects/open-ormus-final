import { mock } from "bun:test";

const mockDeleteMany = mock(async () => ({ count: 1 }));

mock.module("../../db.js", () => ({
  prisma: {
    character: {
      deleteMany: mockDeleteMany,
    },
  },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterDeleteHandler } from "./character_delete";
import { userIdStorage } from "../../auth/context";

describe("characterDeleteHandler", () => {
  beforeEach(() => {
    mockDeleteMany.mockClear();
  });

  test("deletes character and returns success", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    expect(result).toEqual({ success: true });
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
  });

  test("scopes delete to current userId", async () => {
    await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    const deleteCall = mockDeleteMany.mock.calls[0]?.[0] as {
      where: { id: string; userId: string };
    };
    expect(deleteCall.where.userId).toBe("test-user");
    expect(deleteCall.where.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  test("returns not_found when record does not belong to user", async () => {
    mockDeleteMany.mockImplementation(async () => ({ count: 0 }));
    const result = await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    expect(result).toEqual({ error: "not_found" });
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
  });

  test("throws if userId not in context", async () => {
    expect(() =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    ).toThrow();
  });
});
