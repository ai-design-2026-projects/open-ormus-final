# Parallel Dataset Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sequential run loop in `runner/index.ts` with `Promise.all` so all dataset conversations generate in parallel, reducing wall time from sum-of-runs to max-of-runs.

**Architecture:** Extract the per-run retry logic into an `executeRun` helper, then fan out all runs via `Promise.all`. Failure in any run rejects the whole promise and triggers `rmSync` cleanup — identical fail-fast semantics to today. No other files change.

**Tech Stack:** Bun, TypeScript, `bun:test`

---

### Task 1: Rewrite `runner/index.ts` with `executeRun` and `Promise.all`

**Files:**
- Modify: `evaluation/runner/index.ts`

- [ ] **Step 1: Replace the full contents of `evaluation/runner/index.ts`**

```typescript
import { join } from "node:path";
import { rmSync } from "node:fs";
import { loadConfig } from "./config";
import type { ValidatedRun } from "./config";
import { runConversation } from "./conversation";
import { initOutputDir, writeConversation } from "./writer";
import { buildAliasMap } from "../judge/alias";

const MAX_ATTEMPTS = 3;

async function executeRun(
  run: ValidatedRun,
  total: number,
  convsDir: string,
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  const label = `[${run.index}/${total}] ${run.scenario.id} · ${run.characters.map((c) => c.id).join(" + ")}`;
  const aliasMap = buildAliasMap(run.characters.map((c) => c.name));

  console.log(`${label} — started`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await runConversation(run, baseUrl, apiKey, aliasMap);
      writeConversation(convsDir, run.index, result);
      console.log(`${label} ✓`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`${label} ✗ attempt ${attempt}/${MAX_ATTEMPTS} (${msg}) — retrying`);
      } else {
        throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${msg}`);
      }
    }
  }
}

export async function runEvaluation(configPath: string): Promise<void> {
  const config = loadConfig(configPath);
  const apiKey = process.env["LLM_API_KEY"]!;
  const resultsBase = join(process.cwd(), "evaluation", "results");
  const runDir = initOutputDir(resultsBase, config.outputDir, config.rawConfigText);

  try {
    const convsDir = join(runDir, "conversations");
    const total = config.runs.length;

    await Promise.all(
      config.runs.map((run) => executeRun(run, total, convsDir, config.baseUrl, apiKey)),
    );

    console.log(`\nCompleted.`);
  } catch (err) {
    rmSync(runDir, { recursive: true, force: true });
    console.error(`\nDataset generation failed — removed incomplete directory: ${runDir}`);
    throw err;
  }
}
```

- [ ] **Step 2: Run type check**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run existing tests**

```bash
bun test evaluation/runner
```

Expected: all tests pass. The config, conversation, and writer tests are unaffected by this change.

- [ ] **Step 4: Commit**

```bash
git add evaluation/runner/index.ts
git commit -m "feat(evaluation): parallelize dataset generation runs with Promise.all"
```

---

### Task 2: Add `concurrency` absence note to config test

**Files:**
- Modify: `evaluation/runner/__tests__/config.test.ts`

- [ ] **Step 1: Add a test asserting `concurrency` is not a valid config field**

Append this test inside the existing `describe("loadConfig", ...)` block in `evaluation/runner/__tests__/config.test.ts`:

```typescript
it("does not accept a concurrency field — parallelism is unconditional", () => {
  writeFileSync(
    configPath,
    `
output_dir: "${freshDir()}"
base_url: "http://localhost:4000"
default_model: "claude-haiku-4-5"
concurrency: 4
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 2
    turn_strategy: ROUND_ROBIN
`,
  );
  // Zod strips unknown fields — concurrency is silently ignored, not an error.
  // This test documents the intent: concurrency is not a config knob.
  const config = loadConfig(configPath, tmpBase);
  expect(config).not.toHaveProperty("concurrency");
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
bun test evaluation/runner/__tests__/config.test.ts
```

Expected: all tests pass including the new one.

- [ ] **Step 3: Commit**

```bash
git add evaluation/runner/__tests__/config.test.ts
git commit -m "test(evaluation): document that concurrency is not a config field"
```
