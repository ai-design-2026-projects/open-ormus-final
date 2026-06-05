# Claude Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an `openormus` Claude Code plugin with full OAuth 2.0 browser login, 9 skills, 2 agents, and a PreToolUse confirmation hook.

**Architecture:** The MCP server (Express, port 3001) adds an RFC 9728 resource metadata endpoint and includes a `WWW-Authenticate` header on 401s. The Next.js frontend acts as the OAuth authorization server — it exposes RFC 8414 discovery, a PKCE authorize route, a Supabase login callback that issues a stateless auth-code JWT, and a token endpoint that mints the MCP bearer token. The plugin directory at `claude-plugin/` is a self-contained Claude Code plugin with static markdown skills and agent definitions.

**Tech Stack:** Bun, TypeScript (strict), Next.js 16 App Router, Express 5, Supabase Auth, `jsonwebtoken`, `bun:test`

---

## File Map

### New
- `claude-plugin/.claude-plugin/plugin.json`
- `claude-plugin/.mcp.json`
- `claude-plugin/settings.json`
- `claude-plugin/hooks/hooks.json`
- `claude-plugin/skills/create-character/SKILL.md`
- `claude-plugin/skills/import-from-show/SKILL.md`
- `claude-plugin/skills/start-conversation/SKILL.md`
- `claude-plugin/skills/manage-characters/SKILL.md`
- `claude-plugin/skills/research-character/SKILL.md`
- `claude-plugin/skills/evaluate-conversation/SKILL.md`
- `claude-plugin/skills/generate-dataset/SKILL.md`
- `claude-plugin/skills/improve-context/SKILL.md`
- `claude-plugin/skills/archive-character/SKILL.md`
- `claude-plugin/agents/openormus.md`
- `claude-plugin/agents/scene-director.md`
- `claude-plugin/README.md`
- `frontend/app/api/oauth/well-known/authorization-server/route.ts`
- `frontend/app/api/oauth/authorize/route.ts`
- `frontend/app/api/oauth/callback/route.ts`
- `frontend/app/api/oauth/token/route.ts`
- `frontend/lib/oauth.ts`
- `frontend/lib/oauth.test.ts`

### Modified
- `.env.example` — add `MCP_PUBLIC_URL`
- `mcp_server/src/index.ts` — add `GET /.well-known/oauth-protected-resource`
- `mcp_server/src/auth/middleware.ts` — add `WWW-Authenticate` header on 401
- `mcp_server/src/auth/middleware.test.ts` — test for `WWW-Authenticate` header
- `frontend/next.config.ts` — add rewrite for `/.well-known/oauth-authorization-server`
- `frontend/app/(auth)/login/page.tsx` — thread `next` param through form
- `frontend/app/(auth)/actions.ts` — redirect to `next` after login

---

## Task 1: Add `MCP_PUBLIC_URL` env var and MCP server resource metadata endpoint

**Files:**
- Modify: `.env.example`
- Modify: `mcp_server/src/index.ts`

- [ ] **Step 1: Add `MCP_PUBLIC_URL` to `.env.example`**

After the existing `MCP_SERVER_URL` line, add:

```
# Public-facing MCP server base URL (no trailing slash). Used in OAuth discovery.
MCP_PUBLIC_URL=http://localhost:3001
```

Also add to `.env.local` manually.

- [ ] **Step 2: Add the discovery route to `mcp_server/src/index.ts`**

Add before `app.listen(...)`:

```typescript
// OAuth resource metadata (RFC 9728) — unauthenticated
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  const mcpPublicUrl = process.env["MCP_PUBLIC_URL"] ?? `http://localhost:${PORT}`;
  const frontendUrl = process.env["FRONTEND_INTERNAL_URL"] ?? "http://localhost:3000";
  res.json({
    resource: `${mcpPublicUrl}/mcp`,
    authorization_servers: [frontendUrl],
  });
});
```

- [ ] **Step 3: Start MCP server and verify the endpoint**

```bash
curl http://localhost:3001/.well-known/oauth-protected-resource
```

Expected:
```json
{"resource":"http://localhost:3001/mcp","authorization_servers":["http://localhost:3000"]}
```

- [ ] **Step 4: Commit**

```bash
git add .env.example mcp_server/src/index.ts
git commit -m "feat(mcp): add RFC 9728 oauth-protected-resource discovery endpoint"
```

---

## Task 2: MCP auth middleware — `WWW-Authenticate` header on 401

**Files:**
- Modify: `mcp_server/src/auth/middleware.ts`
- Modify: `mcp_server/src/auth/middleware.test.ts`

- [ ] **Step 1: Write two failing tests for the `WWW-Authenticate` header**

In `mcp_server/src/auth/middleware.test.ts`, add inside `describe("createAuthMiddleware", ...)`:

```typescript
test("401 missing_token includes WWW-Authenticate header pointing to resource metadata", () => {
  delete process.env["MCP_AUTH_DISABLED"];
  process.env["JWT_SECRET"] = "test-secret";
  process.env["MCP_PUBLIC_URL"] = "http://localhost:3001";
  const middleware = createAuthMiddleware();
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: null as unknown,
    _headers: headers,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    set(key: string, val: string) { this._headers[key] = val; return this; },
  };
  const req: Record<string, unknown> = { headers: {} };
  const next = () => {};

  middleware(req as never, res as never, next);

  expect(res.statusCode).toBe(401);
  expect(res._headers["WWW-Authenticate"]).toContain("Bearer");
  expect(res._headers["WWW-Authenticate"]).toContain("oauth-protected-resource");
});

