/**
 * Smoke test: confirms generateTurn is callable without DB, Next.js, or Prisma.
 * Run: bun --env-file=.env evaluation/smoke.ts
 * Requires LLM_BASE_URL, LLM_API_KEY, CONVERSATION_MODEL in .env.
 */
import { generateTurn } from "../packages/shared/conversation/turn";
import type { TurnParticipant, TurnMessage, TurnConfig } from "../packages/shared/conversation/types";
import rawData from "./dataset/characters.yaml";

const characters = rawData as Array<{
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
}>;

const [char1, char2] = characters;
if (!char1 || !char2) throw new Error("Need at least 2 characters in dataset");

// Build TurnParticipant objects from YAML data — no DB involved.
const participants: TurnParticipant[] = [
  {
    characterId: char1.id,
    character: {
      name: char1.name,
      sheet: {
        name: char1.name,
        imageUrl: null,
        shortDescription: char1.archetype,
        firstAppearanceDate: "2025-01-01",
        confidence: 3,
        personality: {
          personalityTraits: char1.personalityTraits,
          backstory: char1.backstory,
          relationships: {},
          speechPatterns: char1.speechPatterns,
          values: char1.values,
          fears: char1.fears,
          goals: char1.goals,
          notableQuotes: char1.notableQuotes,
          abilities: char1.abilities,
          copingStyle: char1.copingStyle,
          knowledgeScope: {},
        },
      },
    },
  },
  {
    characterId: char2.id,
    character: {
      name: char2.name,
      sheet: {
        name: char2.name,
        imageUrl: null,
        shortDescription: char2.archetype,
        firstAppearanceDate: "2025-01-01",
        confidence: 3,
        personality: {
          personalityTraits: char2.personalityTraits,
          backstory: char2.backstory,
          relationships: {},
          speechPatterns: char2.speechPatterns,
          values: char2.values,
          fears: char2.fears,
          goals: char2.goals,
          notableQuotes: char2.notableQuotes,
          abilities: char2.abilities,
          copingStyle: char2.copingStyle,
          knowledgeScope: {},
        },
      },
    },
  },
];

const config: TurnConfig = {
  model: process.env["CONVERSATION_MODEL"] ?? "default",
  // LLM_BASE_URL includes /v1 (e.g. "https://openrouter.ai/api/v1").
  // turn.ts appends /v1 to config.baseURL, so strip it here.
  baseURL: (process.env["LLM_BASE_URL"] ?? "http://localhost:11434/v1").replace(/\/v1\/?$/, ""),
  apiKey: process.env["LLM_API_KEY"] ?? "local",
};

const messages: TurnMessage[] = [];
const context = "Two strangers meet in a ruined marketplace at dusk.";
const TURNS = 3;

console.log(`Smoke test: ${TURNS} turns, ${participants.length} characters`);
console.log(`Model: ${config.model} @ ${config.baseURL}\n`);

for (let i = 0; i < TURNS; i++) {
  const gen = generateTurn(
    { participants, messages, context, turnStrategy: "ROUND_ROBIN" },
    config,
  );

  process.stdout.write(`[Turn ${i + 1}] `);

  let result;
  while (true) {
    const { value, done } = await gen.next();
    if (done) { result = value; break; }
    if (value.type === "token") process.stdout.write(value.text);
  }

  console.log();
  console.log(`  → character: ${result.characterName} | emotion: ${result.emotion.emotion}:${result.emotion.intensity}`);
  if (result.reasoning) console.log(`  → reasoning: ${result.reasoning.slice(0, 80)}…`);
  console.log();

  // Accumulate in-memory — no DB write.
  messages.push({
    characterId: result.characterId,
    character: { name: result.characterName },
    content: result.content,
    emotion: result.emotion.emotion,
    intensity: result.emotion.intensity,
    subtext: result.emotion.subtext,
    reasoning: result.reasoning,
  });
}

console.log("Smoke test complete — no DB, no Prisma, no Next.js.");
