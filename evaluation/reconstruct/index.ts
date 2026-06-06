import OpenAI from "openai";
import { callReconstructor, callComparator } from "./call";
import {
  buildReconstructorSystemPrompt,
  buildReconstructorUserMessage,
  buildComparatorSystemPrompt,
  buildComparatorUserMessage,
} from "./prompt";
import { buildItemScores, computeFieldScore, computeFieldDriftScore } from "./scoring";
import { reconstructAliasMap } from "../judge/alias";
import { segmentConversation } from "./segmenter";
import { PROFILE_FIELDS } from "./types";
import type {
  ProfileField,
  FieldScore,
  ReconstructedField,
  CharacterResult,
  ConversationReconstructionResult,
  ValidatedReconstructConfig,
  SegmentResult,
  FieldDriftScore,
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
  const strippedMessages = result.messages.map((m) => ({
    ...m,
    reasoning: "",
    subtext: "",
  }));

  if (strippedMessages.length < config.segments * 2) {
    throw new Error(
      `${fileName}: not enough messages for ${config.segments} segments ` +
        `(${strippedMessages.length} messages, need at least ${config.segments * 2})`,
    );
  }

  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });
  const aliasMap = reconstructAliasMap(result.characters, characters);
  const segments = segmentConversation(strippedMessages, config.segments);
  const reconstructorSysPrompt = buildReconstructorSystemPrompt();
  const comparatorSysPrompt = buildComparatorSystemPrompt();

  const charResults: CharacterResult[] = [];

  for (const convChar of result.characters) {
    const alias = convChar.name;
    const realName = aliasMap[alias] ?? alias;
    const charRecord = characters.find((c) => c.id === convChar.id);
    if (!charRecord) throw new Error(`Character ${convChar.id} not found in dataset`);

    console.log(`  [${alias} → ${realName}] reconstructing ${config.segments} segments…`);

    // ── Step 1: Reconstruct + score vs GT for each segment ───────────────────
    const segmentResults: SegmentResult[] = [];
    const segmentFields: Array<Partial<Record<ProfileField, ReconstructedField>>> = [];

    for (const seg of segments) {
      const userMsg = buildReconstructorUserMessage(alias, scenario, seg.messages, config.fields);

      const reconstruction = await callReconstructor(
        client,
        config.reconstructorModel,
        reconstructorSysPrompt,
        userMsg,
        config.fields,
        `reconstructor:${alias}:seg${seg.segment_index}`,
      );

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
            const output = await callComparator(
              client,
              comp.model,
              comparatorSysPrompt,
              compUserMsg,
              `${comp.label}:${alias}:seg${seg.segment_index}:${field}`,
            );
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

      segmentResults.push({
        segment_index: seg.segment_index,
        turn_range: seg.turn_range,
        message_count: seg.messages.length,
        field_scores: fieldScores as Record<ProfileField, FieldScore>,
      });

      segmentFields.push(reconFields);
    }

    // ── Step 2: Compute drift metrics per field ───────────────────────────────
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
        process.stdout.write(`    [${field}] internal consistency seg0 vs segN…`);

        const compOutputs = await Promise.all(
          config.comparators.map(async (comp) => {
            const compUserMsg = buildComparatorUserMessage(
              field,
              seg0Field.items,
              segNField.items,
            );
            const output = await callComparator(
              client,
              comp.model,
              comparatorSysPrompt,
              compUserMsg,
              `${comp.label}:${alias}:internal:${field}`,
            );
            return { model: comp.model, scores: output.item_scores };
          }),
        );

        const itemScores = buildItemScores(segNField.items, compOutputs);
        internalConsistency = computeFieldScore(false, seg0Field.items, itemScores);
        process.stdout.write(" done\n");
      }

      fieldDrift[field] = computeFieldDriftScore(segmentF1s, internalConsistency);
    }

    // ── Step 3: Aggregate per character ──────────────────────────────────────
    const slopes = PROFILE_FIELDS.map(
      (f) => fieldDrift[f]?.gt_divergence_slope ?? null,
    ).filter((s): s is number => s !== null);

    const icF1s = PROFILE_FIELDS.map(
      (f) => fieldDrift[f]?.internal_consistency?.f1 ?? null,
    ).filter((f): f is number => f !== null);

    charResults.push({
      alias,
      real_name: realName,
      difficulty_tier: charRecord.difficultyTier,
      segments: segmentResults,
      field_drift: fieldDrift as Record<ProfileField, FieldDriftScore>,
      mean_gt_divergence_slope:
        slopes.length > 0 ? slopes.reduce((s, v) => s + v, 0) / slopes.length : null,
      mean_internal_consistency_f1:
        icF1s.length > 0 ? icF1s.reduce((s, v) => s + v, 0) / icF1s.length : null,
    });
  }

  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    scenario_difficulty: scenario.difficulty_level,
    scenario_stress_axes: scenario.stress_axes,
    segment_count: config.segments,
    characters: charResults,
  };
}
