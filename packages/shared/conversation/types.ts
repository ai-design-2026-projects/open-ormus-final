// Structural types for conversation turn generation.
// Both the production DB wrapper and the offline evaluator build objects
// that satisfy these shapes — no Prisma or Next.js dependency here.

import type { Emotion } from "../schema/emotion";
import type { TurnStrategy } from "../schema/conversation";

export type { Emotion, TurnStrategy };

export type TurnParticipant = {
  characterId: string;
  character: {
    name: string;
    sheet: unknown; // parsed internally with CharacterSearchResultSchema
  };
};

export type TurnMessage = {
  characterId: string;
  character: { name: string };
  content: string;
  emotion: string;
  intensity: string;
  subtext: string;
  reasoning: string | null;
};

export type TurnConfig = {
  model: string;
  baseURL: string;
  apiKey: string;
  temperature?: number;
};

export type RawUsageMeta = {
  generationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  latencyMs: number;
};

export type TurnResult = {
  characterId: string;
  characterName: string;
  content: string;
  reasoning: string | null;
  emotion: Emotion;
  characterUsage: RawUsageMeta | null;
  orchestratorUsage: RawUsageMeta | null;
};

export type TurnEvent =
  | { type: "token"; text: string }
  | { type: "thinking" }
  | { type: "thinking_done" };
