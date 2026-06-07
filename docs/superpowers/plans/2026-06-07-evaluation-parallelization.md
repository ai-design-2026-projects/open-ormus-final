# Evaluation Pipeline Parallelization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate sequential LLM calls in the evaluation pipeline by parallelizing judges, characters, segments, and pipeline passes, and replace interleaved stdout with buffered output and a live progress counter.

**Architecture:** Five targeted changes — all `for` loops over independent LLM calls become `Promise.all()`. A new `ProgressReporter` class tracks completion counts per pass and holds per-item log buffers, flushed at the end or on crash. The three pipeline passes move from sequential `await` to `Promise.allSettled`.

**Tech Stack:** Bun, TypeScript, Node.js `process.stderr/stdout`

---

### Task 1: Create `evaluation/progress.ts`

**Files:**
- Create: `evaluation/progress.ts`

- [ ] **Step 1: Create the file**

```typescript
export class ProgressReporter {
  private completed = 0;
  private readonly total: number;
  private readonly label: string;
  private readonly allBuffers: string[][] = [];

  constructor(label: string, total: number) {
    this.label = label;
    this.total = total;
  }

  /** Create a per-item log buffer. Pass `(line) => buf.push(line)` as the log callback. */
  itemBuffer(): string[] {
    const buf: string[] = [];
    this.allBuffers.push(buf);
    return buf;
  }

  /** Call when one item (conversation) completes — updates the progress line on stderr. */
  tick(): void {
    this.completed++;
    process.stderr.write(`  [${this.label}] ${this.completed}/${this.total}\n`);
  }

  /** Flush all buffered item logs to stdout in insertion order. */
  flush(): void {
    for (const buf of this.allBuffers) {
      for (const line of buf) process.stdout.write(line);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add evaluation/progress.ts
git commit -m "feat(evaluation): add ProgressReporter for buffered output and progress tracking"
```

---

### Task 2: Parallelize judges in `evaluation/judge/index.ts`

**Files:**
- Modify: `evaluation/judge/index.ts:39-84`

The `for (const judgeConfig of judges)` loop is replaced with `Promise.all`. Each judge's log lines and result are returned from the async callback; the `log` callback is called after the judge resolves so lines accumulate in caller-order.

- [ ] **Step 1: Replace the sequential judge loop**

In `evaluation/judge/index.ts`, replace lines 39–84 (from `const judgeResults: JudgeResult[] = [];` to the closing brace of the for loop) with:

```typescript
  const judgeResults: JudgeResult[] = await Promise.all(
    judges.map(async (judgeConfig) => {
      const retryLines: string[] = [];
      const { output, usage } = await callJudge(
        client, judgeConfig.model, systemPrompt, userMessage, judgeConfig.label,
        (line) => retryLines.push(line),
      );

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
      const wrongCount = assignments.filter((a) => !a.correct).length;
      const resultStr = all_correct
        ? `${col.green}✓ all correct${col.reset}`
        : `${col.red}✗ ${wrongCount}/${assignments.length} wrong${col.reset}`;
      const retryNote = retryLines.length > 0
        ? ` ${col.dim}(↻ ${retryLines.length} retr${retryLines.length === 1 ? "y" : "ies"})${col.reset}`
        : "";
      const model = judgeConfig.model.length > 34 ? judgeConfig.model.slice(0, 34) + "…" : judgeConfig.model;

      log(`  [${judgeConfig.label}] ${model.padEnd(37)} ${resultStr}${retryNote}\n`);
      for (const line of retryLines) {
        log(`    ${col.dim}↻ ${line}${col.reset}\n`);
      }

      return { label: judgeConfig.label, model: judgeConfig.model, assignments, all_correct };
    }),
  );
```

- [ ] **Step 2: Run tests**

```bash
bun test --cwd mcp_server
```

Expected: all tests pass (no judge unit tests exist that test the loop directly).

- [ ] **Step 3: Commit**