test("401 invalid_token includes WWW-Authenticate header", () => {
  delete process.env["MCP_AUTH_DISABLED"];
  process.env["JWT_SECRET"] = "test-secret";
  process.env["MCP_PUBLIC_URL"] = "http://localhost:3001";
  const middleware = createAuthMiddleware();
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: null as unknown,
    _headers: headers,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    set(key: string, val: string) { this._headers[key] = val; return this; },
  };
  const req: Record<string, unknown> = {
    headers: { authorization: "Bearer bad.token.here" },
  };
  const next = () => {};

  middleware(req as never, res as never, next);

  expect(res.statusCode).toBe(401);
  expect(res._headers["WWW-Authenticate"]).toContain("Bearer");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --cwd mcp_server src/auth/middleware.test.ts
```

Expected: 2 new tests FAIL with `undefined` on `res._headers["WWW-Authenticate"]`.

- [ ] **Step 3: Update `mcp_server/src/auth/middleware.ts`**

Add a helper at the top (after imports):

```typescript
function wwwAuthenticate(res: Response): void {
  const mcpPublicUrl = process.env["MCP_PUBLIC_URL"] ?? "http://localhost:3001";
  res.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${mcpPublicUrl}/.well-known/oauth-protected-resource"`
  );
}
```

Replace both `res.status(401).json(...)` calls:

First (missing token):
```typescript
// Before:
res.status(401).json({ error: "missing_token" });
return;
// After:
wwwAuthenticate(res);
res.status(401).json({ error: "missing_token" });
return;
```

Second (invalid token, inside catch):
```typescript
// Before:
res.status(401).json({ error: "invalid_token" });
// After:
wwwAuthenticate(res);
res.status(401).json({ error: "invalid_token" });
```

Also update the existing `mockReqRes` helper in `middleware.test.ts` to include the `set` method (so older tests don't break):

```typescript
function mockReqRes() {
  const req: Record<string, unknown> = { headers: {} };
  const res = {
    statusCode: 200,
    body: null as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    set(key: string, val: string) { this._headers[key] = val; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, isNextCalled: () => nextCalled };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --cwd mcp_server src/auth/middleware.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add mcp_server/src/auth/middleware.ts mcp_server/src/auth/middleware.test.ts
git commit -m "feat(mcp): add WWW-Authenticate header to 401 responses for OAuth discovery"
```

---

## Task 3: Frontend — `next.config.ts` rewrite for `/.well-known/oauth-authorization-server`

Next.js App Router does not route directories beginning with `.`, so `/.well-known/` must be served via a rewrite.

**Files:**
- Modify: `frontend/next.config.ts`

- [ ] **Step 1: Add the rewrite**

Replace the `nextConfig` object:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@open-ormus/shared"],
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/well-known/authorization-server",
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/next.config.ts
git commit -m "feat(frontend): add rewrite for OAuth authorization server discovery"
```

---

## Task 4: Frontend — RFC 8414 authorization server discovery route

**Files:**
- Create: `frontend/app/api/oauth/well-known/authorization-server/route.ts`

- [ ] **Step 1: Create the route**

```typescript
export async function GET() {
  const siteUrl = process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000";
  return Response.json({
    issuer: siteUrl,
    authorization_endpoint: `${siteUrl}/api/oauth/authorize`,
    token_endpoint: `${siteUrl}/api/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
```

- [ ] **Step 2: Start frontend and verify the rewrite**

```bash
curl http://localhost:3000/.well-known/oauth-authorization-server
```

Expected:
```json
{
  "issuer": "http://localhost:3000",
  "authorization_endpoint": "http://localhost:3000/api/oauth/authorize",
  "token_endpoint": "http://localhost:3000/api/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"]
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/oauth/well-known/authorization-server/route.ts
git commit -m "feat(frontend): add RFC 8414 OAuth authorization server discovery"
```

---

## Task 5: Frontend — `lib/oauth.ts` with PKCE helpers and auth-code JWT

**Files:**
- Create: `frontend/lib/oauth.ts`
- Create: `frontend/lib/oauth.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `frontend/lib/oauth.test.ts`:

```typescript
import { test, expect, beforeAll } from "bun:test";
import { verifyPkce, mintAuthCode, verifyAuthCode } from "./oauth";

beforeAll(() => {
  process.env["JWT_SECRET"] = "test-secret-32-chars-minimum-ok";
});

test("verifyPkce: correct verifier returns true", () => {
  // SHA256("abc123") base64url = "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
  const codeVerifier = "abc123";
  const codeChallenge = "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0";
  expect(verifyPkce(codeVerifier, codeChallenge)).toBe(true);
});

test("verifyPkce: wrong verifier returns false", () => {
  const codeChallenge = "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0";
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

test("verifyAuthCode rejects wrong type", () => {
  // Mint a regular tool token (type is absent) and try to use it as auth code
  const { generateToolToken } = await import("./agent/token");
  const toolToken = generateToolToken("user-999");
  expect(() => verifyAuthCode(toolToken)).toThrow("invalid_code");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --cwd frontend lib/oauth.test.ts
```

Expected: FAIL — `verifyPkce`, `mintAuthCode`, `verifyAuthCode` not found.

- [ ] **Step 3: Implement `frontend/lib/oauth.ts`**

```typescript
import { createHash, createHmac } from "crypto";

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = b64url(createHash("sha256").update(codeVerifier).digest());
  return computed === codeChallenge;
}

export function mintAuthCode(userId: string, codeChallenge: string): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ userId, type: "oauth_code", codeChallenge, iat: now, exp: now + 120 })
  );
  const sig = b64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}

export function verifyAuthCode(code: string): { userId: string; codeChallenge: string } {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  const parts = code.split(".");
  if (parts.length !== 3) throw new Error("invalid_code");
  const [header, payload, sig] = parts as [string, string, string];
  const expectedSig = b64url(
    createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  if (sig !== expectedSig) throw new Error("invalid_code");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
  if (data["type"] !== "oauth_code") throw new Error("invalid_code");
  const now = Math.floor(Date.now() / 1000);
  if (typeof data["exp"] === "number" && data["exp"] < now) throw new Error("code_expired");
  return {
    userId: data["userId"] as string,
    codeChallenge: data["codeChallenge"] as string,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --cwd frontend lib/oauth.test.ts
```

Expected: all 5 tests pass. (The last test uses dynamic import — if it fails due to import issues, replace with a direct JWT construction using the same signing logic.)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/oauth.ts frontend/lib/oauth.test.ts
git commit -m "feat(frontend): add PKCE verification and auth-code JWT helpers"
```

---

## Task 6: Frontend — Login page and action support for `next` redirect

The existing login action hard-redirects to `/` after success. We need it to redirect to a `next` URL when provided. This is needed so the OAuth flow can redirect to `/api/oauth/callback` after login.

**Files:**
- Modify: `frontend/app/(auth)/login/page.tsx`
- Modify: `frontend/app/(auth)/actions.ts`

- [ ] **Step 1: Update the `login` server action in `actions.ts`**

Find the `login` function. It ends with `redirect("/")`. Replace the last two lines (the `redirect` call) with:

```typescript
  const nextPath = (formData.get("next") as string | null) ?? "/";
  // Prevent open redirect — only allow relative paths
  redirect(nextPath.startsWith("/") ? nextPath : "/");
```

The full updated end of the `login` function looks like:

```typescript
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: error.message };
  }

  const nextPath = (formData.get("next") as string | null) ?? "/";
  redirect(nextPath.startsWith("/") ? nextPath : "/");
