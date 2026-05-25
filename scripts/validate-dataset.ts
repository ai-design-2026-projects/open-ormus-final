// Validates evaluation/dataset/characters.yaml against schema and semantic rules.
// Run: bun scripts/validate-dataset.ts

import rawData from "../evaluation/dataset/characters.yaml";

type DifficultyTier = "distinctive" | "similar_pair";
type VaryingAxis = "speechPatterns" | "copingStyle" | "fears" | "goals";

interface Character {
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
  difficultyTier: DifficultyTier;
  similarTo: string | null;
  varyingAxis: VaryingAxis | null;
}

const VARYING_AXES: VaryingAxis[] = ["speechPatterns", "copingStyle", "fears", "goals"];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isRecord(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateSchema(c: unknown, idx: number): string[] {
  const errors: string[] = [];
  const prefix = `[${idx}]`;
  if (!isRecord(c)) { errors.push(`${prefix} not an object`); return errors; }
  const char = c as Record<string, unknown>;

  const requiredStringArrays = [
    "personalityTraits", "speechPatterns", "values", "fears",
    "goals", "notableQuotes", "abilities", "copingStyle",
  ];
  const requiredStrings = ["id", "name", "archetype", "backstory"];

  for (const field of requiredStrings) {
    if (typeof char[field] !== "string" || (char[field] as string).length === 0)
      errors.push(`${prefix} missing or empty string: ${field}`);
  }
  for (const field of requiredStringArrays) {
    if (!isStringArray(char[field]) || (char[field] as string[]).length === 0)
      errors.push(`${prefix} missing or empty array: ${field}`);
  }
  if (!["distinctive", "similar_pair"].includes(char.difficultyTier as string))
    errors.push(`${prefix} invalid difficultyTier: ${char.difficultyTier}`);
  if (char.similarTo !== null && typeof char.similarTo !== "string")
    errors.push(`${prefix} similarTo must be string or null`);
  if (char.varyingAxis !== null && !VARYING_AXES.includes(char.varyingAxis as VaryingAxis))
    errors.push(`${prefix} invalid varyingAxis: ${char.varyingAxis}`);

  // Field length constraints
  if (isStringArray(char.personalityTraits) && (char.personalityTraits.length < 4 || char.personalityTraits.length > 6))
    errors.push(`${prefix} personalityTraits must have 4–6 items, got ${char.personalityTraits.length}`);
  if (isStringArray(char.speechPatterns) && (char.speechPatterns.length < 3 || char.speechPatterns.length > 4))
    errors.push(`${prefix} speechPatterns must have 3–4 items, got ${char.speechPatterns.length}`);
  if (isStringArray(char.values) && (char.values.length < 3 || char.values.length > 4))
    errors.push(`${prefix} values must have 3–4 items, got ${char.values.length}`);
  if (isStringArray(char.fears) && (char.fears.length < 2 || char.fears.length > 3))
    errors.push(`${prefix} fears must have 2–3 items, got ${char.fears.length}`);
  if (isStringArray(char.goals) && (char.goals.length < 2 || char.goals.length > 3))
    errors.push(`${prefix} goals must have 2–3 items, got ${char.goals.length}`);
  if (isStringArray(char.notableQuotes) && (char.notableQuotes.length < 2 || char.notableQuotes.length > 3))
    errors.push(`${prefix} notableQuotes must have 2–3 items, got ${char.notableQuotes.length}`);
  if (isStringArray(char.abilities) && (char.abilities.length < 3 || char.abilities.length > 4))
    errors.push(`${prefix} abilities must have 3–4 items, got ${char.abilities.length}`);
  if (isStringArray(char.copingStyle) && (char.copingStyle.length < 2 || char.copingStyle.length > 3))
    errors.push(`${prefix} copingStyle must have 2–3 items, got ${char.copingStyle.length}`);

  return errors;
}

function validateSemantics(chars: Character[]): string[] {
  const errors: string[] = [];
  const byId = new Map(chars.map((c) => [c.id, c]));

  for (const c of chars) {
    if (c.difficultyTier === "distinctive") {
      if (c.similarTo !== null) errors.push(`${c.id}: distinctive tier must have similarTo: null`);
      if (c.varyingAxis !== null) errors.push(`${c.id}: distinctive tier must have varyingAxis: null`);
    }
    if (c.difficultyTier === "similar_pair") {
      if (!c.similarTo) errors.push(`${c.id}: similar_pair must have non-null similarTo`);
      if (!c.varyingAxis) errors.push(`${c.id}: similar_pair must have non-null varyingAxis`);
    }
    if (c.similarTo && !byId.has(c.similarTo))
      errors.push(`${c.id}: similarTo references non-existent id ${c.similarTo}`);
    if (c.similarTo) {
      const partner = byId.get(c.similarTo);
      if (partner && partner.similarTo !== c.id)
        errors.push(`${c.id}: similarTo is not bidirectional (partner.similarTo = ${partner.similarTo})`);
    }
    if (c.similarTo && c.varyingAxis) {
      const partner = byId.get(c.similarTo);
      if (partner && partner.varyingAxis !== c.varyingAxis)
        errors.push(`${c.id}: varyingAxis mismatch with partner ${c.similarTo}`);
    }
    if (!/^char_\d{3}$/.test(c.id))
      errors.push(`${c.id}: id must match pattern char_NNN`);
  }

  if (chars.length !== 16)
    errors.push(`Expected 16 characters, got ${chars.length}`);

  const distinctive = chars.filter((c) => c.difficultyTier === "distinctive");
  const pairs = chars.filter((c) => c.difficultyTier === "similar_pair");
  if (distinctive.length !== 8) errors.push(`Expected 8 distinctive characters, got ${distinctive.length}`);
  if (pairs.length !== 8) errors.push(`Expected 8 similar_pair characters, got ${pairs.length}`);

  const ARRAY_FIELDS: (keyof Character)[] = [
    "personalityTraits", "speechPatterns", "values", "fears",
    "goals", "abilities", "copingStyle",
  ];
  const processedPairs = new Set<string>();
  for (const c of pairs) {
    if (!c.similarTo || processedPairs.has(c.id)) continue;
    const partner = byId.get(c.similarTo);
    if (!partner) continue;
    processedPairs.add(c.id);
    processedPairs.add(c.similarTo);

    for (const field of ARRAY_FIELDS) {
      if (field === c.varyingAxis) continue;
      const aVal = JSON.stringify(c[field]);
      const bVal = JSON.stringify(partner[field]);
      if (aVal !== bVal)
        errors.push(`Pair ${c.id}↔${c.similarTo}: field "${field}" should be identical but differs`);
    }
    // notableQuotes are exempt when varyingAxis is speechPatterns/fears/goals (quotes reflect those fields).
    // When varyingAxis is copingStyle, quotes should be identical.
    const QUOTE_EXEMPT_AXES: VaryingAxis[] = ["speechPatterns", "fears", "goals"];
    if (!QUOTE_EXEMPT_AXES.includes(c.varyingAxis as VaryingAxis)) {
      const aQ = JSON.stringify(c.notableQuotes);
      const bQ = JSON.stringify(partner.notableQuotes);
      if (aQ !== bQ)
        errors.push(`Pair ${c.id}↔${c.similarTo}: field "notableQuotes" should be identical but differs`);
    }
    if (c.backstory !== partner.backstory)
      console.warn(`  WARN: ${c.id}↔${c.similarTo}: backstory differs (may be intentional for pronoun agreement)`);
  }

  return errors;
}

const chars = rawData as unknown as Character[];

console.log(`Loaded ${chars.length} characters.`);

let allErrors: string[] = [];
chars.forEach((c, i) => {
  allErrors = allErrors.concat(validateSchema(c, i));
});
allErrors = allErrors.concat(validateSemantics(chars));

if (allErrors.length === 0) {
  console.log("✓ All validation checks passed.");
  process.exit(0);
} else {
  console.error(`✗ ${allErrors.length} validation error(s):`);
  allErrors.forEach((e) => console.error(" ", e));
  process.exit(1);
}
