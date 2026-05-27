# Evaluation Runner — Design Spec

**Date:** 2026-05-28
**Status:** Approved

## Context

The behavioural fidelity benchmark needs a runner that drives multi-character conversations
using the same `generateTurn()` function used in production. The runner is offline (no DB,
no frontend, no auth) and fully deterministic: given a config file, it produces a directory
of YAML conversation transcripts. A judge/scoring layer will be added later as a separate
module.

---

## File Structure

```
evaluation/
  run.ts                        # entry point: bun evaluation/run.ts <config.yaml>
  runner/
    config.ts                   # Zod schema + loader + validator
    conversation.ts             # runs one conversation, returns ConversationResult
    writer.ts                   # filesystem: init output dir, write files
    index.ts                    # orchestrator: validate → init → loop → summary
  dataset/
    characters.yaml
    scenarios.yaml
    DESIGN_DECISIONS.md
    SCENARIO_DESIGN_NOTES.md
  results/                      # gitignored — generated at runtime
    <output_dir>/
      config.yaml               # copy of the input config
      conversations/
        001.yaml
        002.yaml
        ...
  smoke.ts                      # existing, unchanged
```

`evaluation/results/` is added to `.gitignore`.

---

## Config File Format (YAML)

```yaml
output_dir: "pilot-run"              # folder name under evaluation/results/
base_url: "http://localhost:4000"    # LiteLLM proxy
default_model: "claude-haiku-4-5"   # optional — used if a run omits model

runs:
  - scenario: scenario_005
    characters: [char_001, char_003]
    turns: 6
    model: "claude-haiku-4-5"        # optional, overrides default_model
    turn_strategy: ROUND_ROBIN

  - scenario: scenario_012
    characters: [char_009, char_010]
    turns: 8
    turn_strategy: ROUND_ROBIN       # auto-forced for 2-character runs
```

**`api_key`** is read from `ANTHROPIC_API_KEY` env var — never stored in the config file.

### Validation rules (enforced upfront before any run starts)

| Rule | Behaviour |
|------|-----------|
| `output_dir` already exists | Hard error — abort immediately |
| `scenario` not found in `scenarios.yaml` | Hard error |
| Any `characters[i]` not found in `characters.yaml` | Hard error |
| `turns < 1` | Hard error |
| `characters.length == 2` + `turn_strategy == ORCHESTRATOR` | Warning, forced to `ROUND_ROBIN` |
| Run has no `model` and no `default_model` | Hard error |
| `ANTHROPIC_API_KEY` not set | Hard error |

All validation runs before the output directory is created, so a bad config never produces
partial output.

---

## Conversation File Format (YAML)

File name: zero-padded index (`001.yaml`, `002.yaml`, …)

### Success

```yaml
run_index: 1
scenario_id: scenario_005
scenario_title: "News You Did Not Ask For"
scenario_context: >-
  Someone outside your immediate circle has told you something damaging...
initial_prompt: >-
  The person you care about greets you warmly and asks how your day is going...
characters:
  - id: char_001
    name: Tavon Rell
    archetype: Rebel
  - id: char_003
    name: Marek Sol
    archetype: Schemer
model: claude-haiku-4-5
turn_strategy: ROUND_ROBIN
turns_requested: 6
started_at: "2026-05-28T10:00:00Z"
completed_at: "2026-05-28T10:01:30Z"

messages:
  - turn: 1
    character_id: char_001
    character_name: Tavon Rell
    emotion: Anger
    intensity: high
    subtext: "Trying not to show what he knows."
    reasoning: "She's acting normal. I can't tell her yet."
    content: "Fine. Day's fine."
  - turn: 2
    ...

# evaluation: {}   # placeholder — populated by judge module (future)
```

### Failure

```yaml
run_index: 1
scenario_id: scenario_005
characters:
  - id: char_001
    name: Tavon Rell
model: claude-haiku-4-5
turn_strategy: ROUND_ROBIN
turns_requested: 6
started_at: "2026-05-28T10:00:00Z"
failed_at: "2026-05-28T10:00:03Z"
error: "LITELLM_ERROR: Content stream error: connect ECONNREFUSED 127.0.0.1:4000"
messages: []
```

---

## Initial Prompt Handling

Scenarios define a `context` (scene setup) and an `initial_prompt` (the specific opening
situation). The production system has only `context` — passed as `sceneContext` into the
`## Scene` section of the character's system prompt.

In the runner: `context` passed to `generateTurn()` is the concatenation:

```
scenario.context + "\n\n" + scenario.initial_prompt
```

This is operationally identical to production behaviour. `initial_prompt` is also written
separately to the output file header for documentation purposes only.

---

## Module Responsibilities

### `runner/config.ts`

- Zod schema for the config file structure
- Loads `evaluation/dataset/characters.yaml` and `evaluation/dataset/scenarios.yaml`
- Validates all runs against loaded data (see validation table above)
- Resolves `model` per run: run-level overrides `default_model`; error if neither present
- Auto-corrects `turn_strategy` to `ROUND_ROBIN` for 2-character runs with a warning
- Export: `loadConfig(path: string): Promise<ValidatedConfig>`

### `runner/conversation.ts`

- Receives one validated run + loaded character records + scenario record + `TurnConfig`
- Builds `TurnParticipant[]` from YAML data (same pattern as `smoke.ts`)
- Concatenates context + initial_prompt, calls `generateTurn()` for N turns
- Accumulates messages in-memory; records `started_at` / `completed_at`
- Returns `ConversationResult` (metadata + messages, or metadata + error)
- Export: `runConversation(...): Promise<ConversationResult>`

### `runner/writer.ts`

- `initOutputDir(basePath, name)`: verifies dir does not exist, creates structure
  (`results/<name>/` + `results/<name>/conversations/`), writes copy of config
- `writeConversation(dir, index, result)`: serialises `ConversationResult` to YAML,
  writes to `conversations/<NNN>.yaml`
- Export: `initOutputDir`, `writeConversation`

### `runner/index.ts`

- Reads `ANTHROPIC_API_KEY` from env (hard error if missing)
- Calls `loadConfig` → `initOutputDir` → loop over runs:
  - `try { result = await runConversation(...) } catch (e) { result = failureRecord(e) }`
  - `writeConversation(...)` immediately after each run
  - Logs: `[1/12] scenario_005 · char_001 + char_003 · 6 turns… ✓` or `✗ <error>`
- Placeholder comment after each run: `// TODO: judge(result)`
- Prints end summary: `✓ 10/12 completed, ✗ 2 failed`
- Export: `runEvaluation(configPath: string): Promise<void>`

### `evaluation/run.ts`

Entry point. Reads config path from `process.argv[2]`, calls `runEvaluation`. Prints
usage and exits with code 1 if no argument is provided.

```
bun evaluation/run.ts evaluation/my-config.yaml
```

---

## Error Handling

| Error source | Behaviour |
|---|---|
| Config validation failure | Abort before creating any output |
| `output_dir` already exists | Abort before creating any output |
| `ANTHROPIC_API_KEY` missing | Abort before creating any output |
| Single conversation failure | Write failure record, continue to next run |
| All conversations fail | All files written as failures; exit code 1 |
| Partial failure (some ok, some fail) | Exit code 1; summary lists failed indices |

---

## Out of Scope (follow-up)

- Judge/scoring module (`runner/judge.ts`) — the `// TODO: judge(result)` placeholder marks where it slots in
- Resuming a partially failed run (re-running only failed conversations)
- Parallel execution across runs
- Progress persistence / checkpointing