```

- [ ] **Step 2: Update `login/page.tsx` to read and pass the `next` param**

Add `useSearchParams` import and thread the param through the form:

```tsx
"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { login, type AuthActionState } from "../actions"
import Link from "next/link"

const initialState: AuthActionState = { error: null }

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  )
}

export default function LoginPage() {
  const [state, formAction] = useActionState(login, initialState)
  const searchParams = useSearchParams()
  const next = searchParams.get("next") ?? "/"

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          autoComplete="email"
          className={inputClass}
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
        {state.error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <SubmitButton />
      </form>
      <div className="flex flex-col gap-1 text-sm">
        <Link href="/register" className="text-primary hover:underline">
          Create an account
        </Link>
        <Link
          href="/forgot-password"
          className="text-muted-foreground hover:underline"
        >
          Forgot password?
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(auth)/login/page.tsx" "frontend/app/(auth)/actions.ts"
git commit -m "feat(frontend): thread next redirect param through login form"
```

---

## Task 7: Frontend — `/api/oauth/authorize` route

**Files:**
- Create: `frontend/app/api/oauth/authorize/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");

  if (!redirectUri || !state || !codeChallenge || codeChallengeMethod !== "S256") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Only allow localhost/127.0.0.1 redirect URIs — Claude Code always uses these for OAuth callbacks
  let parsedUri: URL;
  try {
    parsedUri = new URL(redirectUri);
  } catch {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  }
  if (parsedUri.hostname !== "localhost" && parsedUri.hostname !== "127.0.0.1") {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Store PKCE params in a signed cookie that survives the Supabase login redirect
  const pkcePayload = JSON.stringify({ redirectUri, state, codeChallenge });
  const sig = createHmac("sha256", secret).update(pkcePayload).digest("hex");
  const cookieValue = `${Buffer.from(pkcePayload).toString("base64url")}.${sig}`;

  const siteUrl = process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000";
  const loginUrl = `${siteUrl}/login?next=/api/oauth/callback`;

  const response = NextResponse.redirect(loginUrl);
  response.cookies.set("__oauth_pkce", cookieValue, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
```

- [ ] **Step 2: Verify it redirects correctly**

```bash
curl -v "http://localhost:3000/api/oauth/authorize?redirect_uri=http://localhost:8080/callback&state=abc&code_challenge=somebase64&code_challenge_method=S256" 2>&1 | grep -E "Location:|Set-Cookie:"
```

Expected:
```
Location: http://localhost:3000/login?next=/api/oauth/callback
Set-Cookie: __oauth_pkce=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=600
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/oauth/authorize/route.ts
git commit -m "feat(frontend): add OAuth /authorize route with PKCE cookie"
```

---

## Task 8: Frontend — `/api/oauth/callback` route

This route is called after the user logs in successfully. The login action redirects here with an active Supabase session. It reads the PKCE cookie, verifies it, and issues a stateless auth-code JWT.

**Files:**
- Create: `frontend/app/api/oauth/callback/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { mintAuthCode } from "@/lib/oauth";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const siteUrl = process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000";

  // Read and verify PKCE cookie
  const raw = req.cookies.get("__oauth_pkce")?.value;
  if (!raw) {
    return NextResponse.redirect(`${siteUrl}/login?error=oauth_session_expired`);
  }

  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx === -1) {
    return NextResponse.redirect(`${siteUrl}/login?error=invalid_state`);
  }

  const dataB64 = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const pkcePayload = Buffer.from(dataB64, "base64url").toString();

  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    return NextResponse.redirect(`${siteUrl}/login?error=server_error`);
  }

  const expectedSig = createHmac("sha256", secret).update(pkcePayload).digest("hex");
  if (sig !== expectedSig) {
    return NextResponse.redirect(`${siteUrl}/login?error=invalid_state`);
  }

  const { redirectUri, state, codeChallenge } = JSON.parse(pkcePayload) as {
    redirectUri: string;
    state: string;
    codeChallenge: string;
  };

  // Verify the user is authenticated
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${siteUrl}/login?next=/api/oauth/callback`);
  }

  // Issue auth-code JWT and redirect back to Claude Code's callback
  const authCode = mintAuthCode(user.id, codeChallenge);
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", authCode);
  callbackUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(callbackUrl.toString());
  // Clear the PKCE cookie
  response.cookies.set("__oauth_pkce", "", { maxAge: 0, path: "/" });
  return response;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/oauth/callback/route.ts
git commit -m "feat(frontend): add OAuth /callback route — issues auth-code JWT after Supabase login"
```

---

## Task 9: Frontend — `/api/oauth/token` route

**Files:**
- Create: `frontend/app/api/oauth/token/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAuthCode, verifyPkce } from "@/lib/oauth";
import { generateToolToken } from "@/lib/agent/token";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    // Try form-encoded body (RFC 6749 §4.1.3)
    const text = await req.text();
    body = Object.fromEntries(new URLSearchParams(text));
  }

  const code = body["code"] as string | undefined;
  const codeVerifier = body["code_verifier"] as string | undefined;
  const grantType = body["grant_type"] as string | undefined;

  if (grantType !== "authorization_code") {
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  }
  if (!code || !codeVerifier) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let userId: string;
  let codeChallenge: string;
  try {
    ({ userId, codeChallenge } = verifyAuthCode(code));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid_code";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!verifyPkce(codeVerifier, codeChallenge)) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = generateToolToken(userId);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 300,
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/api/oauth/token/route.ts
git commit -m "feat(frontend): add OAuth /token route — exchanges auth-code for MCP bearer token"
```

---

## Task 10: Plugin manifest, MCP config, and settings

**Files:**
- Create: `claude-plugin/.claude-plugin/plugin.json`
- Create: `claude-plugin/.mcp.json`
- Create: `claude-plugin/settings.json`

- [ ] **Step 1: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "openormus",
  "description": "Full OpenOrmus integration — create characters, simulate multi-character conversations, evaluate LLM behavioural fidelity",
  "version": "1.0.0",
  "author": {
    "name": "Davide Andreolli",
    "email": "davide@andreolli.dev"
  },
  "homepage": "https://github.com/andreolli-davide/open-ormus",
  "license": "MIT"
}
```

- [ ] **Step 2: Create `.mcp.json`**

```json
{
  "mcpServers": {
    "openormus": {
      "type": "http",
      "url": "${OPENORMUS_URL:-http://localhost:3001}/mcp"
    }
  }
}
```

- [ ] **Step 3: Create `settings.json`**

```json
{
  "agent": "openormus"
}
```

- [ ] **Step 4: Validate the manifest with Claude Code**

```bash
claude plugin validate ./claude-plugin
```

Expected: validation passes. If `claude plugin validate` is not available in your version, skip this step.

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/.claude-plugin/plugin.json claude-plugin/.mcp.json claude-plugin/settings.json
git commit -m "feat(plugin): add plugin manifest, MCP config, and default agent settings"
```

---

## Task 11: Plugin skills

Create all 9 `SKILL.md` files. Each has YAML frontmatter with `description:` and the skill body.

**Files:** `claude-plugin/skills/*/SKILL.md` (9 files)

- [ ] **Step 1: Create `skills/create-character/SKILL.md`**

```markdown
---
description: Create a new OpenOrmus character. Use when the user wants to add a character, build a character profile, or save a new character to their collection.
---

# Create Character

Guide the user to create a character and save it to OpenOrmus.

## Decision: research or manual?

Ask the user: is this an existing fictional character (from a show, book, film, game) or an original character?

- **Existing character**: call `character_research` with `{ query: "<name>, <show>" }`. Present the result to the user for confirmation, then call `character_create` with the returned data.
- **Original character**: collect all required fields one at a time. Do NOT call `character_create` until every field is populated.

## Required fields for `character_create`

ALL of these must be present:
- `name` (string)
- `shortDescription` (string, 1–2 sentences)
- `imageUrl` (string URL or null)
- `firstAppearanceDate` (ISO date or null)
- `personality.personalityTraits` (string[])
- `personality.backstory` (string)
- `personality.relationships` (object: name → description)
- `personality.speechPatterns` (string)
- `personality.values` (string[])
- `personality.fears` (string[])
- `personality.goals` (string[])
- `personality.notableQuotes` (string[])
- `personality.abilities` (string[])
- `personality.copingStyle` (string)
- `personality.knowledgeScope` (string)

All fields must be in English — translate non-English input before saving.
```

- [ ] **Step 2: Create `skills/import-from-show/SKILL.md`**

```markdown
---
description: Import all main characters from a TV show, film, book, or game franchise. Use when the user mentions a franchise name and wants to bulk-add characters.
---

# Import Characters from Show

Bulk-import all main characters from a franchise.

## Steps

1. Call `show_research` with `{ query: "<franchise name>" }` to get metadata and main character names.
2. Show the list to the user. Ask for confirmation once before proceeding.
3. For each character name:
   a. Call `character_research` with `{ query: "<name>, <show title>" }`.
   b. If successful, call `character_create` with the returned data.
   c. If it errors, note the failure and continue — do NOT stop.
4. Report the final count: N succeeded, M failed.

Run characters sequentially. Do not ask per-character confirmation.
All fields must be in English.
```

- [ ] **Step 3: Create `skills/start-conversation/SKILL.md`**

```markdown
---
description: Start a new multi-character conversation in OpenOrmus. Use when the user wants to simulate a scene, run characters in dialogue, or create a roleplay scenario.
---

# Start Conversation

Design and launch a multi-character conversation.

## Steps

1. **Characters**: resolve at least 2 character IDs using `character_list` or `character_find`.
2. **Context**: ask for a 2–5 sentence scene description (setting, reason for meeting, tone, any constraints).
3. **Strategy**:
   - `ORCHESTRATOR` — AI picks who speaks next; best for organic dialogue
   - `ROUND_ROBIN` — fixed rotation; best for structured scenes
   Ask the user or recommend ORCHESTRATOR for most scenes.
4. **Turns**: ask for turn count (1–500). Suggest 10–20 for a short scene, 50+ for longer.
5. Call `conversation_start` with `{ characterIds, context, turnStrategy, turns }`.
6. Report the returned `conversationId` and `jobId` to the user, then **STOP**.

## Anti-polling rule
After calling `conversation_start`, do NOT call `conversation_job_status`.
The UI streams live progress automatically.
Only call `conversation_job_status` if the user explicitly asks: "what's the status?" or "show me the results."
```

- [ ] **Step 4: Create `skills/manage-characters/SKILL.md`**

```markdown
---
description: List, search, update, or delete characters in the OpenOrmus collection. Use when the user wants to see their characters, find a specific one, edit a profile, or remove a character.
---

# Manage Characters

## List all characters
Call `character_list`. Present as a readable list with name and short description.

## Find by name
Call `character_find` with `{ query: "<name>" }`. If multiple results, show them and ask the user to pick one.

## Update a character
1. Resolve the ID with `character_find` or `character_list`.
2. Show the current profile.
3. Collect the changes.
4. Build the full updated object — `character_update` replaces the entire sheet.
5. Call `character_update` with the complete profile.

## Delete a character
1. Resolve the ID.
2. The hook will surface a confirmation prompt — wait for the user to confirm.
3. Call `character_delete` with `{ id: "<id>" }`.

Never guess an ID. Always resolve first.
```

- [ ] **Step 5: Create `skills/research-character/SKILL.md`**

```markdown
---
description: Research a fictional character online and preview their profile. Use when the user wants to explore a character before deciding whether to save them.
---

# Research Character

Look up a fictional character without saving.

## Steps

1. Ask for the character name and show/context if not provided.
2. Call `character_research` with `{ query: "<name>, <show>" }`.
3. Present the full profile to the user in a readable format.
4. Ask: "Would you like to save this character to your collection?"
   - Yes → call `character_create` with the returned data.
   - No → done.
```

- [ ] **Step 6: Create `skills/evaluate-conversation/SKILL.md`**

```markdown
---
description: Evaluate a completed conversation for character fidelity and quality. Use when the user wants to score or review how well characters performed.
---

# Evaluate Conversation

## Steps

1. Ask for `conversationId` or `jobId` if not provided.
2. Call `conversation_job_status` with `{ jobId: "<id>" }`.
   - If `status !== "completed"`, tell the user the conversation is not done yet and stop.
3. Present the conversation messages.
4. For each character, evaluate:
   - **Speech pattern fidelity**: does the dialogue match how this character speaks?
   - **Personality consistency**: do actions and words match their values, fears, and goals?
   - **Knowledge scope**: does the character stay within what they would know?
5. Give an overall fidelity score (0–10) per character with specific examples from the transcript.
```

- [ ] **Step 7: Create `skills/generate-dataset/SKILL.md`**

```markdown
---
description: Generate an evaluation dataset from completed OpenOrmus conversations. Use when the user wants to build a dataset for offline LLM evaluation.
---

# Generate Dataset

## Steps

1. Call `character_list` to get all characters.
2. Ask which characters to include, or confirm all.
3. For each included character, call `conversation_job_status` for their completed conversations.
4. Format as JSON Lines — one object per line:

```json
{ "conversationId": "uuid", "characterId": "uuid", "characterName": "string", "turns": [{ "speaker": "string", "text": "string" }] }
```

5. Present the dataset or write to a file if the user specifies a path.

Only include conversations where `status === "completed"`.
```

- [ ] **Step 8: Create `skills/improve-context/SKILL.md`**

```markdown
---
description: Help write a better scene context for a conversation. Use when the user wants guidance on crafting the context string before starting a conversation.
---

# Improve Scene Context

Help the user craft a rich, effective scene context.

A good context answers:
1. **Where** — setting, time of day, atmosphere
2. **Why** — what brought these characters together; tension, goal, or conflict
3. **Mood** — tone (tense, playful, melancholic, urgent)
4. **Constraints** — any rules for the scene

## Process

Ask these one at a time:
1. "Where does the scene take place, and when?"
2. "What's the reason these characters are meeting?"
3. "What emotional tone are you aiming for?"
4. "Any specific constraints or rules?"

Synthesise the answers into a 2–5 sentence context string and present it.
Ask: "Does this capture what you had in mind? I can adjust it."

Once approved, offer to use it with `/openormus:start-conversation`.
```

- [ ] **Step 9: Create `skills/archive-character/SKILL.md`**

Note: `character_delete` performs a soft-delete (archive) — there is no separate `character_archive` tool. Characters can be marked already-archived, and the tool returns `{ error: "already_archived" }` in that case.

```markdown
---
description: Archive (soft-delete) a character from the collection. Use when the user wants to remove a character without permanently deleting them.
---

# Archive Character

Soft-delete a character so they no longer appear in the active collection.

`character_delete` performs a soft-delete (archive) — characters are not permanently removed.

## Steps

1. Resolve the ID using `character_find` or `character_list`.
2. Confirm with the user: "Archive <name>? They will be hidden from your collection."
3. If confirmed, call `character_delete` with `{ id: "<id>" }`.
4. If the result is `{ error: "already_archived" }`, tell the user the character is already archived.
5. Otherwise, report success.
```

- [ ] **Step 10: Commit**

```bash
git add claude-plugin/skills/
git commit -m "feat(plugin): add 9 OpenOrmus skills"
```

---

## Task 12: Plugin agents

**Files:**
- Create: `claude-plugin/agents/openormus.md`
- Create: `claude-plugin/agents/scene-director.md`

- [ ] **Step 1: Create `agents/openormus.md`**

```markdown
---
description: Master OpenOrmus agent. Handles all character management, conversations, and evaluation tasks. Activated by default when the OpenOrmus plugin is enabled.
---

You are the OpenOrmus assistant. You help users create fictional characters, simulate multi-character conversations, and evaluate LLM behavioural fidelity.

## MCP tools available (server: openormus)

| Tool | Purpose |
|---|---|
| `character_create` | Save a new character (ALL fields required before calling) |
| `character_list` | List all characters |
| `character_find` | Search characters by name |
| `character_update` | Replace a full character profile by ID |
| `character_delete` | Soft-delete (archive) a character by ID |
| `character_db_search` | Semantic search across saved characters |
| `character_research` | Research a fictional character online |
| `show_research` | Look up a show/film/book and get main character names |
| `conversation_start` | Launch a multi-character conversation job (background) |
| `conversation_job_status` | Get status and messages for a conversation job |

## Hard rules

1. **Never call `conversation_job_status` automatically after `conversation_start`.** The job runs in the background; the UI streams live progress. Only call `conversation_job_status` when the user explicitly asks: "what's the status?", "is it done?", "show me the results", or equivalent.

2. **Never call `character_create` until ALL required fields are populated.** Required: `name`, `shortDescription`, `imageUrl` (or null), `firstAppearanceDate` (or null), and a full `personality` object with: `personalityTraits`, `backstory`, `relationships`, `speechPatterns`, `values`, `fears`, `goals`, `notableQuotes`, `abilities`, `copingStyle`, `knowledgeScope`.

3. **Always resolve character IDs** using `character_find` or `character_list` before calling `character_update`, `character_delete`, or `character_archive`. Never guess an ID.

4. **All character fields must be in English.** Translate non-English input before saving.

## Workflow guide

- **Create from scratch**: collect all fields one at a time → `character_create`
- **Create from research**: `character_research` → confirm with user → `character_create`
- **Bulk import**: `show_research` → list characters → confirm once → loop `character_research` + `character_create`
- **Start conversation**: resolve IDs → write context → pick strategy → `conversation_start` → stop
- **Evaluate**: only call `conversation_job_status` when the user asks → analyse messages against character profiles

For complex scene design, delegate to the `scene-director` subagent.
```

- [ ] **Step 2: Create `agents/scene-director.md`**

```markdown
---
description: Specialized subagent for designing multi-character conversation scenes. Use when the user wants help planning a scene before launching it, or when character dynamics and context need careful thought.
---

You are the OpenOrmus scene director. You help design multi-character conversation scenes.

## Your focus

Help the user answer:

1. **Which characters?** What combination creates interesting dynamics? Look at relationships, values, and goals for tension or harmony.

2. **What context?** Help write 2–5 sentences covering: setting, reason for meeting, emotional tone, any constraints.

3. **Which strategy?**
   - `ORCHESTRATOR`: AI picks who speaks next — best for organic, emergent dialogue
   - `ROUND_ROBIN`: fixed rotation — best for structured debates, interviews, or ensemble scenes

4. **How many turns?**
   - Quick exchange: 5–10 turns
   - Short scene: 15–25 turns
   - Full scene: 40–80 turns
   - Extended narrative: 100+ turns

## Process

1. Ask which characters are involved (if not already given).
2. Call `character_find` or `character_list` to fetch their profiles.
3. Briefly analyse the dynamics: tensions, shared goals, conflicts.
4. Ask for the scene premise.
5. Help draft the context string.
6. Recommend a strategy and turn count with reasoning.
7. Hand the finalized parameters to `conversation_start`.

## Hard rule
Never call `conversation_job_status` after the conversation starts.
```

- [ ] **Step 3: Commit**

```bash
git add claude-plugin/agents/
git commit -m "feat(plugin): add openormus master agent and scene-director subagent"
```

---

## Task 13: Plugin hooks and README

**Files:**
- Create: `claude-plugin/hooks/hooks.json`
- Create: `claude-plugin/README.md`

- [ ] **Step 1: Create `hooks/hooks.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "character_delete",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '\"⚠️  About to permanently delete character \" + .tool_input.id + \". Ask the user to confirm before proceeding.\"'"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Create `README.md`**

```markdown
# OpenOrmus Claude Code Plugin

Extends Claude Code and Claude desktop with full [OpenOrmus](https://github.com/andreolli-davide/open-ormus) integration — create characters, simulate multi-character conversations, and evaluate LLM behavioural fidelity.

## Requirements

- OpenOrmus running locally or deployed (MCP server + frontend)
- Claude Code v2.1+ (for OAuth 2.0 support)

## Installation

```bash
claude plugin install /path/to/claude-plugin
# or from the repository root:
claude --plugin-dir ./claude-plugin
```

## Configuration

Set `OPENORMUS_URL` in your shell to point to your OpenOrmus instance:

```bash
export OPENORMUS_URL=http://localhost:3001   # local dev (default)
export OPENORMUS_URL=https://mcp.myapp.com  # deployed instance
```

## Authentication

On first use, Claude Code will open your browser to sign in with your OpenOrmus account. Tokens are stored and refreshed automatically.

## Skills

| Skill | Command | What it does |
|---|---|---|
| Create character | `/openormus:create-character` | Build a character profile and save it |
| Import from show | `/openormus:import-from-show` | Bulk-import characters from a franchise |
| Start conversation | `/openormus:start-conversation` | Launch a multi-character scene |
| Manage characters | `/openormus:manage-characters` | List, update, or delete characters |
| Research character | `/openormus:research-character` | Preview a character before saving |
| Evaluate conversation | `/openormus:evaluate-conversation` | Score character fidelity in a completed conversation |
| Generate dataset | `/openormus:generate-dataset` | Build an evaluation dataset from conversations |
| Improve context | `/openormus:improve-context` | Craft a better scene context |
| Archive character | `/openormus:archive-character` | Soft-delete a character |

## Development

```bash
claude --plugin-dir ./claude-plugin
```

Reload after changes:
```
/reload-plugins
```
```

- [ ] **Step 3: Commit**

```bash
git add claude-plugin/hooks/hooks.json claude-plugin/README.md
git commit -m "feat(plugin): add PreToolUse confirmation hook and README"
```

---

## Task 14: Smoke test — end-to-end OAuth + MCP tool call

- [ ] **Step 1: Start both servers**

```bash
bun run dev:mcp &
bun run dev:frontend &
```

- [ ] **Step 2: Load the plugin and trigger OAuth**

```bash
claude --plugin-dir ./claude-plugin
```

In the session, ask:
```
List my characters.
```

Expected: Claude Code detects the MCP server requires auth, opens browser to `http://localhost:3000/api/oauth/authorize?...`. Browser redirects to `/login?next=/api/oauth/callback`. After login, redirects back to Claude Code's localhost callback. Claude Code exchanges the code for a bearer token and calls `character_list`. Returns the character list (or empty array if none exist yet).

- [ ] **Step 3: Verify `character_list` is accessible without re-auth**

Ask a second question in the same session:
```
How many characters do I have?
```

Expected: Claude uses the cached bearer token — no new browser login required.

- [ ] **Step 4: Run full test suite**

```bash
bun test --cwd mcp_server
bun test --cwd frontend
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: verify plugin smoke test passes"
```
