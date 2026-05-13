import { describe, test, expect } from "bun:test";
import { userIdStorage } from "./context";

describe("userIdStorage", () => {
  test("getStore returns undefined outside of run()", () => {
    expect(userIdStorage.getStore()).toBeUndefined();
  });

  test("getStore returns value inside run()", async () => {
    const result = await userIdStorage.run("user-123", () =>
      Promise.resolve(userIdStorage.getStore())
    );
    expect(result).toBe("user-123");
  });

  test("nested run() scopes do not bleed", async () => {
    let inner: string | undefined;
    await userIdStorage.run("outer", async () => {
      await userIdStorage.run("inner", () => {
        inner = userIdStorage.getStore();
        return Promise.resolve();
      });
      expect(userIdStorage.getStore()).toBe("outer");
    });
    expect(inner).toBe("inner");
  });
});