```bash
git add evaluation/judge/index.ts
git commit -m "perf(evaluation): parallelize judge models per conversation"
```

---

### Task 3: Integrate `ProgressReporter` in `evaluation/judge/pass.ts`

**Files:**
- Modify: `evaluation/judge/pass.ts`

Replace direct `process.stdout.write` calls with buffered writes. The `ProgressReporter` emits one progress line to stderr per completed conversation.

- [ ] **Step 1: Add the import at the top of the file**

After the existing imports in `evaluation/judge/pass.ts`, add:

```typescript
import { ProgressReporter } from "../progress";
```

- [ ] **Step 2: Create the reporter and update the Promise.all block**

In `runJudgingPass`, replace the block starting `const total = files.length;` through the closing of the `Promise.all` (lines ~38–81) with:

```typescript
    const total = files.length;

    const entries = files.map((file, i) => ({
      file,
      result: parseYaml(readFileSync(join(conversationsDir, file), "utf-8")) as ConversationResult,
      i,
    }));

    const progress = new ProgressReporter("judge", total);

    let guessingResults: GuessingScenarioResult[];
    try {
      guessingResults = await Promise.all(
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
          const label = `[${i + 1}/${total}] ${result.scenario_id} · ${result.characters.map((ch) => ch.name).join(" + ")}`;
          const conversationId = file.replace(".yaml", "");

          const buf = progress.itemBuffer();
          try {
            const guessingResult = await runJudges(result, aliasMap, characters, scenario, config.judges, config.baseUrl, apiKey, tracker, conversationId, (line) => buf.push(line));
            const allCorrect = guessingResult.judges.every((j) => j.all_correct);
            const wrongCount = guessingResult.judges.filter((j) => !j.all_correct).length;
            const status = allCorrect
              ? `${col.green}✓${col.reset}`
              : `${col.red}✗ ${wrongCount}/${guessingResult.judges.length} judges wrong${col.reset}`;
            buf.push(`${label}  ${status}\n`);
            buf.push("\n");
            progress.tick();
            return guessingResult;
          } catch (err) {
            buf.push(`${col.boldRed}${label}  ✗ failed${col.reset}\n`);
            buf.push("\n");
            progress.tick();
            throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
          }
        }),
      );
    } finally {
      progress.flush();
    }
```

- [ ] **Step 3: Run tests**

```bash
bun test --cwd mcp_server
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add evaluation/judge/pass.ts
git commit -m "perf(evaluation): buffer judge pass output, add progress counter"
```

---

### Task 4: Add `log` callback and parallelize in `evaluation/reconstruct/index.ts`

**Files:**
- Modify: `evaluation/reconstruct/index.ts`

Two loops become parallel: the outer character loop and the inner segment loop. The `process.stdout.write` / `console.log` calls are replaced by calls to `log(...)`. A `log` parameter (defaulting to `process.stdout.write`) is added to the function signature so `pass.ts` can inject a buffer.

- [ ] **Step 1: Update the function signature**

In `evaluation/reconstruct/index.ts`, change the `runReconstructionForConversation` signature from:

```typescript
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
```

to:

```typescript
export async function runReconstructionForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedReconstructConfig,
  apiKey: string,
  tracker?: CostTracker,
  conversationId = "",
  log: (line: string) => void = (l) => process.stdout.write(l),
): Promise<ConversationReconstructionResult> {
```

- [ ] **Step 2: Replace the character for-loop with Promise.all**

Replace the `const charResults: CharacterResult[] = [];` block and the `for (const convChar of result.characters)` loop (lines 60–232) with:

