# Evaluation Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track cost of every LLM call made during evaluation passes (Generation, Judge Guessing, Reconstruction, Drift), store results in YAML files alongside existing results, and display a hierarchical cost breakdown in a new "Costs" tab in the evaluation page.

**Architecture:** Each eval pass instantiates a `CostTracker` that accumulates one `CostRecord` per LLM call, then writes a YAML file after the pass succeeds. A post-pass `fetchPassCosts()` step queries the OpenRouter API for actual dollar costs and updates the YAML. The frontend reads the 4 cost YAMLs via a new API route and renders them in a new "Costs" tab.

**Tech Stack:** Bun/TypeScript, OpenAI SDK with `.withResponse()` for header access, `yaml` npm package (already used), Next.js App Router, shadcn/ui `Tabs`.

---

## File Map

**New files:**
- `evaluation/cost/types.ts` — `CostRole`, `CostMeta`, `CostRecord`
- `evaluation/cost/tracker.ts` — `CostTracker` class
- `evaluation/cost/fetcher.ts` — `fetchPassCosts()` function
- `evaluation/cost/__tests__/tracker.test.ts`
- `evaluation/cost/__tests__/fetcher.test.ts`
- `frontend/app/api/evaluation/[dataset]/[evalName]/costs/utils.ts` — aggregation logic
- `frontend/app/api/evaluation/[dataset]/[evalName]/costs/__tests__/utils.test.ts`
- `frontend/app/api/evaluation/[dataset]/[evalName]/costs/route.ts` — GET endpoint
- `frontend/app/evaluation/_components/costs-tab.tsx`

**Modified files:**
- `packages/shared/conversation/types.ts` — add `RawUsageMeta`, extend `TurnResult`
- `packages/shared/conversation/orchestrator.ts` — return `{ characterId, usage }`
- `packages/shared/conversation/turn.ts` — stream `include_usage`, capture usage + generation ID
- `evaluation/judge/call.ts` — return `{ output, usage }`
- `evaluation/judge/index.ts` — accept tracker, record usage
- `evaluation/judge/pass.ts` — instantiate tracker, flush + fetch after success
- `evaluation/reconstruct/call.ts` — return `{ output, usage }` for both functions
- `evaluation/reconstruct/index.ts` — accept tracker, record usage for all call sites
- `evaluation/reconstruct/pass.ts` — tracker, flush, fetch
- `evaluation/drift/call.ts` — return `{ output, usage }`
- `evaluation/drift/index.ts` — accept tracker, record usage
- `evaluation/drift/pass.ts` — tracker, flush, fetch
- `evaluation/generator/conversation.ts` — accept tracker, record character + orchestrator usage
- `evaluation/generator/index.ts` — tracker, flush, fetch
- `frontend/app/evaluation/page.tsx` — add Costs tab

---

## Task 1: Define Types

**Files:**
- Create: `evaluation/cost/types.ts`
- Modify: `packages/shared/conversation/types.ts`

- [ ] **Step 1: Create `evaluation/cost/types.ts`**

```ts
export type CostRole = "character" | "orchestrator" | "judge" | "reconstructor" | "comparator";

export type CostMeta = {
  conversationId: string;
  segmentIdx: number | null;
  role: CostRole;
  model: string;
  generationId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  latencyMs: number;
};

export type CostRecord = CostMeta & {
  costUsd: number | null;
};
```

- [ ] **Step 2: Add `RawUsageMeta` and extend `TurnResult` in `packages/shared/conversation/types.ts`**

Add after the `TurnConfig` type (before `TurnResult`):

```ts
export type RawUsageMeta = {
  generationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  latencyMs: number;
};
```

Replace the existing `TurnResult` type with:

```ts
export type TurnResult = {
  characterId: string;
  characterName: string;
  content: string;
  reasoning: string | null;
  emotion: Emotion;
  characterUsage: RawUsageMeta | null;
  orchestratorUsage: RawUsageMeta | null;
};
```

- [ ] **Step 3: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors (only `turn.ts` and `orchestrator.ts` will need updating — handle in Tasks 5–6).

- [ ] **Step 4: Commit**

```bash
git add evaluation/cost/types.ts packages/shared/conversation/types.ts
git commit -m "feat(eval-cost): add CostRecord and RawUsageMeta types"
```

---

## Task 2: CostTracker

**Files:**
- Create: `evaluation/cost/tracker.ts`
- Create: `evaluation/cost/__tests__/tracker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `evaluation/cost/__tests__/tracker.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { CostTracker } from "../tracker";
import type { CostMeta } from "../types";

const sampleMeta: CostMeta = {
  conversationId: "001",
  segmentIdx: null,
  role: "judge",
  model: "openai/gpt-4o-mini",
  generationId: "gen-abc123",
  inputTokens: 100,
  outputTokens: 50,
  reasoningTokens: null,
  cachedTokens: null,
  latencyMs: 500,
};

