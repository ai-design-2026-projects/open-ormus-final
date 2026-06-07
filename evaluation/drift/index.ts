import OpenAI from "openai";
import { splitIntoSegments } from "./segment";
import {
  majorityVoteEngagement,
  majorityVoteAlignment,
  computeDriftDeltas,
} from "./scoring";
import { callJudge } from "./call";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./prompt";
import type {
  SegmentScore,
  CharacterAlignmentScore,
  ConversationDriftResult,
  ValidatedDriftConfig,
  EngagementLabel,
  AlignmentLabel,
} from "./types";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { CostTracker } from "../cost/tracker";

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
  const client = new OpenAI({ baseURL: `${config.baseUrl}/v1`, apiKey });

  const aliasToRecord = new Map<string, CharacterRecord>();
  for (const convChar of result.characters) {
    const record = characters.find((c) => c.id === convChar.id);
    if (!record) throw new Error(`Character "${convChar.id}" not found in dataset (${fileName})`);
    aliasToRecord.set(convChar.name, record);
  }

  const promptCharacters = result.characters.map((convChar) => {
    const record = aliasToRecord.get(convChar.name)!;
    return { id: convChar.id, name: record.name, archetype: record.archetype, record };
  });

  const messages = result.messages.map((m) => ({ ...m, reasoning: "", subtext: "" }));

  const realNameMessages = messages.map((m) => ({
    ...m,
    character_name:
      aliasToRecord.get(m.character_name)?.name ?? m.character_name,
  }));

  const segments = splitIntoSegments(realNameMessages, config.segments);
  const systemPrompt = buildJudgeSystemPrompt();
  const segmentScores: SegmentScore[] = [];
  let turnOffset = 0;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segMessages = segments[segIdx]!;
    const firstTurn = turnOffset + 1;
    const lastTurn = turnOffset + segMessages.length;
    turnOffset += segMessages.length;

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

    process.stdout.write(`  [seg ${segIdx + 1}/${segments.length}] judging…`);

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
      .filter((r): r is PromiseFulfilledResult<{ output: Awaited<ReturnType<typeof callJudge>>["output"]; usage: Awaited<ReturnType<typeof callJudge>>["usage"] }> =>
        r.status === "fulfilled",
      )
      .map((r) => r.value);

    for (const { usage } of successfulResults) {
      if (usage) {
        tracker.record({
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

    segmentScores.push({
      index: segIdx + 1,
      turn_range: [firstTurn, lastTurn],
      scenario_engagement: {
        label: engResult.label,
        votes: engVotes,
        confidence: engResult.confidence,
        score: engResult.score,
      },
      personality_alignment: alignmentScores,
      low_confidence: lowConfidence,
    });

    process.stdout.write(` ${engResult.label} (${successfulOutputs.length}/${config.judges.length} judges)\n`);
  }

  const { scenarioDrift, charDrifts } = computeDriftDeltas(segmentScores);

  return {
    conversation_file: fileName,
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    stress_axes: scenario.stress_axes,
    segments: segmentScores,
    drift: {
      scenario_engagement: scenarioDrift,
      personality_alignment: charDrifts,
    },
  };
}
