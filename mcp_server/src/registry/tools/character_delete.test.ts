import { mock } from "bun:test";

const mockUpdateMany = mock(async () => ({ count: 1 }));
const mockFindFirst = mock(async () => null);

mock.module("../../db.js", () => ({
  prisma: {
    character: {
      updateMany: mockUpdateMany,
      findFirst: mockFindFirst,
    },
  },
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { characterDeleteHandler } from "./character_delete";
import { userIdStorage } from "../../auth/context";

describe("characterDeleteHandler (archive)", () => {
  beforeEach(() => {
    mockUpdateMany.mockClear();
    mockFindFirst.mockClear();
  });

  test("archives character and returns success", async () => {
    const result = await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    expect(result).toEqual({ success: true });
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  });

  test("scopes archive to current userId and filters by archivedAt: null", async () => {
    await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    const updateCall = mockUpdateMany.mock.calls[0]?.[0] as {
      where: { id: string; userId: string; archivedAt: null };
      data: { archivedAt: Date };
    };
    expect(updateCall.where.userId).toBe("test-user");
    expect(updateCall.where.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(updateCall.where.archivedAt).toBeNull();
    expect(updateCall.data.archivedAt).toBeInstanceOf(Date);
  });

  test("returns not_found when no row matches", async () => {
    mockUpdateMany.mockImplementationOnce(async () => ({ count: 0 }));
    // mockFindFirst already returns null by default
    const result = await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    expect(result).toEqual({ error: "not_found" });
  });

  test("returns already_archived when row exists but is already archived", async () => {
    mockUpdateMany.mockImplementationOnce(async () => ({ count: 0 }));
    mockFindFirst.mockImplementationOnce(async () => ({
      id: "00000000-0000-0000-0000-000000000001",
      userId: "test-user",
      name: "Arthur",
      sheet: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: new Date("2026-01-15"),
    }));
    const result = await userIdStorage.run("test-user", () =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    );
    expect(result).toEqual({ error: "already_archived" });
  });

  test("throws if userId not in context", async () => {
    expect(() =>
      characterDeleteHandler({ id: "00000000-0000-0000-0000-000000000001" })
    ).toThrow();
  });
});