describe("CostTracker", () => {
  test("flush writes records as YAML with costUsd null", async () => {
    const tracker = new CostTracker();
    tracker.record(sampleMeta);

    const outputPath = join(tmpdir(), `tracker-test-${Date.now()}.yaml`);
    await tracker.flush(outputPath);

    const parsed = parseYaml(readFileSync(outputPath, "utf-8")) as { records: unknown[] };
    expect(parsed.records).toHaveLength(1);
    expect((parsed.records[0] as { costUsd: unknown }).costUsd).toBeNull();
    expect((parsed.records[0] as { model: string }).model).toBe("openai/gpt-4o-mini");
    rmSync(outputPath);
  });

  test("flush creates parent directory if missing", async () => {
    const tracker = new CostTracker();
    const dir = join(tmpdir(), `tracker-nested-${Date.now()}`);
    const outputPath = join(dir, "costs", "test.yaml");

    await tracker.flush(outputPath);

    expect(existsSync(outputPath)).toBe(true);
    rmSync(dir, { recursive: true });
  });

  test("flush with no records writes empty records array", async () => {
    const tracker = new CostTracker();
    const outputPath = join(tmpdir(), `tracker-empty-${Date.now()}.yaml`);
    await tracker.flush(outputPath);

    const parsed = parseYaml(readFileSync(outputPath, "utf-8")) as { records: unknown[] };
    expect(parsed.records).toHaveLength(0);
    rmSync(outputPath);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test evaluation/cost/__tests__/tracker.test.ts
```

Expected: error — `Cannot find module '../tracker'`

- [ ] **Step 3: Create `evaluation/cost/tracker.ts`**

```ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { CostMeta, CostRecord } from "./types";

export class CostTracker {
  private records: CostRecord[] = [];

  record(meta: CostMeta): void {
    this.records.push({ ...meta, costUsd: null });
  }

  async flush(outputPath: string): Promise<void> {
    const dir = dirname(outputPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outputPath, stringifyYaml({ records: this.records }), "utf-8");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test evaluation/cost/__tests__/tracker.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add evaluation/cost/tracker.ts evaluation/cost/__tests__/tracker.test.ts
git commit -m "feat(eval-cost): add CostTracker with YAML flush"
```

---

## Task 3: Cost Fetcher

**Files:**
- Create: `evaluation/cost/fetcher.ts`
- Create: `evaluation/cost/__tests__/fetcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `evaluation/cost/__tests__/fetcher.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import type { CostRecord } from "../types";

// Restore env after each test
const originalEnv = { ...process.env };
afterEach(() => {
  process.env["LLM_API_KEY"] = originalEnv["LLM_API_KEY"];
  process.env["LLM_BASE_URL"] = originalEnv["LLM_BASE_URL"];
});

function writeCostYaml(path: string, records: Partial<CostRecord>[]): void {
  writeFileSync(path, stringifyYaml({ records }), "utf-8");
}

describe("fetchPassCosts", () => {
  test("skips when LLM_API_KEY is not set", async () => {
    delete process.env["LLM_API_KEY"];
    process.env["LLM_BASE_URL"] = "https://openrouter.ai/api/v1";

    const { fetchPassCosts } = await import("../fetcher");
    const path = join(tmpdir(), `fetch-test-${Date.now()}.yaml`);
    writeCostYaml(path, [{ generationId: "gen-1", costUsd: null }]);

    await fetchPassCosts(path); // should not throw

    const parsed = parseYaml(readFileSync(path, "utf-8")) as { records: CostRecord[] };
    expect(parsed.records[0]!.costUsd).toBeNull(); // unchanged
    rmSync(path);
  });

  test("skips when LLM_BASE_URL is not OpenRouter", async () => {
    process.env["LLM_API_KEY"] = "test-key";
    process.env["LLM_BASE_URL"] = "http://localhost:11434";

    const { fetchPassCosts } = await import("../fetcher");
    const path = join(tmpdir(), `fetch-test-${Date.now()}.yaml`);
    writeCostYaml(path, [{ generationId: "gen-1", costUsd: null }]);

    await fetchPassCosts(path);

    const parsed = parseYaml(readFileSync(path, "utf-8")) as { records: CostRecord[] };
    expect(parsed.records[0]!.costUsd).toBeNull();
    rmSync(path);
  });

  test("updates costUsd from OpenRouter and rewrites YAML", async () => {
    process.env["LLM_API_KEY"] = "test-key";
    process.env["LLM_BASE_URL"] = "https://openrouter.ai/api/v1";

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { total_cost: 0.00042 } }),
      } as Response),
    );

    const { fetchPassCosts } = await import("../fetcher");
    const path = join(tmpdir(), `fetch-test-${Date.now()}.yaml`);
    writeCostYaml(path, [
      { generationId: "gen-1", costUsd: null, model: "openai/gpt-4o-mini", inputTokens: 100, outputTokens: 50 },
    ]);

    await fetchPassCosts(path);

    const parsed = parseYaml(readFileSync(path, "utf-8")) as { records: CostRecord[] };
    expect(parsed.records[0]!.costUsd).toBeCloseTo(0.00042);
    rmSync(path);
  });

  test("leaves costUsd null when OpenRouter returns 404 for all attempts", async () => {
    process.env["LLM_API_KEY"] = "test-key";
    process.env["LLM_BASE_URL"] = "https://openrouter.ai/api/v1";

    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 404 } as Response),
    );

    const { fetchPassCosts } = await import("../fetcher");
    const path = join(tmpdir(), `fetch-test-${Date.now()}.yaml`);
    writeCostYaml(path, [{ generationId: "gen-1", costUsd: null }]);

    await fetchPassCosts(path);

    const parsed = parseYaml(readFileSync(path, "utf-8")) as { records: CostRecord[] };
    expect(parsed.records[0]!.costUsd).toBeNull();
    rmSync(path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test evaluation/cost/__tests__/fetcher.test.ts
```

Expected: error — `Cannot find module '../fetcher'`

- [ ] **Step 3: Create `evaluation/cost/fetcher.ts`**

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { CostRecord } from "./types";

// Mirrors the retry pattern from frontend/lib/llm-usage.ts.
// OpenRouter indexes a generation asynchronously — use exponential delays.
const COST_RETRY_DELAYS_MS = [3000, 6000, 12000];

async function fetchOpenRouterCost(generationId: string, apiKey: string): Promise<number | null> {
  for (let attempt = 0; attempt <= COST_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, COST_RETRY_DELAYS_MS[attempt - 1]));
    }
    const res = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${generationId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`OpenRouter generation fetch failed: ${res.status}`);
    const body = (await res.json()) as { data?: { total_cost?: number } };
    const cost = body.data?.total_cost;
    if (cost === undefined) throw new Error("OpenRouter response missing total_cost");
    return cost;
  }
  return null;
}

export async function fetchPassCosts(yamlPath: string): Promise<void> {
  const apiKey = process.env["LLM_API_KEY"];
  if (!apiKey) {
    process.stderr.write("[fetchPassCosts] LLM_API_KEY not set — skipping cost fetch\n");
    return;
  }

  const baseUrl = process.env["LLM_BASE_URL"] ?? "";
  if (!baseUrl.includes("openrouter.ai")) {
    process.stderr.write("[fetchPassCosts] Not using OpenRouter — costUsd will remain null\n");
    return;
  }

  const parsed = parseYaml(readFileSync(yamlPath, "utf-8")) as { records: CostRecord[] };
  const records = parsed.records ?? [];
  const needsFetch = records.filter((r) => r.costUsd === null && r.generationId);

  if (needsFetch.length === 0) return;

  process.stdout.write(`[costs] Fetching costs for ${needsFetch.length} records…\n`);

  await Promise.all(
    needsFetch.map(async (record) => {
      try {
        const costUsd = await fetchOpenRouterCost(record.generationId, apiKey);
        record.costUsd = costUsd;
      } catch (err) {
        process.stderr.write(
          `[fetchPassCosts] Failed for ${record.generationId}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }),
  );

  writeFileSync(yamlPath, stringifyYaml({ records }), "utf-8");
  process.stdout.write("[costs] Done.\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test evaluation/cost/__tests__/fetcher.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add evaluation/cost/fetcher.ts evaluation/cost/__tests__/fetcher.test.ts
git commit -m "feat(eval-cost): add fetchPassCosts with OpenRouter retry"
```

---

## Task 4: Instrument Non-Streaming Judge and Drift Call Sites

**Files:**
- Modify: `evaluation/judge/call.ts`
- Modify: `evaluation/drift/call.ts`

Both files have a `callJudge` function with identical structure — non-streaming `client.chat.completions.create`. Apply the same change to each.

- [ ] **Step 1: Update `evaluation/judge/call.ts`**

Add `RawUsageMeta` import at the top:
```ts
import type { RawUsageMeta } from "../../packages/shared/conversation/types";
```

Change the function signature return type and add usage extraction. Replace the entire file with:

```ts
import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import type { JudgeOutput } from "./types";
import { judgeResponseFormat } from "./schema";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

const MAX_RETRIES = 3;

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  judgeLabel: string,
): Promise<{ output: JudgeOutput; usage: RawUsageMeta | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: response, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: false,
          response_format: judgeResponseFormat,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          extra_headers: {
            "HTTP-Referer": "https://openormus.app",
            "X-Title": "OpenOrmus",
          },
        })
        .withResponse();

      const raw = response.choices[0]?.message.content;
      if (!raw) {
        throw new Error(`${judgeLabel} returned empty content on attempt ${attempt}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`JSON parse failed. Raw response:\n${raw}`);
      }

      const output = JudgeOutputSchema.parse(parsed);
      const generationId = httpResponse.headers.get("x-generation-id") ?? response.id;
      const usage: RawUsageMeta | null = response.usage
        ? {
            generationId,
            model,
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
            cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
            latencyMs: Date.now() - startTime,
          }
        : null;

      return { output, usage };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `  [${judgeLabel}] attempt ${attempt}/${MAX_RETRIES} failed: ${msg}\n`,
      );
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[${judgeLabel}] all ${MAX_RETRIES} attempts failed. Last error: ${errMsg}`);
}
```

- [ ] **Step 2: Apply identical change to `evaluation/drift/call.ts`**

Replace the entire file with the same structure (different schema/type imports):

```ts
import OpenAI from "openai";
import { JudgeOutputSchema } from "./types";
import { judgeResponseFormat } from "./schema";
import type { JudgeOutput } from "./types";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

const MAX_RETRIES = 3;

export async function callJudge(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
): Promise<{ output: JudgeOutput; usage: RawUsageMeta | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: response, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: false,
          response_format: judgeResponseFormat,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
        })
        .withResponse();

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`);
      }

      const output = JudgeOutputSchema.parse(parsed);
      const generationId = httpResponse.headers.get("x-generation-id") ?? response.id;
      const usage: RawUsageMeta | null = response.usage
        ? {
            generationId,
            model,
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
            cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
            latencyMs: Date.now() - startTime,
          }
        : null;

      return { output, usage };
    } catch (err) {
      lastError = err;
      process.stderr.write(
        `  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  throw new Error(
    `[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
bun run typecheck
```

Expected: errors only in `judge/index.ts` and `drift/index.ts` (callers now get `{ output, usage }` instead of `JudgeOutput` — will fix in Tasks 7 and 10).

- [ ] **Step 4: Commit**

```bash
git add evaluation/judge/call.ts evaluation/drift/call.ts
git commit -m "feat(eval-cost): instrument judge/drift call sites to return usage"
```

---

## Task 5: Instrument Reconstruct Call Sites

**Files:**
- Modify: `evaluation/reconstruct/call.ts`

- [ ] **Step 1: Replace `evaluation/reconstruct/call.ts`**

```ts
import OpenAI from "openai";
import { ReconstructorOutputSchema, ComparatorOutputSchema } from "./types";
import type { ReconstructorOutput, ComparatorOutput, ProfileField } from "./types";
import { buildReconstructorResponseFormat, comparatorResponseFormat } from "./schema";
import type { RawUsageMeta } from "../../packages/shared/conversation/types";

const MAX_RETRIES = 3;

export async function callReconstructor(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  fields: ProfileField[],
  label: string,
): Promise<{ output: ReconstructorOutput; usage: RawUsageMeta | null }> {
  const responseFormat = buildReconstructorResponseFormat(fields);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: response, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: false,
          response_format: responseFormat,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
        })
        .withResponse();

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`); }

      const output = ReconstructorOutputSchema.parse(parsed);
      const generationId = httpResponse.headers.get("x-generation-id") ?? response.id;
      const usage: RawUsageMeta | null = response.usage
        ? {
            generationId,
            model,
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
            cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
            latencyMs: Date.now() - startTime,
          }
        : null;

      return { output, usage };
    } catch (err) {
      lastError = err;
      process.stderr.write(`  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  throw new Error(`[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function callComparator(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  label: string,
): Promise<{ output: ComparatorOutput; usage: RawUsageMeta | null }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const startTime = Date.now();
      const { data: response, response: httpResponse } = await client.chat.completions
        .create({
          model,
          temperature: 0,
          stream: false,
          response_format: comparatorResponseFormat,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          extra_headers: { "HTTP-Referer": "https://openormus.app", "X-Title": "OpenOrmus" },
        })
        .withResponse();

      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error(`[${label}] empty response on attempt ${attempt}`);

      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error(`[${label}] JSON parse failed. Raw:\n${raw}`); }

      const output = ComparatorOutputSchema.parse(parsed);
      const generationId = httpResponse.headers.get("x-generation-id") ?? response.id;
      const usage: RawUsageMeta | null = response.usage
        ? {
            generationId,
            model,
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
            cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
            latencyMs: Date.now() - startTime,
          }
        : null;

      return { output, usage };
    } catch (err) {
      lastError = err;
      process.stderr.write(`  [${label}] attempt ${attempt}/${MAX_RETRIES} failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  throw new Error(`[${label}] all ${MAX_RETRIES} attempts failed. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/reconstruct/call.ts
git commit -m "feat(eval-cost): instrument reconstruct call sites to return usage"
```

---

## Task 6: Instrument Orchestrator

**Files:**
- Modify: `packages/shared/conversation/orchestrator.ts`

- [ ] **Step 1: Replace `packages/shared/conversation/orchestrator.ts`**

Change return type from `Promise<string>` to `Promise<{ characterId: string; usage: RawUsageMeta | null }>` and use `.withResponse()` to capture usage:

```ts
import OpenAI from "openai";
import type { TurnConfig, RawUsageMeta } from "./types";

type OrchestratorParticipant = {
  characterId: string;
  character: { name: string; sheet: unknown };
};

type OrchestratorMessage = {
  character: { name: string };
  content: string;
};

export async function selectNextSpeakerWithOrchestrator(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
  config: TurnConfig,
): Promise<{ characterId: string; usage: RawUsageMeta | null }> {
  if (!config.model) {
    console.error("[orchestrator] model not set in TurnConfig");
    return { characterId: fallback(participants, messages), usage: null };
  }

  const charactersList = participants
    .map(
      (p) =>
        `- id: ${p.characterId} | Name: ${p.character.name}` +
        (p.character.sheet != null
          ? ` | Character sheet: ${JSON.stringify(p.character.sheet)}`
          : ""),
    )
    .join("\n");

  const historyText =
    messages.length > 0
      ? messages.map((m) => `[${m.character.name}]: ${m.content}`).join("\n")
      : "(The scene has just begun — no lines have been spoken yet.)";

  const userMessage = [
    "Characters:",
    charactersList,
    "",
    "Conversation so far:",
    historyText,
    "",
    "Which character should speak next? Reply with their characterId only.",
  ].join("\n");

  try {
    const client = new OpenAI({
      baseURL: `${config.baseURL}/v1`,
      apiKey: config.apiKey,
    });

    const startTime = Date.now();
    const { data: response, response: httpResponse } = await client.chat.completions
      .create({
        model: config.model,
        max_tokens: 64,
        messages: [
          {
            role: "system",
            content:
              "You are a conversation director for a multi-character roleplay scene. " +
              "Given the characters and conversation history below, decide which character " +
              "should speak next to make the conversation feel natural and engaging. " +
              "Reply with only the characterId of the chosen character, nothing else.",
          },
          { role: "user", content: userMessage },
        ],
      })
      .withResponse();

    const chosen = (response.choices[0]?.message.content ?? "").trim();
    const generationId = httpResponse.headers.get("x-generation-id") ?? response.id;
    const usage: RawUsageMeta | null = response.usage
      ? {
          generationId,
          model: config.model,
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? null,
          cachedTokens: response.usage.prompt_tokens_details?.cached_tokens ?? null,
          latencyMs: Date.now() - startTime,
        }
      : null;

    if (participants.some((p) => p.characterId === chosen)) {
      return { characterId: chosen, usage };
    }

    console.error(`[orchestrator] Invalid characterId returned: "${chosen}"`);
    return { characterId: fallback(participants, messages), usage };
  } catch (err) {
    console.error("[orchestrator] Error:", err);
    return { characterId: fallback(participants, messages), usage: null };
  }
}

function fallback(
  participants: OrchestratorParticipant[],
  messages: OrchestratorMessage[],
): string {
  if (participants.length === 0) throw new Error("[orchestrator] fallback called with empty participants");
  const p = participants[messages.length % participants.length];
  if (p === undefined) throw new Error("[orchestrator] fallback index out of range");
  return p.characterId;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/conversation/orchestrator.ts
git commit -m "feat(eval-cost): orchestrator returns usage alongside characterId"
```

---

## Task 7: Instrument generateTurn (Streaming)

**Files:**
- Modify: `packages/shared/conversation/turn.ts`

- [ ] **Step 1: Replace `packages/shared/conversation/turn.ts`**

Key changes:
1. Add `stream_options: { include_usage: true }` to the stream create call
2. Switch to `.withResponse()` to get the `x-generation-id` header (same as production `next.ts`)
3. Capture `streamId` from header, `streamUsage` from final chunk
4. Capture `orchestratorUsage` from the updated `selectNextSpeakerWithOrchestrator` return
5. Return `characterUsage` and `orchestratorUsage` in `TurnResult`

Replace the entire file:

```ts
import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { CharacterSearchResultSchema } from "../schema/character_search";
import { parseEmotionBlock } from "../schema/emotion";
import type { TurnParticipant, TurnMessage, TurnConfig, TurnResult, TurnEvent, TurnStrategy, RawUsageMeta } from "./types";
import type { Emotion } from "./types";
import { selectNextSpeakerWithOrchestrator } from "./orchestrator";
import { buildCharacterMessages } from "./build-messages";
import { buildCharacterPrompt } from "./prompts/index";

export class ConversationError extends Error {
  constructor(
    public readonly code: "LITELLM_ERROR" | "NOT_FOUND" | "NO_PARTICIPANTS" | "ENV_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

const REASONING_TAG = "<|reasoning|>";
const EMOTION_TAG = "<|emotion|>";

export async function* generateTurn(
  input: {
    participants: TurnParticipant[];
    messages: TurnMessage[];
    context: string;
    turnStrategy: TurnStrategy;
  },
  config: TurnConfig,
  signal?: AbortSignal,
  onEmotion?: (emotion: Emotion) => void,
): AsyncGenerator<TurnEvent, TurnResult> {
  let nextParticipant: TurnParticipant;
  let orchestratorUsage: RawUsageMeta | null = null;

  if (input.turnStrategy === "ORCHESTRATOR") {
    const result = await selectNextSpeakerWithOrchestrator(
      input.participants,
      input.messages,
      config,
    );
    orchestratorUsage = result.usage;
    const found = input.participants.find((p) => p.characterId === result.characterId);
    if (!found) {
      throw new ConversationError("LITELLM_ERROR", `Orchestrator returned unknown characterId "${result.characterId}"`);
    }
    nextParticipant = found;
  } else {
    nextParticipant =
      input.participants[input.messages.length % input.participants.length]!;
  }

  const sheet = CharacterSearchResultSchema.parse(nextParticipant.character.sheet);

  const otherNames = input.participants
    .filter((p) => p.characterId !== nextParticipant.characterId)
    .map((p) => p.character.name);

  const systemPrompt = buildCharacterPrompt(sheet, input.context, otherNames);

  const client = new OpenAI({
    baseURL: `${config.baseURL}/v1`,
    apiKey: config.apiKey,
  });

  const contentMessages = buildCharacterMessages(
    input.messages,
    nextParticipant.characterId,
    nextParticipant.character.name,
  );

  let content = "";
  let reasoningText = "";
  let parsedEmotion: Emotion | null = null;
  let streamGenerationId = "";
  let streamUsage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } | null = null;
  const llmStartTime = Date.now();

  yield { type: "thinking" };

  try {
    const { data: stream, response: httpResponse } = await client.chat.completions.create(
      {
        model: config.model,
        max_tokens: 768,
        stream: true,
        stream_options: { include_usage: true },
        temperature: config.temperature,
        messages: [
          { role: "system" as const, content: systemPrompt },
          ...contentMessages,
        ],
        extra_headers: {
          "HTTP-Referer": "https://openormus.app",
          "X-Title": "OpenOrmus",
        },
        extra_body: { reasoning: { effort: "none" } },
      } as ChatCompletionCreateParamsStreaming,
      { signal },
    ).withResponse();

    // OpenRouter returns the authoritative generation ID in the x-generation-id header.
    const headerGenerationId = httpResponse.headers.get("x-generation-id");
    if (headerGenerationId) streamGenerationId = headerGenerationId;

    let rawBuffer = "";
    let parserState:
      | "pre_reasoning"
      | "in_reasoning"
      | "pre_emotion"
      | "in_emotion"
      | "dialogue" = "pre_reasoning";

    for await (const chunk of stream) {
      if (!streamGenerationId && chunk.id) streamGenerationId = chunk.id;
      if (chunk.usage) streamUsage = chunk.usage;

      const token = chunk.choices[0]?.delta.content;
      if (!token) continue;

      if (parserState === "dialogue") {
        content += token;
        yield { type: "token", text: token };
        continue;
      }

      rawBuffer += token;

      if (parserState === "pre_reasoning") {
        const idx = rawBuffer.indexOf(REASONING_TAG);
        if (idx !== -1) {
          rawBuffer = rawBuffer.slice(idx + REASONING_TAG.length);
          parserState = "in_reasoning";
        } else if (rawBuffer.length > 300) {
          const emoIdx = rawBuffer.indexOf(EMOTION_TAG);
          if (emoIdx !== -1) {
            rawBuffer = rawBuffer.slice(emoIdx + EMOTION_TAG.length);
            parserState = "in_emotion";
          }
        }
      }

      if (parserState === "in_reasoning") {
        const idx = rawBuffer.indexOf(REASONING_TAG);
        if (idx !== -1) {
          reasoningText = rawBuffer.slice(0, idx).trim();
          rawBuffer = rawBuffer.slice(idx + REASONING_TAG.length);
          parserState = "pre_emotion";
        }
      }

      if (parserState === "pre_emotion") {
        const idx = rawBuffer.indexOf(EMOTION_TAG);
        if (idx !== -1) {
          rawBuffer = rawBuffer.slice(idx + EMOTION_TAG.length);
          parserState = "in_emotion";
        }
      }

      if (parserState === "in_emotion") {
        const idx = rawBuffer.indexOf(EMOTION_TAG);
        if (idx !== -1) {
          const emotionJson = rawBuffer.slice(0, idx);
          const rest = rawBuffer.slice(idx + EMOTION_TAG.length);
          rawBuffer = "";
          parsedEmotion = parseEmotionBlock(`${EMOTION_TAG}${emotionJson}${EMOTION_TAG}`);
          if (parsedEmotion === null) {
            throw new ConversationError("LITELLM_ERROR", `Failed to parse emotion block: ${emotionJson}`);
          }
          onEmotion?.(parsedEmotion);
          parserState = "dialogue";
          yield { type: "thinking_done" };
          if (rest) {
            content += rest;
            yield { type: "token", text: rest };
          }
        }
      }
    }

    if (parserState !== "dialogue" && rawBuffer) {
      content += rawBuffer;
    }

    if (parsedEmotion === null) {
      throw new ConversationError("LITELLM_ERROR", "No emotion block found in LLM response");
    }
  } catch (err) {
    if (err instanceof ConversationError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConversationError("LITELLM_ERROR", `Content stream error: ${msg}`);
  }

  if (!content) {
    throw new ConversationError("LITELLM_ERROR", "Empty content from LLM");
  }

  const characterUsage: RawUsageMeta | null = streamUsage
    ? {
        generationId: streamGenerationId,
        model: config.model,
        inputTokens: streamUsage.prompt_tokens ?? 0,
        outputTokens: streamUsage.completion_tokens ?? 0,
        reasoningTokens: streamUsage.completion_tokens_details?.reasoning_tokens ?? null,
        cachedTokens: streamUsage.prompt_tokens_details?.cached_tokens ?? null,
        latencyMs: Date.now() - llmStartTime,
      }
    : null;

  return {
    characterId: nextParticipant.characterId,
    characterName: nextParticipant.character.name,
    content,
    reasoning: reasoningText || null,
    emotion: parsedEmotion,
    characterUsage,
    orchestratorUsage,
  };
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: errors only in callers that use the old `generateTurn` return type (will fix in Tasks 9 and 11).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/conversation/turn.ts
git commit -m "feat(eval-cost): generateTurn captures streaming usage and generation ID"
```

---

## Task 8: Wire Judge Pass

**Files:**
- Modify: `evaluation/judge/index.ts`
- Modify: `evaluation/judge/pass.ts`

- [ ] **Step 1: Update `evaluation/judge/index.ts`**

Add `CostTracker` import and `tracker`/`conversationId` parameters. For each judge call, extract usage and record it.

Replace the entire file:

```ts
import OpenAI from "openai";
import { callJudge } from "./call";
import { buildJudgeSystemPrompt, buildJudgeUserMessage } from "./prompt";
import type { AliasMap } from "./alias";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { JudgeResult, JudgeAssignmentResult, GuessingScenarioResult } from "./types";
import type { JudgeConfig } from "./config";
import type { CostTracker } from "../cost/tracker";

export async function runJudges(
  result: ConversationResult,
  aliasMap: AliasMap,
  characters: CharacterRecord[],
  scenario: ScenarioRecord,
  judges: JudgeConfig[],
  baseUrl: string,
  apiKey: string,
  tracker: CostTracker,
  conversationId: string,
): Promise<GuessingScenarioResult> {
  if (judges.length === 0) {
    return {
      scenario_id: result.scenario_id,
      scenario_title: result.scenario_title,
      judges: [],
    };
  }

  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey });

  const systemPrompt = buildJudgeSystemPrompt();
  const userMessage = buildJudgeUserMessage(aliasMap, characters, scenario, result.messages);

  const judgeResults: JudgeResult[] = [];

  for (const judgeConfig of judges) {
    process.stdout.write(`  [${judgeConfig.label}] ${judgeConfig.model}… `);

    const { output, usage } = await callJudge(client, judgeConfig.model, systemPrompt, userMessage, judgeConfig.label);

    if (usage) {
      tracker.record({
        conversationId,
        segmentIdx: null,
        role: "judge",
        ...usage,
      });
    }

    const assignments: JudgeAssignmentResult[] = output.assignments.map((a) => {
      const real_name_actual = aliasMap[a.alias] ?? "(unknown alias)";
      return {
        alias: a.alias,
        real_name_guessed: a.real_name,
        real_name_actual,
        correct: a.real_name === real_name_actual,
        reasons: a.reasons,
      };
    });

    const all_correct = assignments.every((a) => a.correct);
    judgeResults.push({ label: judgeConfig.label, model: judgeConfig.model, assignments, all_correct });

    const wrongCount = assignments.filter((a) => !a.correct).length;
    console.log(all_correct ? "✓ all correct" : `✗ ${wrongCount}/${assignments.length} wrong`);
  }

  return {
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    judges: judgeResults,
  };
}
```

- [ ] **Step 2: Update `evaluation/judge/pass.ts`**

Add tracker instantiation, pass it to `runJudges`, flush and fetch costs after writing results.

Replace the entire file:

```ts
import { readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadJudgeConfig } from "./config";
import { reconstructAliasMap } from "./alias";
import { runJudges } from "./index";
import { initJudgeOutputDir, writeGuessingResult } from "./writer";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { GuessingScenarioResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runJudgingPass(configPath: string, evalName: string): Promise<void> {
  const config = loadJudgeConfig(configPath, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const judgeRunDir = initJudgeOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const conversationsDir = join(config.evalDir, "conversations");
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const total = files.length;

    const entries = files.map((file, i) => ({
      file,
      result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
      i,
    }));

    const guessingResults: GuessingScenarioResult[] = await Promise.all(
      entries.map(async ({ file, result, i }) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found in dataset (from ${file})`);

        const convCharIds = result.characters.map((c) => c.id);
        const characters = convCharIds.map((id) => {
          const found = ALL_CHARACTERS.find((c) => c.id === id);
          if (!found) throw new Error(`Character "${id}" not found in dataset (from ${file})`);
          return found;
        });

        const aliasMap = reconstructAliasMap(result.characters, ALL_CHARACTERS);
        const label = `[${i + 1}/${total}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;
        const conversationId = file.replace(".yaml", "");

        console.log(`${label} — started`);
        try {
          const guessingResult = await runJudges(result, aliasMap, characters, scenario, config.judges, config.baseUrl, apiKey, tracker, conversationId);
          console.log(`${label} ✓`);
          return guessingResult;
        } catch (err) {
          throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeGuessingResult(judgeRunDir, guessingResults);

    const costsPath = join(config.evalDir, "costs", "judge_guessing.yaml");
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nDone. Results written to ${judgeRunDir}/guessing_result.yaml`);
  } catch (err) {
    rmSync(judgeRunDir, { recursive: true, force: true });
    try { rmdirSync(join(judgeRunDir, "..")); } catch { /* not empty — leave it */ }
    console.error(`\nJudging failed — removed incomplete directory: ${judgeRunDir}`);
    throw err;
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: judge pass compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add evaluation/judge/index.ts evaluation/judge/pass.ts
git commit -m "feat(eval-cost): wire cost tracking into judge pass"
```

---

## Task 9: Wire Reconstruct Pass

**Files:**
- Modify: `evaluation/reconstruct/index.ts`
- Modify: `evaluation/reconstruct/pass.ts`

- [ ] **Step 1: Update `evaluation/reconstruct/index.ts`**

Add `tracker: CostTracker` and `conversationId: string` parameters to `runReconstructionForConversation`. Record usage for every `callReconstructor` and `callComparator` call — including the internal-consistency comparator calls.

Replace the entire file:

```ts
import OpenAI from "openai";
import { callReconstructor, callComparator } from "./call";
import {
  buildReconstructorSystemPrompt,
  buildReconstructorUserMessage,
  buildComparatorSystemPrompt,
  buildComparatorUserMessage,
} from "./prompt";
import { buildItemScores, computeFieldScore, computeFieldDriftScore } from "./scoring";
import { reconstructAliasMap } from "../judge/alias";
import { segmentConversation } from "./segmenter";
import { PROFILE_FIELDS } from "./types";
import type {
  ProfileField,
  FieldScore,
  ReconstructedField,
  CharacterResult,
  ConversationReconstructionResult,
  ValidatedReconstructConfig,
  SegmentResult,
  FieldDriftScore,
} from "./types";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { CostTracker } from "../cost/tracker";

function getGtItems(char: CharacterRecord, field: ProfileField): string[] {
  return (char[field as keyof CharacterRecord] as string[] | undefined) ?? [];
}

export async function runReconstructionForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedReconstructConfig,
  apiKey: string,
  tracker: CostTracker,
  conversationId: string,
): Promise<ConversationReconstructionResult> {
  const strippedMessages = result.messages.map((m) => ({
    ...m,
    reasoning: "",
    subtext: "",
  }));

  if (strippedMessages.length < config.segments * 2) {
    throw new Error(
      `${fileName}: not enough messages for ${config.segments} segments ` +
        `(${strippedMessages.length} messages, need at least ${config.segments * 2})`,
    );
  }

  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });
  const aliasMap = reconstructAliasMap(result.characters, characters);
  const segments = segmentConversation(strippedMessages, config.segments);
  const reconstructorSysPrompt = buildReconstructorSystemPrompt();
  const comparatorSysPrompt = buildComparatorSystemPrompt();

  const charResults: CharacterResult[] = [];

  for (const convChar of result.characters) {
    const alias = convChar.name;
    const realName = aliasMap[alias] ?? alias;
    const charRecord = characters.find((c) => c.id === convChar.id);
    if (!charRecord) throw new Error(`Character ${convChar.id} not found in dataset`);

    console.log(`  [${alias} → ${realName}] reconstructing ${config.segments} segments…`);

    const segmentResults: SegmentResult[] = [];
    const segmentFields: Array<Partial<Record<ProfileField, ReconstructedField>>> = [];

    for (const seg of segments) {
      const userMsg = buildReconstructorUserMessage(alias, scenario, seg.messages, config.fields);

      const { output: reconstruction, usage: reconUsage } = await callReconstructor(
        client,
        config.reconstructorModel,
        reconstructorSysPrompt,
        userMsg,
        config.fields,
        `reconstructor:${alias}:seg${seg.segment_index}`,
      );

      if (reconUsage) {
        tracker.record({
          conversationId,
          segmentIdx: seg.segment_index,
          role: "reconstructor",
          ...reconUsage,
        });
      }

      const fieldScores: Partial<Record<ProfileField, FieldScore>> = {};
      const reconFields: Partial<Record<ProfileField, ReconstructedField>> = {};

      for (const field of config.fields) {
        const reconField = reconstruction.fields[field];
        reconFields[field] = reconField;

        const notObserved =
          !reconField || reconField.not_observed || reconField.items.length === 0;

        if (notObserved) {
          fieldScores[field] = computeFieldScore(true, getGtItems(charRecord, field), []);
          continue;
        }

        const gtItems = getGtItems(charRecord, field);
        const comparatorOutputs = await Promise.all(
          config.comparators.map(async (comp) => {
            const compUserMsg = buildComparatorUserMessage(field, gtItems, reconField.items);
            const { output, usage: compUsage } = await callComparator(
              client,
              comp.model,
              comparatorSysPrompt,
              compUserMsg,
              `${comp.label}:${alias}:seg${seg.segment_index}:${field}`,
            );
            if (compUsage) {
              tracker.record({
                conversationId,
                segmentIdx: seg.segment_index,
                role: "comparator",
                ...compUsage,
              });
            }
            return { model: comp.model, scores: output.item_scores };
          }),
        );

        const itemScores = buildItemScores(reconField.items, comparatorOutputs);
        fieldScores[field] = computeFieldScore(false, gtItems, itemScores);
      }

      for (const field of PROFILE_FIELDS) {
        if (!fieldScores[field]) {
          fieldScores[field] = computeFieldScore(true, [], []);
        }
      }

      segmentResults.push({
        segment_index: seg.segment_index,
        turn_range: seg.turn_range,
        message_count: seg.messages.length,
        field_scores: fieldScores as Record<ProfileField, FieldScore>,
      });

      segmentFields.push(reconFields);
    }

    const hasMultipleSegments = segmentFields.length >= 2;
    const seg0Fields = segmentFields[0] ?? {};
    const segNFields = segmentFields[segmentFields.length - 1] ?? {};

    const fieldDrift: Partial<Record<ProfileField, FieldDriftScore>> = {};

    for (const field of PROFILE_FIELDS) {
      const segmentF1s: Array<number | null> = segmentResults.map((sr) => {
        const fs = sr.field_scores[field];
        return fs && !fs.not_observed ? fs.f1 : null;
      });

      let internalConsistency: FieldScore | null = null;
      const seg0Field = seg0Fields[field];
      const segNField = segNFields[field];

      if (
        hasMultipleSegments &&
        seg0Field &&
        !seg0Field.not_observed &&
        seg0Field.items.length > 0 &&
        segNField &&
        !segNField.not_observed &&
        segNField.items.length > 0
      ) {
        process.stdout.write(`    [${field}] internal consistency seg0 vs segN…`);

        const compOutputs = await Promise.all(
          config.comparators.map(async (comp) => {
            const compUserMsg = buildComparatorUserMessage(
              field,
              seg0Field.items,
              segNField.items,
            );
            const { output, usage: compUsage } = await callComparator(
              client,
              comp.model,
              comparatorSysPrompt,
              compUserMsg,
              `${comp.label}:${alias}:internal:${field}`,
            );
            if (compUsage) {
              tracker.record({
                conversationId,
                segmentIdx: null,
                role: "comparator",
                ...compUsage,
              });
            }
            return { model: comp.model, scores: output.item_scores };
          }),
        );

        const itemScores = buildItemScores(segNField.items, compOutputs);
        internalConsistency = computeFieldScore(false, seg0Field.items, itemScores);
        process.stdout.write(" done\n");
      }

      fieldDrift[field] = computeFieldDriftScore(segmentF1s, internalConsistency);
    }

    const slopes = PROFILE_FIELDS.map(
      (f) => fieldDrift[f]?.gt_divergence_slope ?? null,
    ).filter((s): s is number => s !== null);

    const icF1s = PROFILE_FIELDS.map(
      (f) => fieldDrift[f]?.internal_consistency?.f1 ?? null,
    ).filter((f): f is number => f !== null);

    charResults.push({
      alias,
      real_name: realName,
      difficulty_tier: charRecord.difficultyTier,
      segments: segmentResults,
      field_drift: fieldDrift as Record<ProfileField, FieldDriftScore>,
      mean_gt_divergence_slope:
        slopes.length > 0 ? slopes.reduce((s, v) => s + v, 0) / slopes.length : null,
      mean_internal_consistency_f1:
        icF1s.length > 0 ? icF1s.reduce((s, v) => s + v, 0) / icF1s.length : null,
    });
  }

  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    scenario_difficulty: scenario.difficulty_level,
    scenario_stress_axes: scenario.stress_axes,
    segment_count: config.segments,
    characters: charResults,
  };
}
```

- [ ] **Step 2: Update `evaluation/reconstruct/pass.ts`**

Replace the entire file:

```ts
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadReconstructConfig } from "./config";
import { runReconstructionForConversation } from "./index";
import { initReconstructOutputDir, writeReconstructResults, writeSummary } from "./writer";
import { computeSummary } from "./scoring";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { ConversationReconstructionResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runReconstructionPass(configPath: string, evalName: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadReconstructConfig(rawConfigText, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initReconstructOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const conversationsDir = join(config.evalDir, "conversations");
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const entries = files.map((file, i) => ({
      file,
      result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
      i,
    }));

    const processable = entries.filter(({ file, result, i }) => {
      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (failed conversation)`);
        return false;
      }
      return true;
    });

    if (processable.length === 0) {
      throw new Error("No processable conversations found — all files were skipped or empty.");
    }

    const allResults: ConversationReconstructionResult[] = await Promise.all(
      processable.map(async ({ file, result, i }) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (from ${file})`);

        const characters = result.characters.map((c) => {
          const found = ALL_CHARACTERS.find((r) => r.id === c.id);
          if (!found) throw new Error(`Character "${c.id}" not found (from ${file})`);
          return found;
        });

        const label = `[${i + 1}/${files.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;
        const conversationId = file.replace(".yaml", "");

        console.log(`${label} — started`);
        try {
          const convResult = await runReconstructionForConversation(result, file, scenario, characters, config, apiKey, tracker, conversationId);
          console.log(`${label} ✓`);
          return convResult;
        } catch (err) {
          throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeReconstructResults(outputDir, allResults);
    writeSummary(outputDir, computeSummary(allResults, config.comparators.map((c) => c.model), config.segments));

    const costsPath = join(config.evalDir, "costs", "reconstruct_persona.yaml");
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nDone. Results written to ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nReconstruction failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: reconstruct pass compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add evaluation/reconstruct/index.ts evaluation/reconstruct/pass.ts
git commit -m "feat(eval-cost): wire cost tracking into reconstruct pass"
```

---

## Task 10: Wire Drift Pass

**Files:**
- Modify: `evaluation/drift/index.ts`
- Modify: `evaluation/drift/pass.ts`

- [ ] **Step 1: Update `evaluation/drift/index.ts`**

Add `tracker: CostTracker` and `conversationId: string` parameters. Extract usage from each `callJudge` in the `Promise.allSettled` results.

Replace the entire file:

```ts
import OpenAI from "openai";
import { splitIntoSegments } from "./segment";
import {
  majorityVoteEngagement,
  majorityVoteAlignment,
  computeDriftDeltas,
} from "./scoring";
import { callJudge } from "./call";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./prompt";
import type {
  SegmentScore,
  CharacterAlignmentScore,
  ConversationDriftResult,
  ValidatedDriftConfig,
  EngagementLabel,
  AlignmentLabel,
} from "./types";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { CostTracker } from "../cost/tracker";

export async function runDriftForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedDriftConfig,
  apiKey: string,
  tracker: CostTracker,
  conversationId: string,
): Promise<ConversationDriftResult> {
  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });

  const aliasToRecord = new Map<string, CharacterRecord>();
  for (const convChar of result.characters) {
    const record = characters.find((c) => c.id === convChar.id);
    if (!record) throw new Error(`Character "${convChar.id}" not found in dataset (${fileName})`);
    aliasToRecord.set(convChar.name, record);
  }

  const promptCharacters = result.characters.map((convChar) => {
    const record = aliasToRecord.get(convChar.name)!;
    return { id: convChar.id, name: record.name, archetype: record.archetype, record };
  });

  const messages = result.messages.map((m) => ({ ...m, reasoning: "", subtext: "" }));

  const realNameMessages = messages.map((m) => ({
    ...m,
    character_name:
      aliasToRecord.get(m.character_name)?.name ?? m.character_name,
  }));

  const segments = splitIntoSegments(realNameMessages, config.segments);
  const systemPrompt = buildJudgeSystemPrompt();
  const segmentScores: SegmentScore[] = [];
  let turnOffset = 0;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segMessages = segments[segIdx]!;
    const firstTurn = turnOffset + 1;
    const lastTurn = turnOffset + segMessages.length;
    turnOffset += segMessages.length;

    const priorMessages = realNameMessages.slice(0, firstTurn - 1);
    const userPrompt = buildJudgeUserPrompt(
      scenario,
      promptCharacters,
      priorMessages,
      segMessages,
      segIdx + 1,
      segments.length,
      firstTurn,
      lastTurn,
    );

    process.stdout.write(`  [seg ${segIdx + 1}/${segments.length}] judging…`);

    const judgeResults = await Promise.allSettled(
      config.judges.map((judge) =>
        callJudge(
          client,
          judge.model,
          systemPrompt,
          userPrompt,
          `${judge.label}:seg${segIdx + 1}`,
        ),
      ),
    );

    const successfulResults = judgeResults
      .filter((r): r is PromiseFulfilledResult<{ output: Awaited<ReturnType<typeof callJudge>>["output"]; usage: Awaited<ReturnType<typeof callJudge>>["usage"] }> =>
        r.status === "fulfilled",
      )
      .map((r) => r.value);

    for (const { usage } of successfulResults) {
      if (usage) {
        tracker.record({
          conversationId,
          segmentIdx: segIdx,
          role: "judge",
          ...usage,
        });
      }
    }

    const successfulOutputs = successfulResults.map((r) => r.output);
    const lowConfidence = successfulOutputs.length < 2;

    if (successfulOutputs.length === 0) {
      throw new Error(
        `All judges failed for segment ${segIdx + 1} in ${fileName}`,
      );
    }

    const engVotes = successfulOutputs.map((o) => o.scenario_engagement as EngagementLabel);
    const engResult = majorityVoteEngagement(engVotes);

    const alignmentScores: CharacterAlignmentScore[] = promptCharacters.map((char) => {
      const votes = successfulOutputs
        .map((o) => o.character_alignment.find((a) => a.character_id === char.id)?.label)
        .filter((v): v is AlignmentLabel => v !== undefined);
      const voteResult = majorityVoteAlignment(votes.length > 0 ? votes : ["neutral"]);
      return {
        character_id: char.id,
        archetype: char.archetype,
        label: voteResult.label,
        votes,
        confidence: voteResult.confidence,
        score: voteResult.score,
      };
    });

    segmentScores.push({
      index: segIdx + 1,
      turn_range: [firstTurn, lastTurn],
      scenario_engagement: {
        label: engResult.label,
        votes: engVotes,
        confidence: engResult.confidence,
        score: engResult.score,
      },
      personality_alignment: alignmentScores,
      low_confidence: lowConfidence,
    });

    process.stdout.write(` ${engResult.label} (${successfulOutputs.length}/${config.judges.length} judges)\n`);
  }

  const { scenarioDrift, charDrifts } = computeDriftDeltas(segmentScores);

  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    stress_axes: scenario.stress_axes,
    segments: segmentScores,
    drift: {
      scenario_engagement: scenarioDrift,
      personality_alignment: charDrifts,
    },
  };
}
```

- [ ] **Step 2: Update `evaluation/drift/pass.ts`**

Replace the entire file:

```ts
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadDriftConfig } from "./config";
import { runDriftForConversation } from "./index";
import { initDriftOutputDir, writeConversationResults, writeSummary } from "./writer";
import { computeScenarioSummaries } from "./scoring";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { ConversationDriftResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runDriftPass(configPath: string, evalName: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadDriftConfig(rawConfigText, evalName);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initDriftOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const conversationsDir = join(config.evalDir, "conversations");
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".yaml")).sort();

    if (files.length === 0) {
      throw new Error(`No conversation YAML files found in ${conversationsDir}`);
    }

    const entries = files.map((file, i) => ({
      file,
      result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
      i,
    }));

    const processable = entries.filter(({ file, result, i }) => {
      if (!result.messages || result.messages.length === 0) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (no messages)`);
        return false;
      }
      if (result.messages.length < config.segments) {
        console.log(`[${i + 1}/${files.length}] ${file} — skipped (${result.messages.length} turns < ${config.segments} segments)`);
        return false;
      }
      return true;
    });

    if (processable.length === 0) {
      throw new Error("No conversations were successfully processed.");
    }

    const allResults: ConversationDriftResult[] = await Promise.all(
      processable.map(async ({ file, result, i }) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (${file})`);

        const characters = result.characters.map((c) => {
          const found = ALL_CHARACTERS.find((r) => r.id === c.id);
          if (!found) throw new Error(`Character "${c.id}" not found (${file})`);
          return found;
        });

        const label = `[${i + 1}/${files.length}] ${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;
        const conversationId = file.replace(".yaml", "");

        console.log(`${label} — started`);
        try {
          const convResult = await runDriftForConversation(result, file, scenario, characters, config, apiKey, tracker, conversationId);
          console.log(`${label} ✓`);
          return convResult;
        } catch (err) {
          throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeConversationResults(outputDir, allResults);
    writeSummary(outputDir, computeScenarioSummaries(allResults));

    const costsPath = join(config.evalDir, "costs", "context_drift.yaml");
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nDone. ${allResults.length} conversations processed. Results: ${outputDir}/`);
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    console.error(`\nDrift pass failed — removed incomplete output: ${outputDir}`);
    throw err;
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: drift pass compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add evaluation/drift/index.ts evaluation/drift/pass.ts
git commit -m "feat(eval-cost): wire cost tracking into drift pass"
```

---

## Task 11: Wire Generation Pass

**Files:**
- Modify: `evaluation/generator/conversation.ts`
- Modify: `evaluation/generator/index.ts`

- [ ] **Step 1: Update `evaluation/generator/conversation.ts`**

Add `tracker: CostTracker | null` parameter to `runConversation`. After each turn completes, record `characterUsage` and `orchestratorUsage` from the `TurnResult`.

Replace the entire file:

```ts
import { generateTurn } from "../../packages/shared/conversation/turn";
import type {
  TurnParticipant,
  TurnMessage,
  TurnConfig,
  TurnResult,
} from "../../packages/shared/conversation/types";
import type { CharacterRecord, ValidatedRun } from "./config";
import type { AliasMap } from "../judge/alias";
import { realNameToAlias } from "../judge/alias";
import type { CostTracker } from "../cost/tracker";

export type ConversationMessage = {
  turn: number;
  character_id: string;
  character_name: string;
  emotion: string;
  intensity: string;
  subtext: string;
  reasoning: string | null;
  content: string;
};

export type ConversationResult = {
  run_index: number;
  scenario_id: string;
  scenario_title: string;
  scenario_context: string;
  initial_prompt: string;
  characters: Array<{ id: string; name: string; archetype: string }>;
  model: string;
  turn_strategy: string;
  turns_requested: number;
  started_at: string;
  completed_at: string;
  messages: ConversationMessage[];
};

function buildParticipant(char: CharacterRecord, alias: string): TurnParticipant {
  return {
    characterId: char.id,
    character: {
      name: alias,
      sheet: {
        name: alias,
        imageUrl: null,
        shortDescription: char.archetype,
        firstAppearanceDate: "2025-01-01",
        personality: {
          personalityTraits: char.personalityTraits,
          backstory: char.backstory,
          relationships: {},
          speechPatterns: char.speechPatterns,
          values: char.values,
          fears: char.fears,
          goals: char.goals,
          notableQuotes: char.notableQuotes,
          abilities: char.abilities,
          copingStyle: char.copingStyle,
          knowledgeScope: {},
        },
      },
    },
  };
}

export async function runConversation(
  run: ValidatedRun,
  baseUrl: string,
  apiKey: string,
  aliasMap: AliasMap,
  tracker: CostTracker | null = null,
): Promise<ConversationResult> {
  const started_at = new Date().toISOString();
  const participants: TurnParticipant[] = run.characters.map((char) =>
    buildParticipant(char, realNameToAlias(aliasMap, char.name))
  );
  const messages: TurnMessage[] = [];
  const context = `${run.scenario.context}\n\n${run.scenario.initial_prompt}`;
  const conversationId = String(run.index).padStart(3, "0");

  const config: TurnConfig = {
    model: run.model,
    baseURL: baseUrl,
    apiKey,
    temperature: 0,
  };

  const resultMessages: ConversationMessage[] = [];

  for (let i = 0; i < run.turns * run.characters.length; i++) {
    const gen = generateTurn(
      { participants, messages, context, turnStrategy: run.turn_strategy },
      config,
    );

    let turnResult: TurnResult;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        turnResult = value as TurnResult;
        break;
      }
    }

    if (tracker) {
      if (turnResult!.characterUsage) {
        tracker.record({
          conversationId,
          segmentIdx: null,
          role: "character",
          ...turnResult!.characterUsage,
        });
      }
      if (turnResult!.orchestratorUsage) {
        tracker.record({
          conversationId,
          segmentIdx: null,
          role: "orchestrator",
          ...turnResult!.orchestratorUsage,
        });
      }
    }

    const msg: TurnMessage = {
      characterId: turnResult!.characterId,
      character: { name: turnResult!.characterName },
      content: turnResult!.content,
      emotion: turnResult!.emotion.emotion,
      intensity: turnResult!.emotion.intensity,
      subtext: turnResult!.emotion.subtext ?? "",
      reasoning: turnResult!.reasoning,
    };
    messages.push(msg);

    resultMessages.push({
      turn: i + 1,
      character_id: turnResult!.characterId,
      character_name: turnResult!.characterName,
      emotion: turnResult!.emotion.emotion,
      intensity: turnResult!.emotion.intensity,
      subtext: turnResult!.emotion.subtext ?? "",
      reasoning: turnResult!.reasoning,
      content: turnResult!.content,
    });
  }

  return {
    run_index: run.index,
    scenario_id: run.scenario.id,
    scenario_title: run.scenario.title,
    scenario_context: run.scenario.context,
    initial_prompt: run.scenario.initial_prompt,
    characters: run.characters.map((c) => ({ id: c.id, name: realNameToAlias(aliasMap, c.name), archetype: c.archetype })),
    model: run.model,
    turn_strategy: run.turn_strategy,
    turns_requested: run.turns,
    started_at,
    completed_at: new Date().toISOString(),
    messages: resultMessages,
  };
}
```

- [ ] **Step 2: Update `evaluation/generator/index.ts`**

Add tracker instantiation and pass it to `runConversation`. After all runs complete, flush and fetch costs.

Replace the entire file:

```ts
import { join } from "node:path";
import { rmSync } from "node:fs";
import { loadConfig } from "./config";
import type { ValidatedRun } from "./config";
import { runConversation } from "./conversation";
import { initOutputDir, writeConversation } from "./writer";
import { buildAliasMap } from "../judge/alias";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";

const MAX_ATTEMPTS = 3;

async function executeRun(
  run: ValidatedRun,
  total: number,
  convsDir: string,
  baseUrl: string,
  apiKey: string,
  tracker: CostTracker,
): Promise<void> {
  const label = `[${run.index}/${total}] ${run.scenario.id} · ${run.characters.map((c) => c.id).join(" + ")} · ${run.turns} turns`;
  const aliasMap = buildAliasMap(run.characters.map((c) => c.name));
  console.log(`${label} — started`);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await runConversation(run, baseUrl, apiKey, aliasMap, tracker);
      writeConversation(convsDir, run.index, result);
      console.log(`${label} ✓`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`${label} ✗ attempt ${attempt}/${MAX_ATTEMPTS} (${msg}) — retrying`);
      } else {
        throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${msg}`, { cause: err });
      }
    }
  }
}

