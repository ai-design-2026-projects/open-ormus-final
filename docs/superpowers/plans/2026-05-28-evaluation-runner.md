# Evaluation Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline evaluation runner that reads a YAML config file, drives multi-character conversations using `generateTurn()` from `packages/shared`, and writes YAML conversation transcripts under `evaluation/results/<output_dir>/`.

**Architecture:** Four focused modules under `evaluation/runner/`: `config.ts` validates the config and resolves characters/scenarios from the YAML dataset; `conversation.ts` runs one conversation in-memory; `writer.ts` manages the output directory structure; `index.ts` orchestrates the pipeline with per-run error isolation. Entry point: `evaluation/run.ts`.

**Tech Stack:** Bun, TypeScript, direct relative imports into `packages/shared` (same pattern as `evaluation/smoke.ts`), `yaml` npm package for YAML parse+stringify, Zod (hoisted from `packages/shared/node_modules`), Bun native YAML imports for dataset files.

**Spec:** `docs/superpowers/specs/2026-05-28-evaluation-runner-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `evaluation/runner/config.ts` | Config schema, dataset loading, upfront validation |
| Create | `evaluation/runner/conversation.ts` | Build participants, call generateTurn N times |
| Create | `evaluation/runner/writer.ts` | Create output dir, write per-run YAML files |
| Create | `evaluation/runner/index.ts` | Orchestrate: validate → init → loop → summary |
| Create | `evaluation/runner/__tests__/config.test.ts` | Tests for config validation |
| Create | `evaluation/runner/__tests__/conversation.test.ts` | Tests for participant building + context |
| Create | `evaluation/runner/__tests__/writer.test.ts` | Tests for filesystem operations |
| Create | `evaluation/run.ts` | Entry point, argv → runEvaluation |
| Create | `evaluation/example-config.yaml` | Reference config for users |
| Modify | `package.json` (root) | Add `yaml` dependency |
| Modify | `.gitignore` (root) | Add `evaluation/results/` |

---

## Task 1: Setup — `yaml` dependency + gitignore

**Files:**
- Modify: `package.json` (root)
- Modify: `.gitignore` (root)

> ⚠️ Per AGENTS.md §10, adding a new dependency requires approval. The `yaml` package is required for parsing the user-supplied config file at runtime (Bun static imports only work for hardcoded paths) and serialising YAML output. There is no alternative that avoids a library for correct multi-line string handling. Confirm with the user before running `bun add`.

- [ ] **Step 1: Add `yaml` to root `package.json` dependencies**

In `package.json` at repo root, add to the `"dependencies"` (or `"devDependencies"`) section:

```json
"yaml": "^2.7.0"
```

- [ ] **Step 2: Install**

```bash
bun install
```

Expected: no errors, `node_modules/yaml` present at root.

- [ ] **Step 3: Add `evaluation/results/` to `.gitignore`**

At the end of `.gitignore`, add:

```
# Evaluation results (generated at runtime)
evaluation/results/
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb .gitignore
git commit -m "chore: add yaml dep, gitignore evaluation results"
```

---

## Task 2: `evaluation/runner/config.ts` — config schema + upfront validation

**Files:**
- Create: `evaluation/runner/config.ts`
- Create: `evaluation/runner/__tests__/config.test.ts`

The validator loads both YAML dataset files as static Bun imports, parses the user-provided config with the `yaml` package (runtime path), runs all validation upfront, and returns a fully resolved `ValidatedConfig`. A `resultsBasePath` parameter (default: `<cwd>/evaluation/results`) makes the function testable without touching the real results directory.

- [ ] **Step 1: Write `evaluation/runner/config.ts`**

```typescript
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---- Dataset record types (mirror characters.yaml / scenarios.yaml fields) ----

export type CharacterRecord = {
  id: string;
  name: string;
  archetype: string;
  personalityTraits: string[];
  backstory: string;
  speechPatterns: string[];
  values: string[];
  fears: string[];
  goals: string[];
  notableQuotes: string[];
  abilities: string[];
  copingStyle: string[];
  difficultyTier: string;
  similarTo: string | null;
  varyingAxis: string | null;
};

export type ScenarioRecord = {
  id: string;
  title: string;
  context: string;
  initial_prompt: string;
  difficulty_level: string;
  stress_axes: string[];
  social_context: string;
  pressure_source: string;
};

// ---- Validated output types ----

export type ValidatedRun = {
  index: number;
  scenario: ScenarioRecord;
  characters: CharacterRecord[];
  turns: number;
  model: string;
  turn_strategy: "ROUND_ROBIN" | "ORCHESTRATOR";
};