```typescript
  const charResults: CharacterResult[] = await Promise.all(
    result.characters.map(async (convChar) => {
      const alias = convChar.name;
      const realName = aliasMap[alias] ?? alias;
      const charRecord = characters.find((c) => c.id === convChar.id);
      if (!charRecord) throw new Error(`Character ${convChar.id} not found in dataset`);

      log(`  [${alias} → ${realName}] reconstructing ${config.segments} segments…\n`);

      const segmentPairs = await Promise.all(
        segments.map(async (seg) => {
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
            tracker?.record({
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
                  tracker?.record({
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

          return {
            segmentResult: {
              segment_index: seg.segment_index,
              turn_range: seg.turn_range,
              message_count: seg.messages.length,
              field_scores: fieldScores as Record<ProfileField, FieldScore>,
            } satisfies SegmentResult,
            reconFields,
          };
        }),
      );

      const segmentResults = segmentPairs.map((p) => p.segmentResult);
      const segmentFields = segmentPairs.map((p) => p.reconFields);

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
                tracker?.record({
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
          log(`    [${field}] internal consistency seg0 vs segN… done\n`);
        }

        fieldDrift[field] = computeFieldDriftScore(segmentF1s, internalConsistency);
      }

      const slopes = PROFILE_FIELDS.map(
        (f) => fieldDrift[f]?.gt_divergence_slope ?? null,
      ).filter((s): s is number => s !== null);

      const icF1s = PROFILE_FIELDS.map(
        (f) => fieldDrift[f]?.internal_consistency?.f1 ?? null,
      ).filter((f): f is number => f !== null);

      return {
        alias,
        real_name: realName,
        difficulty_tier: charRecord.difficultyTier,
        segments: segmentResults,
        field_drift: fieldDrift as Record<ProfileField, FieldDriftScore>,
        mean_gt_divergence_slope:
          slopes.length > 0 ? slopes.reduce((s, v) => s + v, 0) / slopes.length : null,
        mean_internal_consistency_f1:
          icF1s.length > 0 ? icF1s.reduce((s, v) => s + v, 0) / icF1s.length : null,
      } satisfies CharacterResult;
    }),
  );
```

- [ ] **Step 3: Verify the function still returns correctly**

The closing `return` of `runReconstructionForConversation` should now be:

```typescript
  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    scenario_difficulty: scenario.difficulty_level,
    scenario_stress_axes: scenario.stress_axes,
    segment_count: config.segments,
    characters: charResults,
  };
```

- [ ] **Step 4: Run the reconstruct index tests**

```bash
bun test evaluation/reconstruct/__tests__/index.test.ts
```

Expected:
- `throws when messages < segments * 2` — PASS
- `does not throw the thin-check error when messages >= segments * 2` — PASS (will throw a network error, not the thin-check error)

- [ ] **Step 5: Commit**

```bash
git add evaluation/reconstruct/index.ts
git commit -m "perf(evaluation): parallelize reconstruction characters and segments"
```

---

### Task 5: Integrate `ProgressReporter` in `evaluation/reconstruct/pass.ts`

**Files:**
- Modify: `evaluation/reconstruct/pass.ts`

- [ ] **Step 1: Add the import**

After the existing imports in `evaluation/reconstruct/pass.ts`, add:

```typescript
import { ProgressReporter } from "../progress";
```

- [ ] **Step 2: Replace the Promise.all block**

Replace the block starting `const allResults: ConversationReconstructionResult[] = await Promise.all(` through the closing of `Promise.all` with:

```typescript
    const progress = new ProgressReporter("reconstruct", processable.length);

    let allResults: ConversationReconstructionResult[];
    try {
      allResults = await Promise.all(
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

          const buf = progress.itemBuffer();
          buf.push(`${label} — started\n`);
          try {
            const convResult = await runReconstructionForConversation(
              result, file, scenario, characters, config, apiKey, tracker, conversationId,
              (line) => buf.push(line),
            );
            buf.push(`${label} ✓\n`);
            progress.tick();
            return convResult;
          } catch (err) {
            progress.tick();
            throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
          }
        }),
      );
    } finally {
      progress.flush();
    }
```

- [ ] **Step 3: Run tests**