export async function generateDataset(configPath: string): Promise<void> {
  const resultsBase = join(process.cwd(), "evaluation", "results");
  const config = loadConfig(configPath, resultsBase);
  const apiKey = process.env["LLM_API_KEY"]!;

  console.log(`Starting eval run: ${config.datasetDir}/${config.evalName}`);
  const evalDir = initOutputDir(resultsBase, config);
  const tracker = new CostTracker();

  try {
    const convsDir = join(evalDir, "conversations");
    const total = config.runs.length;
    await Promise.all(
      config.runs.map((run) => executeRun(run, total, convsDir, config.baseUrl, apiKey, tracker)),
    );

    const costsPath = join(evalDir, "costs", "generation.yaml");
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      process.stderr.write(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    console.log(`\nCompleted. Results: ${evalDir}`);
  } catch (err) {
    rmSync(evalDir, { recursive: true, force: true });
    console.error(`\nDataset generation failed — removed incomplete directory: ${evalDir}`);
    throw err;
  }
}

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: clean — all pass files should now compile.

- [ ] **Step 4: Commit**

```bash
git add evaluation/generator/conversation.ts evaluation/generator/index.ts
git commit -m "feat(eval-cost): wire cost tracking into generation pass"
```

---

## Task 12: Frontend Aggregation Utils + API Route

**Files:**
- Create: `frontend/app/api/evaluation/[dataset]/[evalName]/costs/utils.ts`
- Create: `frontend/app/api/evaluation/[dataset]/[evalName]/costs/__tests__/utils.test.ts`
- Create: `frontend/app/api/evaluation/[dataset]/[evalName]/costs/route.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/app/api/evaluation/[dataset]/[evalName]/costs/__tests__/utils.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { aggregateCostRecords } from "../utils";
import type { CostRecord } from "../utils";

const record = (overrides: Partial<CostRecord>): CostRecord => ({
  conversationId: "001",
  segmentIdx: null,
  role: "judge",
  model: "openai/gpt-4o-mini",
  generationId: "gen-abc",
  inputTokens: 100,
  outputTokens: 50,
  reasoningTokens: null,
  cachedTokens: null,
  costUsd: 0.001,
  latencyMs: 500,
  ...overrides,
});

describe("aggregateCostRecords", () => {
  test("sums inputTokens and outputTokens across records", () => {
    const records = [
      record({ inputTokens: 100, outputTokens: 50, costUsd: 0.001 }),
      record({ inputTokens: 200, outputTokens: 80, costUsd: 0.002 }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.totalInputTokens).toBe(300);
    expect(result.totalOutputTokens).toBe(130);
    expect(result.totalCostUsd).toBeCloseTo(0.003);
  });

  test("totalCostUsd is null when any record has null costUsd", () => {
    const records = [
      record({ costUsd: 0.001 }),
      record({ costUsd: null }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.totalCostUsd).toBeNull();
  });

  test("groups by role correctly", () => {
    const records = [
      record({ role: "reconstructor", inputTokens: 100, costUsd: 0.001 }),
      record({ role: "comparator", inputTokens: 200, costUsd: 0.002 }),
      record({ role: "reconstructor", inputTokens: 50, costUsd: 0.0005 }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.byRole["reconstructor"]?.inputTokens).toBe(150);
    expect(result.byRole["comparator"]?.inputTokens).toBe(200);
  });

  test("groups by model correctly", () => {
    const records = [
      record({ model: "openai/gpt-4o-mini", inputTokens: 100, costUsd: 0.001 }),
      record({ model: "qwen/qwen-2.5", inputTokens: 200, costUsd: 0.002 }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.byModel["openai/gpt-4o-mini"]?.inputTokens).toBe(100);
    expect(result.byModel["qwen/qwen-2.5"]?.inputTokens).toBe(200);
  });

  test("groups by conversation with segment breakdown", () => {
    const records = [
      record({ conversationId: "001", segmentIdx: 0, role: "reconstructor", inputTokens: 100, costUsd: 0.001 }),
      record({ conversationId: "001", segmentIdx: 1, role: "reconstructor", inputTokens: 50, costUsd: 0.0005 }),
      record({ conversationId: "002", segmentIdx: 0, role: "judge", inputTokens: 80, costUsd: 0.0008 }),
    ];
    const result = aggregateCostRecords(records);
    expect(result.byConversation).toHaveLength(2);
    const conv001 = result.byConversation.find((c) => c.conversationId === "001");
    expect(conv001?.total.inputTokens).toBe(150);
    expect(conv001?.segments).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test "frontend/app/api/evaluation/[dataset]/[evalName]/costs/__tests__/utils.test.ts"
```

Expected: error — `Cannot find module '../utils'`

- [ ] **Step 3: Create `frontend/app/api/evaluation/[dataset]/[evalName]/costs/utils.ts`**

```ts
// CostRecord and CostRole are defined here (not imported from evaluation/ — that would
// cross the frontend boundary). Keep in sync with evaluation/cost/types.ts.
export type CostRole = "character" | "orchestrator" | "judge" | "reconstructor" | "comparator";

export type CostRecord = {
  conversationId: string;
  segmentIdx: number | null;
  role: CostRole;
  model: string;
  generationId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
};

export type TokenStats = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type SegmentCost = {
  segmentIdx: number;
  byRole: Partial<Record<CostRole, TokenStats>>;
};

export type ConversationCost = {
  conversationId: string;
  total: TokenStats;
  segments: SegmentCost[];
};

export type PassAggregate = {
  totalCostUsd: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  byRole: Partial<Record<CostRole, TokenStats>>;
  byModel: Record<string, TokenStats>;
  byConversation: ConversationCost[];
};

function zeroStats(): TokenStats {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

function addStats(a: TokenStats, b: TokenStats): TokenStats {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd !== null && b.costUsd !== null ? a.costUsd + b.costUsd : null,
  };
}

export function aggregateCostRecords(records: CostRecord[]): PassAggregate {
  let totalCostUsd: number | null = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const byRole: Partial<Record<CostRole, TokenStats>> = {};
  const byModel: Record<string, TokenStats> = {};
  const convMap = new Map<string, { total: TokenStats; segMap: Map<number, { byRole: Partial<Record<CostRole, TokenStats>> }> }>();

  for (const r of records) {
    if (r.costUsd === null) totalCostUsd = null;
    if (totalCostUsd !== null) totalCostUsd += r.costUsd ?? 0;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;

    const rStats: TokenStats = { inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd };

    byRole[r.role] = addStats(byRole[r.role] ?? zeroStats(), rStats);
    byModel[r.model] = addStats(byModel[r.model] ?? zeroStats(), rStats);

    if (!convMap.has(r.conversationId)) {
      convMap.set(r.conversationId, { total: zeroStats(), segMap: new Map() });
    }
    const conv = convMap.get(r.conversationId)!;
    conv.total = addStats(conv.total, rStats);

    if (r.segmentIdx !== null) {
      if (!conv.segMap.has(r.segmentIdx)) {
        conv.segMap.set(r.segmentIdx, { byRole: {} });
      }
      const seg = conv.segMap.get(r.segmentIdx)!;
      seg.byRole[r.role] = addStats(seg.byRole[r.role] ?? zeroStats(), rStats);
    }
  }

  const byConversation: ConversationCost[] = Array.from(convMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([conversationId, { total, segMap }]) => ({
      conversationId,
      total,
      segments: Array.from(segMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([segmentIdx, { byRole: segByRole }]) => ({ segmentIdx, byRole: segByRole })),
    }));

  return {
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    byRole,
    byModel,
    byConversation,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test "frontend/app/api/evaluation/[dataset]/[evalName]/costs/__tests__/utils.test.ts"
```

Expected: all 5 tests pass.

- [ ] **Step 5: Create `frontend/app/api/evaluation/[dataset]/[evalName]/costs/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed, getResultsBasePath } from "@/lib/eval-access";
import { aggregateCostRecords } from "./utils";
import type { CostRecord } from "./utils";

type Params = { dataset: string; evalName: string };

const PASS_FILES: Record<string, string> = {
  generation: "costs/generation.yaml",
  judge_guessing: "costs/judge_guessing.yaml",
  reconstruct_persona: "costs/reconstruct_persona.yaml",
  context_drift: "costs/context_drift.yaml",
};

function loadPassRecords(evalDir: string, passFile: string): CostRecord[] | null {
  const filePath = join(evalDir, passFile);
  if (!existsSync(filePath)) return null;
  const parsed = parseYaml(readFileSync(filePath, "utf-8")) as { records?: CostRecord[] };
  return parsed.records ?? [];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dataset, evalName } = await params;
  const base = getResultsBasePath();
  const evalDir = join(base, dataset, evalName);

  if (!existsSync(evalDir)) {
    return NextResponse.json({ error: "Eval not found" }, { status: 404 });
  }

  const passes: Record<string, ReturnType<typeof aggregateCostRecords>> = {};
  let grandTotalCostUsd: number | null = 0;
  let grandTotalInputTokens = 0;
  let grandTotalOutputTokens = 0;

  for (const [passKey, passFile] of Object.entries(PASS_FILES)) {
    const records = loadPassRecords(evalDir, passFile);
    if (records === null) continue;
    const agg = aggregateCostRecords(records);
    passes[passKey] = agg;

    if (agg.totalCostUsd === null) grandTotalCostUsd = null;
    if (grandTotalCostUsd !== null) grandTotalCostUsd += agg.totalCostUsd ?? 0;
    grandTotalInputTokens += agg.totalInputTokens;
    grandTotalOutputTokens += agg.totalOutputTokens;
  }

  return NextResponse.json({
    passes,
    grandTotal: {
      costUsd: grandTotalCostUsd,
      inputTokens: grandTotalInputTokens,
      outputTokens: grandTotalOutputTokens,
    },
  });
}
```

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add "frontend/app/api/evaluation/[dataset]/[evalName]/costs/"
git commit -m "feat(eval-cost): add costs API route with aggregation"
```

---

## Task 13: Costs Tab

**Files:**
- Create: `frontend/app/evaluation/_components/costs-tab.tsx`
- Modify: `frontend/app/evaluation/page.tsx`

- [ ] **Step 1: Create `frontend/app/evaluation/_components/costs-tab.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { PassAggregate, TokenStats } from "../../api/evaluation/[dataset]/[evalName]/costs/utils";

type CostResponse = {
  passes: Record<string, PassAggregate>;
  grandTotal: { costUsd: number | null; inputTokens: number; outputTokens: number };
};

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtCost(usd: number | null): string {
  if (usd === null) return "—";
  if (usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(3)}`;
}

function fmtStats(s: TokenStats): string {
  return `${fmt(s.inputTokens)} in · ${fmt(s.outputTokens)} out · ${fmtCost(s.costUsd)}`;
}

function PassSection({ passKey, agg }: { passKey: string; agg: PassAggregate }) {
  const [open, setOpen] = useState(false);
  const [openConvs, setOpenConvs] = useState<Set<string>>(new Set());

  const label = passKey.replace(/_/g, " ");

  const toggleConv = (id: string) => {
    setOpenConvs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium capitalize text-[14px]">{label}</span>
        <span className="text-[13px] text-muted-foreground">
          {fmtCost(agg.totalCostUsd)} · {fmt(agg.totalInputTokens)} in · {fmt(agg.totalOutputTokens)} out
        </span>
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-4">
          {/* Role breakdown */}
          {Object.keys(agg.byRole).length > 0 && (
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wide mb-2">By role</p>
              <div className="space-y-1">
                {Object.entries(agg.byRole).map(([role, stats]) => (
                  <div key={role} className="flex justify-between text-[13px]">
                    <span className="text-muted-foreground">{role}</span>
                    <span>{fmtStats(stats!)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Model breakdown (judge_guessing) */}
          {Object.keys(agg.byModel).length > 0 && passKey === "judge_guessing" && (
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wide mb-2">By model</p>
              <div className="space-y-1">
                {Object.entries(agg.byModel).map(([model, stats]) => (
                  <div key={model} className="flex justify-between text-[13px]">
                    <span className="text-muted-foreground font-mono text-[12px]">{model}</span>
                    <span>{fmtStats(stats)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per conversation */}
          {agg.byConversation.length > 0 && (
            <div>
              <p className="text-[12px] text-muted-foreground uppercase tracking-wide mb-2">By conversation</p>
              <div className="space-y-1">
                {agg.byConversation.map((conv) => (
                  <div key={conv.conversationId}>
                    <button
                      className="w-full flex items-center justify-between text-[13px] hover:text-foreground text-muted-foreground py-0.5"
                      onClick={() => conv.segments.length > 0 && toggleConv(conv.conversationId)}
                    >
                      <span>{conv.segments.length > 0 ? (openConvs.has(conv.conversationId) ? "▼" : "▶") : " "} {conv.conversationId}</span>
                      <span>{fmtStats(conv.total)}</span>
                    </button>

                    {openConvs.has(conv.conversationId) && conv.segments.map((seg) => (
                      <div key={seg.segmentIdx} className="pl-6 py-0.5">
                        <div className="flex justify-between text-[12px] text-muted-foreground mb-0.5">
                          <span>segment {seg.segmentIdx}</span>
                        </div>
                        {Object.entries(seg.byRole).map(([role, stats]) => (
                          <div key={role} className="flex justify-between text-[12px] text-muted-foreground pl-3">
                            <span>{role}</span>
                            <span>{fmtStats(stats!)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PASS_ORDER = ["generation", "judge_guessing", "reconstruct_persona", "context_drift"];

export function CostsTab({ dataset, evalName }: { dataset: string; evalName: string }) {
  const [data, setData] = useState<CostResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/evaluation/${dataset}/${evalName}/costs`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CostResponse>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [dataset, evalName]);

  if (loading) return <p className="text-[13px] text-muted-foreground">Loading costs…</p>;
  if (error) return <p className="text-[13px] text-destructive">Failed to load costs: {error}</p>;
  if (!data) return null;

  const hasPasses = Object.keys(data.passes).length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center justify-between">
        <span className="font-medium text-[14px]">Grand Total</span>
        <span className="text-[13px]">
          {fmtCost(data.grandTotal.costUsd)} · {fmt(data.grandTotal.inputTokens)} in · {fmt(data.grandTotal.outputTokens)} out
        </span>
      </div>

      {!hasPasses ? (
        <p className="text-[13px] text-muted-foreground">No cost data yet — run a pass first.</p>
      ) : (
        <div className="space-y-2">
          {PASS_ORDER.filter((k) => data.passes[k]).map((passKey) => (
            <PassSection key={passKey} passKey={passKey} agg={data.passes[passKey]!} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Costs tab to `frontend/app/evaluation/page.tsx`**

Add the import at the top with the other tab imports:
```ts
import { CostsTab } from "./_components/costs-tab";
```

In the `TabsList`, add after `<TabsTrigger value="drift">Drift</TabsTrigger>`:
```tsx
<TabsTrigger value="costs">Costs</TabsTrigger>
```

After the existing `<TabsContent value="drift" ...>`, add:
```tsx
<TabsContent value="costs" className="p-6">
  <CostsTab dataset={selectedDataset} evalName={selectedEval ?? ""} />
</TabsContent>
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/evaluation/_components/costs-tab.tsx frontend/app/evaluation/page.tsx
git commit -m "feat(eval-cost): add Costs tab to evaluation page"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Run all tests**

```bash
bun test evaluation/cost/__tests__/tracker.test.ts evaluation/cost/__tests__/fetcher.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Build frontend**

```bash
bun run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Final commit if any cleanup needed**

If Step 3 revealed issues, fix and commit. Otherwise:

```bash
git log --oneline -10
```

Verify all commits are present in the worktree branch.