export type ValidatedConfig = {
  outputDir: string;
  baseUrl: string;
  runs: ValidatedRun[];
  rawConfigText: string; // copied verbatim into the output directory
};

// ---- Zod schema for the config file ----

const RunInputSchema = z.object({
  scenario: z.string(),
  characters: z.array(z.string()).min(2, "Each run needs at least 2 characters"),
  turns: z.number().int().min(1, "turns must be >= 1"),
  model: z.string().optional(),
  turn_strategy: z.enum(["ROUND_ROBIN", "ORCHESTRATOR"]),
});

const EvalConfigSchema = z.object({
  output_dir: z.string().min(1),
  base_url: z.string(),
  default_model: z.string().optional(),
  runs: z.array(RunInputSchema).min(1, "runs array must not be empty"),
});

// ---- Static dataset imports (Bun native YAML) ----

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

// ---- Loader ----

export function loadConfig(
  configPath: string,
  resultsBasePath: string = join(process.cwd(), "evaluation", "results"),
): ValidatedConfig {
  // 1. Read and parse config file
  const rawConfigText = readFileSync(configPath, "utf-8");
  const parsed: unknown = parseYaml(rawConfigText);
  const input = EvalConfigSchema.parse(parsed);

  // 2. ANTHROPIC_API_KEY must be set
  if (!process.env["ANTHROPIC_API_KEY"]) {
    throw new Error("ANTHROPIC_API_KEY env var is not set");
  }

  // 3. Output dir must not already exist
  const outputPath = join(resultsBasePath, input.output_dir);
  if (existsSync(outputPath)) {
    throw new Error(
      `Output directory already exists: ${outputPath}\nDelete it or choose a different output_dir.`,
    );
  }

  // 4. Validate each run
  const validatedRuns: ValidatedRun[] = input.runs.map((run, i) => {
    const idx = i + 1;
    const model = run.model ?? input.default_model;
    if (!model) {
      throw new Error(`Run ${idx}: no model specified and no default_model set in config`);
    }

    const scenario = ALL_SCENARIOS.find((s) => s.id === run.scenario);
    if (!scenario) {
      throw new Error(`Run ${idx}: scenario "${run.scenario}" not found in dataset`);
    }

    const characters = run.characters.map((charId) => {
      const char = ALL_CHARACTERS.find((c) => c.id === charId);
      if (!char) {
        throw new Error(`Run ${idx}: character "${charId}" not found in dataset`);
      }
      return char;
    });

    let turn_strategy = run.turn_strategy;
    if (run.characters.length === 2 && turn_strategy === "ORCHESTRATOR") {
      console.warn(
        `[warn] Run ${idx}: 2-character run cannot use ORCHESTRATOR — forcing ROUND_ROBIN`,
      );
      turn_strategy = "ROUND_ROBIN";
    }

    return { index: idx, scenario, characters, turns: run.turns, model, turn_strategy };
  });

  return { outputDir: input.output_dir, baseUrl: input.base_url, runs: validatedRuns, rawConfigText };
}
```

- [ ] **Step 2: Write `evaluation/runner/__tests__/config.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { loadConfig } from "../config";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpBase: string;
let configPath: string;

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "eval-config-test-"));
  configPath = join(tmpBase, "config.yaml");
  process.env["ANTHROPIC_API_KEY"] = "test-key";
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
  delete process.env["ANTHROPIC_API_KEY"];
});

