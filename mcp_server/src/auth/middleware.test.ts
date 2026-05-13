import { describe, test, expect, afterEach } from "bun:test";
import { createAuthMiddleware } from "./middleware";

function mockReqRes() {
  const req: Record<string, unknown> = { headers: {} };
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, isNextCalled: () => nextCalled };
}

describe("createAuthMiddleware", () => {
  const originalEnv = process.env["MCP_AUTH_DISABLED"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["MCP_AUTH_DISABLED"];
    } else {
      process.env["MCP_AUTH_DISABLED"] = originalEnv;
    }
  });

  test("passes through with userId=00000000-0000-0000-0000-000000000000 when MCP_AUTH_DISABLED=true", () => {
    process.env["MCP_AUTH_DISABLED"] = "true";
    const middleware = createAuthMiddleware();
    const { req, res, next, isNextCalled } = mockReqRes();

    middleware(req as never, res as never, next);

    expect(isNextCalled()).toBe(true);
    expect((req as Record<string, unknown>)["userId"]).toBe("00000000-0000-0000-0000-000000000000");
  });

  test("returns 401 when auth enabled and no Authorization header", () => {
    delete process.env["MCP_AUTH_DISABLED"];
    process.env["JWT_SECRET"] = "test-secret";
    const middleware = createAuthMiddleware();
    const { req, res, next, isNextCalled } = mockReqRes();
    (req as Record<string, unknown>)["headers"] = {};

    middleware(req as never, res as never, next);

    expect(isNextCalled()).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