```bash
bun test --cwd mcp_server
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add evaluation/reconstruct/pass.ts
git commit -m "perf(evaluation): buffer reconstruct pass output, add progress counter"
```

---

### Task 6: Add `log` callback and parallelize segments in `evaluation/drift/index.ts`

**Files:**
- Modify: `evaluation/drift/index.ts`

The `for (let segIdx...)` loop over segments becomes `Promise.all`. `turnOffset` (which was accumulated in the loop) is precomputed per segment from the `segments` array.

- [ ] **Step 1: Update the function signature**

In `evaluation/drift/index.ts`, change the `runDriftForConversation` signature from:

```typescript
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
```

to:

```typescript
export async function runDriftForConversation(
  result: ConversationResult,
  fileName: string,
  scenario: ScenarioRecord,
  characters: CharacterRecord[],
  config: ValidatedDriftConfig,
  apiKey: string,
  tracker?: CostTracker,
  conversationId = "",
  log: (line: string) => void = (l) => process.stdout.write(l),
): Promise<ConversationDriftResult> {
```

- [ ] **Step 2: Replace the segment for-loop**

Replace the lines from `const segmentScores: SegmentScore[] = [];` and `let turnOffset = 0;` and the `for (let segIdx...)` loop (roughly lines 57–148) with:

```typescript
  const segmentOffsets = segments.map((_, i) =>
    segments.slice(0, i).reduce((sum, s) => sum + s.length, 0),
  );

  const segmentScores: SegmentScore[] = await Promise.all(
    segments.map(async (segMessages, segIdx) => {
      const firstTurn = segmentOffsets[segIdx]! + 1;
      const lastTurn = segmentOffsets[segIdx]! + segMessages.length;
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
        .filter(
          (r): r is PromiseFulfilledResult<{ output: Awaited<ReturnType<typeof callJudge>>["output"]; usage: Awaited<ReturnType<typeof callJudge>>["usage"] }> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value);

      for (const { usage } of successfulResults) {
        if (usage) {
          tracker?.record({
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

      log(`  [seg ${segIdx + 1}/${segments.length}] judging… ${engResult.label} (${successfulOutputs.length}/${config.judges.length} judges)\n`);

      return {
        index: segIdx + 1,
        turn_range: [firstTurn, lastTurn] as [number, number],
        scenario_engagement: {
          label: engResult.label,
          votes: engVotes,
          confidence: engResult.confidence,
          score: engResult.score,
        },
        personality_alignment: alignmentScores,
        low_confidence: lowConfidence,
      } satisfies SegmentScore;
    }),
  );
```

- [ ] **Step 3: Run the drift index tests**

```bash
bun test evaluation/drift/__tests__/index.test.ts
```

Expected: all 5 tests pass. The `callJudge` mock is called 4 times total (2 segments × 2 judges) — same as before.

- [ ] **Step 4: Commit**

```bash
git add evaluation/drift/index.ts
git commit -m "perf(evaluation): parallelize drift segments, precompute turn offsets"
```

---

### Task 7: Integrate `ProgressReporter` in `evaluation/drift/pass.ts`

**Files:**
- Modify: `evaluation/drift/pass.ts`

- [ ] **Step 1: Add the import**

After the existing imports in `evaluation/drift/pass.ts`, add:

```typescript
import { ProgressReporter } from "../progress";
```

- [ ] **Step 2: Replace the Promise.all block**

Replace the block starting `const allResults: ConversationDriftResult[] = await Promise.all(` through its closing with:

```typescript
    const progress = new ProgressReporter("drift", processable.length);

    let allResults: ConversationDriftResult[];
    try {
      allResults = await Promise.all(
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

          const buf = progress.itemBuffer();
          buf.push(`${label} — started\n`);
          try {
            const convResult = await runDriftForConversation(
              result, file, scenario, characters, config, apiKey, tracker, conversationId,
              (line) => buf.push(line),
            );
            buf.push(`${label} ✓\n`);
            progress.tick();
            return convResult;
          } catch (err) {
            progress.tick();
            throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
          }
        }),
      );
    } finally {
      progress.flush();
    }
```