// Unique output_dir that won't exist
const freshDir = () => `test-output-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("loadConfig", () => {
  it("parses a valid config and resolves characters and scenario", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
base_url: "http://localhost:4000"
default_model: "claude-haiku-4-5"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 3
    turn_strategy: ROUND_ROBIN
`,
    );
    const config = loadConfig(configPath, tmpBase);
    expect(config.runs).toHaveLength(1);
    expect(config.runs[0]!.scenario.id).toBe("scenario_001");
    expect(config.runs[0]!.characters).toHaveLength(2);
    expect(config.runs[0]!.characters[0]!.id).toBe("char_001");
    expect(config.runs[0]!.model).toBe("claude-haiku-4-5");
    expect(config.runs[0]!.turn_strategy).toBe("ROUND_ROBIN");
  });

  it("per-run model overrides default_model", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
base_url: "http://localhost:4000"
default_model: "default-model"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 2
    model: "override-model"
    turn_strategy: ROUND_ROBIN
`,
    );
    const config = loadConfig(configPath, tmpBase);
    expect(config.runs[0]!.model).toBe("override-model");
  });

  it("throws if output_dir already exists", () => {
    const existingDir = `existing-${Date.now()}`;
    mkdirSync(join(tmpBase, existingDir), { recursive: true });
    writeFileSync(
      configPath,
      `
output_dir: "${existingDir}"
base_url: "http://localhost:4000"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("already exists");
  });

  it("throws if scenario not found in dataset", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
base_url: "http://localhost:4000"
default_model: "m"
runs:
  - scenario: scenario_999_nonexistent
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("scenario_999_nonexistent");
  });

  it("throws if character not found in dataset", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
base_url: "http://localhost:4000"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_NOTEXIST]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("char_NOTEXIST");
  });

  it("throws if no model and no default_model", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
base_url: "http://localhost:4000"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("no model");
  });

  it("throws if ANTHROPIC_API_KEY not set", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
base_url: "http://localhost:4000"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ROUND_ROBIN
`,
    );
    expect(() => loadConfig(configPath, tmpBase)).toThrow("ANTHROPIC_API_KEY");
    process.env["ANTHROPIC_API_KEY"] = "test-key"; // restore
  });

  it("forces ROUND_ROBIN for 2-character run with ORCHESTRATOR (with warning)", () => {
    writeFileSync(
      configPath,
      `
output_dir: "${freshDir()}"
base_url: "http://localhost:4000"
default_model: "m"
runs:
  - scenario: scenario_001
    characters: [char_001, char_002]
    turns: 1
    turn_strategy: ORCHESTRATOR
`,
    );
    const config = loadConfig(configPath, tmpBase);
    expect(config.runs[0]!.turn_strategy).toBe("ROUND_ROBIN");
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
bun test evaluation/runner/__tests__/config.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add evaluation/runner/config.ts evaluation/runner/__tests__/config.test.ts
git commit -m "feat(eval): config loader with Zod validation"
```

---

## Task 3: `evaluation/runner/conversation.ts` — run one conversation

**Files:**
- Create: `evaluation/runner/conversation.ts`
- Create: `evaluation/runner/__tests__/conversation.test.ts`

Builds `TurnParticipant[]` from `CharacterRecord[]` (same pattern as `smoke.ts`), concatenates `scenario.context + "\n\n" + scenario.initial_prompt` as the `generateTurn` context, calls `generateTurn` for N turns, accumulates messages in memory.

- [ ] **Step 1: Write `evaluation/runner/conversation.ts`**

```typescript
import { generateTurn } from "../../packages/shared/conversation/turn";
import type {
  TurnParticipant,
  TurnMessage,
  TurnConfig,
  TurnResult,
} from "../../packages/shared/conversation/types";
import type { CharacterRecord, ScenarioRecord, ValidatedRun } from "./config";

// ---- Output types ----

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
  completed_at?: string;
  failed_at?: string;
  error?: string;
  messages: ConversationMessage[];
};

// ---- Participant builder ----

function buildParticipant(char: CharacterRecord): TurnParticipant {
  return {
    characterId: char.id,
    character: {
      name: char.name,
      sheet: {
        name: char.name,
        imageUrl: null,
        shortDescription: char.archetype,
        firstAppearanceDate: "2025-01-01",
        confidence: 3,
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

// ---- Runner ----

export async function runConversation(
  run: ValidatedRun,
  baseUrl: string,
  apiKey: string,
): Promise<ConversationResult> {
  const started_at = new Date().toISOString();
  const participants: TurnParticipant[] = run.characters.map(buildParticipant);
  const messages: TurnMessage[] = [];

  // Combine scenario context + initial_prompt — identical to how production uses context
  const context = `${run.scenario.context}\n\n${run.scenario.initial_prompt}`;

  const config: TurnConfig = {
    model: run.model,
    baseURL: baseUrl,
    apiKey,
  };

  const resultMessages: ConversationMessage[] = [];

  try {
    for (let i = 0; i < run.turns; i++) {
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

      const msg: TurnMessage = {
        characterId: turnResult.characterId,
        character: { name: turnResult.characterName },
        content: turnResult.content,
        emotion: turnResult.emotion.emotion,
        intensity: turnResult.emotion.intensity,
        subtext: turnResult.emotion.subtext ?? "",
        reasoning: turnResult.reasoning,
      };
      messages.push(msg);

      resultMessages.push({
        turn: i + 1,
        character_id: turnResult.characterId,
        character_name: turnResult.characterName,
        emotion: turnResult.emotion.emotion,
        intensity: turnResult.emotion.intensity,
        subtext: turnResult.emotion.subtext ?? "",
        reasoning: turnResult.reasoning,
        content: turnResult.content,
      });
    }

    return {
      run_index: run.index,
      scenario_id: run.scenario.id,
      scenario_title: run.scenario.title,
      scenario_context: run.scenario.context,
      initial_prompt: run.scenario.initial_prompt,
      characters: run.characters.map((c) => ({ id: c.id, name: c.name, archetype: c.archetype })),
      model: run.model,
      turn_strategy: run.turn_strategy,
      turns_requested: run.turns,
      started_at,
      completed_at: new Date().toISOString(),
      messages: resultMessages,
    };
  } catch (err) {
    return {
      run_index: run.index,
      scenario_id: run.scenario.id,
      scenario_title: run.scenario.title,
      scenario_context: run.scenario.context,
      initial_prompt: run.scenario.initial_prompt,
      characters: run.characters.map((c) => ({ id: c.id, name: c.name, archetype: c.archetype })),
      model: run.model,
      turn_strategy: run.turn_strategy,
      turns_requested: run.turns,
      started_at,
      failed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      messages: [],
    };
  }
}
```

- [ ] **Step 2: Write `evaluation/runner/__tests__/conversation.test.ts`**

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock generateTurn before importing conversation.ts
const mockGenerateTurn = mock(async function* () {
  yield { type: "thinking" as const };
  yield { type: "token" as const, text: "Hello." };
  yield { type: "thinking_done" as const };
  return {
    characterId: "char_001",
    characterName: "Tavon Rell",
    content: "Hello.",
    reasoning: "Starting the scene.",
    emotion: { emotion: "Joy", intensity: "low" as const, subtext: "Feeling cautious." },
  };
});

// Path is relative to THIS test file (evaluation/runner/__tests__/),
// which is 3 levels up from the repo root — same absolute path as the
// "../../packages/shared/conversation/turn" import in conversation.ts.
mock.module("../../../packages/shared/conversation/turn", () => ({
  generateTurn: mockGenerateTurn,
}));

import { runConversation } from "../conversation";
import type { ValidatedRun } from "../config";

const mockRun: ValidatedRun = {
  index: 1,
  scenario: {
    id: "scenario_001",
    title: "Test Scenario",
    context: "Two characters meet.",
    initial_prompt: "They look at each other.",
    difficulty_level: "baseline",
    stress_axes: [],
    social_context: "group_conflict",
    pressure_source: "external_force",
  },
  characters: [
    {
      id: "char_001",
      name: "Tavon Rell",
      archetype: "Rebel",
      personalityTraits: ["bold"],
      backstory: "A rebel.",
      speechPatterns: ["short sentences"],
      values: ["freedom"],
      fears: ["complicity"],
      goals: ["expose truth"],
      notableQuotes: ["No walls."],
      abilities: ["oratory"],
      copingStyle: ["action"],
      difficultyTier: "distinctive",
      similarTo: null,
      varyingAxis: null,
    },
    {
      id: "char_002",
      name: "Senne Vorhal",
      archetype: "Martyr",
      personalityTraits: ["quiet"],
      backstory: "A witness.",
      speechPatterns: ["measured"],
      values: ["truth"],
      fears: ["silence"],
      goals: ["bear witness"],
      notableQuotes: ["I was there."],
      abilities: ["documentation"],
      copingStyle: ["endurance"],
      difficultyTier: "distinctive",
      similarTo: null,
      varyingAxis: null,
    },
  ],
  turns: 2,
  model: "claude-haiku-4-5",
  turn_strategy: "ROUND_ROBIN",
};

describe("runConversation", () => {
  beforeEach(() => {
    mockGenerateTurn.mockClear();
  });

  it("calls generateTurn once per turn", async () => {
    await runConversation(mockRun, "http://localhost:4000", "test-key");
    expect(mockGenerateTurn.mock.calls.length).toBe(2);
  });

  it("concatenates context and initial_prompt", async () => {
    await runConversation(mockRun, "http://localhost:4000", "test-key");
    const firstCall = mockGenerateTurn.mock.calls[0];
    const input = firstCall?.[0] as { context: string };
    expect(input.context).toBe("Two characters meet.\n\nThey look at each other.");
  });

  it("returns correct metadata on success", async () => {
    const result = await runConversation(mockRun, "http://localhost:4000", "test-key");
    expect(result.run_index).toBe(1);
    expect(result.scenario_id).toBe("scenario_001");
    expect(result.turns_requested).toBe(2);
    expect(result.messages).toHaveLength(2);
    expect(result.error).toBeUndefined();
  });

  it("returns error record (no throw) when generateTurn throws", async () => {
    mockGenerateTurn.mockImplementationOnce(async function* () {
      throw new Error("LITELLM_ERROR: connection refused");
      // unreachable yield to satisfy generator type
      yield { type: "thinking" as const };
    });
    const result = await runConversation(mockRun, "http://localhost:4000", "test-key");
    expect(result.error).toContain("LITELLM_ERROR");
    expect(result.messages).toHaveLength(0);
    expect(result.failed_at).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
bun test evaluation/runner/__tests__/conversation.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add evaluation/runner/conversation.ts evaluation/runner/__tests__/conversation.test.ts
git commit -m "feat(eval): conversation runner"
```

---

## Task 4: `evaluation/runner/writer.ts` — output directory + YAML files

**Files:**
- Create: `evaluation/runner/writer.ts`
- Create: `evaluation/runner/__tests__/writer.test.ts`

`initOutputDir` creates the directory structure and copies the raw config text. `writeConversation` serialises a `ConversationResult` to YAML and writes it to `conversations/<NNN>.yaml`. Padding: `String(index).padStart(3, "0")`.

- [ ] **Step 1: Write `evaluation/runner/writer.ts`**

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { ConversationResult } from "./conversation";

export function initOutputDir(resultsBase: string, outputDir: string, rawConfigText: string): string {
  const runDir = join(resultsBase, outputDir);
  mkdirSync(join(runDir, "conversations"), { recursive: true });
  writeFileSync(join(runDir, "config.yaml"), rawConfigText, "utf-8");
  return runDir;
}

export function writeConversation(conversationsDir: string, index: number, result: ConversationResult): void {
  const filename = String(index).padStart(3, "0") + ".yaml";
  const filePath = join(conversationsDir, filename);
  writeFileSync(filePath, stringify(result), "utf-8");
}
```

- [ ] **Step 2: Write `evaluation/runner/__tests__/writer.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { initOutputDir, writeConversation } from "../writer";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";

let tmpBase: string;

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), "eval-writer-test-"));
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

const mockResult = {
  run_index: 1,
  scenario_id: "scenario_001",
  scenario_title: "Test",
  scenario_context: "Context.",
  initial_prompt: "Prompt.",
  characters: [{ id: "char_001", name: "Alice", archetype: "Rebel" }],
  model: "claude-haiku-4-5",
  turn_strategy: "ROUND_ROBIN",
  turns_requested: 2,
  started_at: "2026-05-28T10:00:00.000Z",
  completed_at: "2026-05-28T10:01:00.000Z",
  messages: [
    {
      turn: 1,
      character_id: "char_001",
      character_name: "Alice",
      emotion: "Joy",
      intensity: "low",
      subtext: "Hopeful.",
      reasoning: "Starting fresh.",
      content: "Hello there.",
    },
  ],
};

describe("initOutputDir", () => {
  it("creates run dir, conversations subdir, and copies config", () => {
    const runDir = initOutputDir(tmpBase, "my-run", "output_dir: my-run\n");
    expect(existsSync(runDir)).toBe(true);
    expect(existsSync(join(runDir, "conversations"))).toBe(true);
    expect(existsSync(join(runDir, "config.yaml"))).toBe(true);
    const configContent = readFileSync(join(runDir, "config.yaml"), "utf-8");
    expect(configContent).toBe("output_dir: my-run\n");
  });
});

describe("writeConversation", () => {
  it("writes a zero-padded YAML file parseable back to the original structure", () => {
    const runDir = initOutputDir(tmpBase, "write-test", "config: true\n");
    const convsDir = join(runDir, "conversations");
    writeConversation(convsDir, 1, mockResult);
    const filePath = join(convsDir, "001.yaml");
    expect(existsSync(filePath)).toBe(true);
    const parsed = parse(readFileSync(filePath, "utf-8")) as typeof mockResult;
    expect(parsed.run_index).toBe(1);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]!.content).toBe("Hello there.");
  });

  it("pads index to 3 digits", () => {
    const runDir = initOutputDir(tmpBase, "pad-test", "config: true\n");
    const convsDir = join(runDir, "conversations");
    writeConversation(convsDir, 7, mockResult);
    expect(existsSync(join(convsDir, "007.yaml"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
bun test evaluation/runner/__tests__/writer.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add evaluation/runner/writer.ts evaluation/runner/__tests__/writer.test.ts
git commit -m "feat(eval): output directory writer"
```

---

## Task 5: `evaluation/runner/index.ts` — orchestrator

**Files:**
- Create: `evaluation/runner/index.ts`

Reads `ANTHROPIC_API_KEY` from env, calls `loadConfig`, creates the output dir, loops over runs with per-run `try/catch`, writes each result immediately, prints progress and final summary. Exit code 1 if any run failed.

- [ ] **Step 1: Write `evaluation/runner/index.ts`**

```typescript
import { join } from "node:path";
import { loadConfig } from "./config";
import { runConversation } from "./conversation";
import { initOutputDir, writeConversation } from "./writer";

export async function runEvaluation(configPath: string): Promise<void> {
  // loadConfig validates everything upfront — throws on any error
  const config = loadConfig(configPath);

  const apiKey = process.env["ANTHROPIC_API_KEY"]!; // already validated by loadConfig
  const resultsBase = join(process.cwd(), "evaluation", "results");
  const runDir = initOutputDir(resultsBase, config.outputDir, config.rawConfigText);
  const convsDir = join(runDir, "conversations");

  const total = config.runs.length;
  let failed = 0;

  for (const run of config.runs) {
    const label = `[${run.index}/${total}] ${run.scenario.id} · ${run.characters.map((c) => c.id).join(" + ")} · ${run.turns} turns`;
    process.stdout.write(`${label}… `);

    const result = await runConversation(run, config.baseUrl, apiKey);

    writeConversation(convsDir, run.index, result);

    if (result.error) {
      failed++;
      console.log(`✗ ${result.error}`);
    } else {
      console.log("✓");
    }

    // TODO: judge(result)
  }

  console.log(`\n${total - failed}/${total} completed${failed > 0 ? `, ${failed} failed` : ""}.`);

  if (failed > 0) process.exit(1);
}
```

- [ ] **Step 2: Run the full test suite to make sure nothing regressed**

```bash
bun test evaluation/
```

Expected: all tests pass (config + conversation + writer).

- [ ] **Step 3: Commit**

```bash
git add evaluation/runner/index.ts
git commit -m "feat(eval): runner orchestrator"
```

---

## Task 6: Entry point + example config

**Files:**
- Create: `evaluation/run.ts`
- Create: `evaluation/example-config.yaml`

- [ ] **Step 1: Write `evaluation/run.ts`**

```typescript
import { runEvaluation } from "./runner/index";

const configPath = process.argv[2];
if (!configPath) {
  console.error("Usage: bun evaluation/run.ts <config.yaml>");
  console.error("Example: bun evaluation/run.ts evaluation/example-config.yaml");
  process.exit(1);
}

await runEvaluation(configPath);
```

- [ ] **Step 2: Write `evaluation/example-config.yaml`**

```yaml
# Evaluation runner config — reference example
# Run: bun evaluation/run.ts evaluation/example-config.yaml
#
# Required env var: ANTHROPIC_API_KEY

output_dir: "example-run"          # folder created under evaluation/results/ — must not exist
base_url: "http://localhost:4000"   # LiteLLM proxy URL
default_model: "claude-haiku-4-5"  # used when a run does not specify model

runs:
  # Dyadic — two distinctive archetypes in a baseline scenario
  - scenario: scenario_001
    characters: [char_001, char_003]
    turns: 4
    turn_strategy: ROUND_ROBIN

  # Similar pair — speechPatterns vary, all else identical
  - scenario: scenario_005
    characters: [char_009, char_010]
    turns: 6
    model: "claude-haiku-4-5"
    turn_strategy: ROUND_ROBIN

  # Three characters — group conversation
  - scenario: scenario_002
    characters: [char_001, char_003, char_007]
    turns: 6
    turn_strategy: ORCHESTRATOR
```

- [ ] **Step 3: Verify the entry point is importable (dry run — LiteLLM not needed)**

```bash
bun --print "await import('./evaluation/run.ts')" 2>&1 | head -5
```

Expected: no module resolution errors (it will exit with usage error since no argv, which is fine).

Alternatively: confirm no TypeScript errors:

```bash
bun run typecheck 2>&1 | grep -i "evaluation/" || echo "No evaluation/ type errors"
```

- [ ] **Step 4: Run the full test suite one final time**

```bash
bun test evaluation/
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add evaluation/run.ts evaluation/example-config.yaml
git commit -m "feat(eval): entry point and example config"
```
