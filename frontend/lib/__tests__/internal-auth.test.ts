import { describe, test, expect } from "bun:test";

// Must be set before module import since the function reads it at call time.
process.env["JWT_SECRET"] = "test-secret-for-internal-auth";

import { validateInternalToken } from "../internal-auth";
import { createHmac } from "crypto";

function makeInternalToken(userId: string, secret: string, expOffset = 300): string {
  function base64url(s: string) {
    return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ userId, iat: now, exp: now + expOffset, internal: true }));
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `${header}.${payload}.${sig}`;
}

describe("validateInternalToken", () => {
  test("accepts a valid token produced by mintInternalToken", () => {
    const secret = "test-secret-for-internal-auth";
    process.env["JWT_SECRET"] = secret;
    const token = makeInternalToken("user-abc", secret);
    const userId = validateInternalToken(`Bearer ${token}`);
    expect(userId).toBe("user-abc");
  });

  test("throws on missing Authorization header", () => {
    expect(() => validateInternalToken(null)).toThrow("missing_token");
  });

  test("throws on non-Bearer prefix", () => {
    expect(() => validateInternalToken("Basic abc")).toThrow("missing_token");
  });

  test("throws on tampered signature", () => {
    const secret = "test-secret-for-internal-auth";
    process.env["JWT_SECRET"] = secret;
    const token = makeInternalToken("user-abc", secret);
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsignature`;
    expect(() => validateInternalToken(`Bearer ${tampered}`)).toThrow("invalid_token");
  });

  test("throws on token with wrong number of parts", () => {
    expect(() => validateInternalToken("Bearer notavalidjwt")).toThrow("invalid_token");
  });

  test("throws when JWT_SECRET is not set", () => {
    const saved = process.env["JWT_SECRET"];
    delete process.env["JWT_SECRET"];
    try {
      expect(() => validateInternalToken("Bearer anything")).toThrow("jwt_secret_not_configured");
    } finally {
      process.env["JWT_SECRET"] = saved;
    }
  });

  test("throws on expired token", () => {
    process.env["JWT_SECRET"] = "test-secret-for-internal-auth";
    // Build a JWT with exp in the past manually using the same algorithm as generateToolToken
    const secret = "test-secret-for-internal-auth";
    const { createHmac } = require("crypto");
    function base64url(input: string): string {
      return Buffer.from(input)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    }
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const now = Math.floor(Date.now() / 1000);
    const payload = base64url(JSON.stringify({ userId: "user-abc", iat: now - 600, exp: now - 300, internal: true }));
    const sig = createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const expiredToken = `${header}.${payload}.${sig}`;
    expect(() => validateInternalToken(`Bearer ${expiredToken}`)).toThrow("token_expired");
  });
});
