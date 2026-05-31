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
  aliasMap: AliasMap,
): Promise<ConversationResult> {
  const started_at = new Date().toISOString();
  const participants: TurnParticipant[] = run.characters.map((char) =>
    buildParticipant(char, realNameToAlias(aliasMap, char.name))
  );
  const messages: TurnMessage[] = [];

  // Combine scenario context + initial_prompt — identical to how production uses context
  const context = `${run.scenario.context}\n\n${run.scenario.initial_prompt}`;

  const config: TurnConfig = {
    model: run.model,
    baseURL: baseUrl,
    apiKey,
    temperature: 0,
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
  } catch (err) {
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
      failed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      // Per design spec: failure records have messages: [] — partial results are not preserved.
      // If a run fails mid-way, all messages from completed turns are discarded.
      // The output file documents the error and the run can be re-attempted by re-running with the same config.
      messages: [],
    };
  }
}
