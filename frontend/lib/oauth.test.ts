import { test, expect } from "bun:test";
import { createHmac } from "crypto";
import { verifyPkce, mintAuthCode, verifyAuthCode } from "./oauth";

// Set up env before any tests run
process.env["JWT_SECRET"] = "test-secret-32-chars-minimum-ok";

test("verifyPkce: correct verifier returns true", () => {
  // SHA256("abc123") base64url = "bKE9UspwyIPg8LsQHkJaiehiTeUdstI5JZOvaoQRgJA"
  const codeVerifier = "abc123";
  const codeChallenge = "bKE9UspwyIPg8LsQHkJaiehiTeUdstI5JZOvaoQRgJA";
  expect(verifyPkce(codeVerifier, codeChallenge)).toBe(true);
});

test("verifyPkce: wrong verifier returns false", () => {
  const codeChallenge = "bKE9UspwyIPg8LsQHkJaiehiTeUdstI5JZOvaoQRgJA";
  expect(verifyPkce("wrong", codeChallenge)).toBe(false);
});

test("mintAuthCode + verifyAuthCode round-trip", () => {
  const code = mintAuthCode("user-123", "some-challenge");
  const result = verifyAuthCode(code);
  expect(result.userId).toBe("user-123");
  expect(result.codeChallenge).toBe("some-challenge");
});

test("verifyAuthCode rejects tampered token", () => {
  const code = mintAuthCode("user-123", "challenge");
  const parts = code.split(".");
  const tampered = `${parts[0]}.${parts[1]}.badsig`;
  expect(() => verifyAuthCode(tampered)).toThrow("invalid_code");
});

test("verifyAuthCode rejects token with wrong type field", () => {
  // Build a JWT with type != "oauth_code" using the same signing logic
  const secret = process.env["JWT_SECRET"]!;
  const now = Math.floor(Date.now() / 1000);
  function b64url(s: string) {
    return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ userId: "x", type: "tool_token", iat: now, exp: now + 300 }));
  const sig = Buffer.from(createHmac("sha256", secret).update(`${header}.${payload}`).digest())
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const wrongTypeToken = `${header}.${payload}.${sig}`;
  expect(() => verifyAuthCode(wrongTypeToken)).toThrow("invalid_code");
});
