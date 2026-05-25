// Validates evaluation/dataset/scenarios.json against schema and coverage rules.
// Run: bun scripts/validate-scenarios.ts

import { readFileSync } from "fs";
import { resolve } from "path";

type SocialContext =
  | "group_conflict"
  | "personal_betrayal"
  | "resource_scarcity"
  | "truth_telling"
  | "authority_challenge"
  | "crisis_response"
  | "knowledge_asymmetry"
  | "legacy_memory";

type PressureSource =
  | "external_force"
  | "internal_conflict"
  | "relational_demand"
  | "institutional_pressure";

type DifficultyLevel = "baseline" | "moderate" | "high";

type StressAxis =
  | "loyalty vs principle"
  | "truth vs kindness"
  | "individual safety vs collective benefit"
  | "short-term relief vs long-term cost"
  | "power consolidation vs fairness"
  | "obedience vs conscience"
  | "transparency vs protection"
  | "agency vs belonging"
  | "memory vs progress"
  | "complicity vs pragmatism"
  | "care vs boundary"
  | "precedent vs exception";

const SOCIAL_CONTEXTS: SocialContext[] = [
  "group_conflict",
  "personal_betrayal",
  "resource_scarcity",
  "truth_telling",
  "authority_challenge",
  "crisis_response",
  "knowledge_asymmetry",
  "legacy_memory",
];

const PRESSURE_SOURCES: PressureSource[] = [
  "external_force",
  "internal_conflict",
  "relational_demand",
  "institutional_pressure",
];

const STRESS_AXES: StressAxis[] = [
  "loyalty vs principle",
  "truth vs kindness",
  "individual safety vs collective benefit",
  "short-term relief vs long-term cost",
  "power consolidation vs fairness",
  "obedience vs conscience",
  "transparency vs protection",
  "agency vs belonging",
  "memory vs progress",
  "complicity vs pragmatism",
  "care vs boundary",
  "precedent vs exception",
];

const EXPECTED_DIFFICULTY_COUNTS: Record<DifficultyLevel, number> = {
  baseline: 8,
  moderate: 12,
  high: 12,
};

const MAX_AXIS_FREQUENCY = 5;

interface Scenario {
  id: string;
  title: string;
  context: string;
  initial_prompt: string;
  difficulty_level: DifficultyLevel;
  stress_axes: StressAxis[];
  social_context: SocialContext;
  pressure_source: PressureSource;
}

function isStringNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

let allPassed = true;

function check(condition: boolean, message: string): boolean {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    allPassed = false;
    return false;
  }
  console.log(`  ✓ ${message}`);
  return true;
}

const raw = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../evaluation/dataset/scenarios.json"), "utf-8")
) as unknown;

check(Array.isArray(raw), "scenarios.json is a JSON array");
if (!Array.isArray(raw)) process.exit(1);

check(raw.length === 32, `array length = 32 (got ${raw.length})`);

const seenIds = new Set<string>();
const seenCells = new Set<string>();
const axisCounts = new Map<string, number>(STRESS_AXES.map((a) => [a, 0]));
const difficultyCounts: Record<DifficultyLevel, number> = { baseline: 0, moderate: 0, high: 0 };

for (let i = 0; i < raw.length; i++) {
  const s = raw[i] as Record<string, unknown>;
  const expectedId = `scenario_${String(i + 1).padStart(3, "0")}`;
  console.log(`\n[${expectedId}]`);

  const idValid = check(isStringNonEmpty(s["id"]), `id is non-empty string`);
  if (idValid) {
    check(s["id"] === expectedId, `id equals ${expectedId} (got "${s["id"]}")`);
    check(!seenIds.has(s["id"] as string), `id is unique`);
    seenIds.add(s["id"] as string);
  }

  check(isStringNonEmpty(s["title"]), `title is non-empty string`);
  check(isStringNonEmpty(s["context"]), `context is non-empty string`);
  check(isStringNonEmpty(s["initial_prompt"]), `initial_prompt is non-empty string`);

  const validDifficulty = ["baseline", "moderate", "high"].includes(s["difficulty_level"] as string);
  check(validDifficulty, `difficulty_level is valid (got "${s["difficulty_level"]}")`);

  const validSocialCtx = SOCIAL_CONTEXTS.includes(s["social_context"] as SocialContext);
  check(validSocialCtx, `social_context is valid (got "${s["social_context"]}")`);

  const validPressure = PRESSURE_SOURCES.includes(s["pressure_source"] as PressureSource);
  check(validPressure, `pressure_source is valid (got "${s["pressure_source"]}")`);

  if (validSocialCtx && validPressure) {
    const cell = `${s["social_context"]}:${s["pressure_source"]}`;
    check(!seenCells.has(cell), `cell ${cell} is unique`);
    seenCells.add(cell);
  }

  check(Array.isArray(s["stress_axes"]), `stress_axes is an array`);
  const axes = Array.isArray(s["stress_axes"]) ? s["stress_axes"] : [];
  check(new Set(axes).size === axes.length, `stress_axes has no duplicates`);

  if (s["difficulty_level"] === "baseline") {
    check(axes.length === 0, `baseline scenario has 0 stress_axes (got ${axes.length})`);
  } else {
    check(axes.length >= 1 && axes.length <= 4, `stress_axes count 1–4 (got ${axes.length})`);
  }

  for (const axis of axes) {
    const validAxis = STRESS_AXES.includes(axis as StressAxis);
    check(validAxis, `stress axis "${axis}" is from approved taxonomy`);
    if (validAxis) axisCounts.set(axis as string, (axisCounts.get(axis as string) ?? 0) + 1);
  }

  if (validDifficulty) difficultyCounts[s["difficulty_level"] as DifficultyLevel]++;
}

console.log("\n[AGGREGATE]");

for (const [level, expected] of Object.entries(EXPECTED_DIFFICULTY_COUNTS)) {
  const actual = difficultyCounts[level as DifficultyLevel];
  check(actual === expected, `${level} count = ${expected} (got ${actual})`);
}

check(seenCells.size === 32, `all 32 coverage cells filled (got ${seenCells.size})`);

for (const [axis, count] of axisCounts.entries()) {
  check(
    count <= MAX_AXIS_FREQUENCY,
    `axis "${axis}" appears ${count}× (max ${MAX_AXIS_FREQUENCY})`
  );
}

console.log(allPassed ? "\n✅ All checks passed." : "\n❌ Validation failed — see failures above.");
if (!allPassed) process.exit(1);
