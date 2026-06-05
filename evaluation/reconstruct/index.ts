import OpenAI from "openai";
import { callReconstructor, callComparator } from "./call";
import {
  reconstructorSystemPrompt,
  buildReconstructorUserMessage,
  comparatorSystemPrompt,
  buildComparatorUserMessage,
} from "./prompt";
import {
  buildItemScores,
  computeFieldScore,
  computeCharacterScore,
} from "./scoring";
import { reconstructAliasMap } from "../judge/alias";
import { PROFILE_FIELDS } from "./types";
import type {
  ProfileField,
  FieldScore,
  CharacterResult,
  ConversationReconstructionResult,
  ValidatedReconstructConfig,
} from "./types";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";

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
): Promise<ConversationReconstructionResult> {
  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });
  const aliasMap = reconstructAliasMap(result.characters, characters);

  // Strip reasoning/subtext — only content, emotion, intensity go to reconstructor
  const strippedMessages = result.messages.map((m) => ({
    ...m,
    reasoning: "",
    subtext: "",
  }));

  const charResults: CharacterResult[] = [];

  for (const convChar of result.characters) {
    const alias = convChar.name;
    const realName = aliasMap[alias] ?? alias;
    const charRecord = characters.find((c) => c.id === convChar.id);
    if (!charRecord) throw new Error(`Character ${convChar.id} not found in dataset`);

    process.stdout.write(`  [${alias} → ${realName}] reconstructing…`);

    const userMsg = buildReconstructorUserMessage(alias, scenario, strippedMessages, config.fields);
    const reconstruction = await callReconstructor(
      client,
      config.reconstructorModel,
      reconstructorSystemPrompt,
      userMsg,
      config.fields,
      `reconstructor:${alias}`,
    );
    process.stdout.write(" done\n");

    const fieldItemsByField: Map<ProfileField, string[]> = new Map();
    const fieldScores: Partial<Record<ProfileField, FieldScore>> = {};

    for (const field of config.fields) {
      const reconstructedField = reconstruction.fields[field];
      const notObserved = !reconstructedField || reconstructedField.not_observed || reconstructedField.items.length === 0;
      const reconstructedItems = notObserved ? [] : reconstructedField.items;
      fieldItemsByField.set(field, reconstructedItems);

      if (notObserved) {
        fieldScores[field] = computeFieldScore(true, getGtItems(charRecord, field), []);
        continue;
      }

      const gtItems = getGtItems(charRecord, field);
      process.stdout.write(`    [${field}] comparing ${reconstructedItems.length} items vs ${gtItems.length} GT…`);

      const comparatorOutputs = await Promise.all(
        config.comparators.map(async (comp) => {
          const compUserMsg = buildComparatorUserMessage(field, gtItems, reconstructedItems);
          const output = await callComparator(client, comp.model, comparatorSystemPrompt, compUserMsg, `${comp.label}:${alias}:${field}`);
          return { model: comp.model, scores: output.item_scores };
        }),
      );

      const itemScores = buildItemScores(reconstructedItems, comparatorOutputs);
      fieldScores[field] = computeFieldScore(false, gtItems, itemScores);
      process.stdout.write(" done\n");
    }

    // Fill missing configured fields (not in reconstruction) as not_observed
    for (const field of config.fields) {
      if (!fieldScores[field]) {
        fieldScores[field] = computeFieldScore(true, getGtItems(charRecord, field), []);
      }
    }
    // Fill non-configured fields as not_observed for type completeness
    for (const field of PROFILE_FIELDS) {
      if (!fieldScores[field]) {
        fieldScores[field] = computeFieldScore(true, [], []);
      }
    }

    charResults.push({
      alias,
      real_name: realName,
      difficulty_tier: charRecord.difficultyTier,
      field_scores: fieldScores as Record<ProfileField, FieldScore>,
      character_score: computeCharacterScore(fieldScores as Record<ProfileField, FieldScore>),
    });
  }

  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    scenario_difficulty: scenario.difficulty_level,
    scenario_stress_axes: scenario.stress_axes,
    characters: charResults,
  };
}