- [ ] **Step 3: Run tests**

```bash
bun test evaluation/drift/__tests__/index.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add evaluation/drift/pass.ts
git commit -m "perf(evaluation): buffer drift pass output, add progress counter"
```

---

### Task 8: Parallelize pipeline passes in `evaluation/run_pipeline.ts`

**Files:**
- Modify: `evaluation/run_pipeline.ts`

Replace the three sequential `await` calls and the `handleFailure` function with `Promise.allSettled`. All three passes start simultaneously; failures are collected and reported together.

- [ ] **Step 1: Replace the file content from line 45 onwards**

Keep the imports, constants, and the `tty`/`c` block as-is. Remove the `handleFailure` function and replace everything from `console.log(\`Evaluating...)` to the end of the file with:

```typescript
console.log(`Evaluating ${dataset}/${evalName}`);

const [judgeResult, reconstructResult, driftResult] = await Promise.allSettled([
  runJudgingPass(JUDGE_CONFIG, evalName),
  runReconstructionPass(RECONSTRUCT_CONFIG, evalName),
  runDriftPass(DRIFT_CONFIG, evalName),
]);

const passEntries = [
  { name: "judge_guessing" as const, result: judgeResult },
  { name: "reconstruct_persona" as const, result: reconstructResult },
  { name: "context_drift" as const, result: driftResult },
];

const completedPasses = passEntries.filter((p) => p.result.status === "fulfilled").map((p) => p.name);
const failedEntries = passEntries.filter((p) => p.result.status === "rejected");

if (failedEntries.length === 0) {
  console.log(`\nEvaluation complete: ${evalDir}`);
  process.exit(0);
}

const pad = (s: string) => s.padEnd(24);
process.stderr.write(`\n${c.boldRed}✗ Evaluation pipeline failed${c.reset}\n`);
process.stderr.write(`  Dataset:  ${dataset} / ${evalName}\n\n`);
for (const p of ALL_PASSES) {
  const entry = passEntries.find((e) => e.name === p);
  if (!entry) continue;
  if (entry.result.status === "fulfilled")
    process.stderr.write(`  ${pad(p)} ${c.green}✓ completed${c.reset}\n`);
  else
    process.stderr.write(`  ${pad(p)} ${c.boldRed}✗ failed${c.reset}\n`);
}
for (const { name, result } of failedEntries) {
  if (result.status === "rejected") {
    const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
    process.stderr.write(`\n  ${c.red}${name}:${c.reset} ${msg}\n`);
    if (process.env["DEBUG"] && result.reason instanceof Error && result.reason.stack) {
      process.stderr.write(`  ${c.dim}Stack:${c.reset}\n${result.reason.stack}\n`);
    }
  }
}

if (completedPasses.length === 0 && existsSync(evalDir)) {
  rmSync(evalDir, { recursive: true, force: true });
} else if (completedPasses.length > 0) {
  process.stderr.write(`\n  Partial results preserved in: ${evalDir}\n`);
}

process.exit(1);
```

- [ ] **Step 2: Run all tests**

```bash
bun test evaluation/drift/__tests__/index.test.ts && bun test evaluation/reconstruct/__tests__/index.test.ts && bun test --cwd mcp_server
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add evaluation/run_pipeline.ts
git commit -m "perf(evaluation): run all three pipeline passes in parallel"
```

---

### Task 9: Final verification

- [ ] **Step 1: Typecheck**

```bash
bun run typecheck 2>&1 | grep -v "Cannot find module.*prisma"
```

Expected: only the pre-existing Prisma client errors (due to missing `DIRECT_URL` in env). No new errors.

- [ ] **Step 2: Run all evaluation tests**

```bash
bun test evaluation/
```

Expected: all tests pass.
