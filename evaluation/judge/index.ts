import OpenAI from "openai";
import { callJudge } from "./call";
import { buildJudgeSystemPrompt, buildJudgeUserMessage } from "./prompt";
import type { AliasMap } from "./alias";
import type { CharacterRecord, ScenarioRecord } from "../runner/config";
import type { ConversationResult } from "../runner/conversation";
import type { JudgeResult, JudgeAssignmentResult, GuessingScenarioResult } from "./types";
import type { JudgeConfig } from "./config";

export async function runJudges(
  result: ConversationResult,
  aliasMap: AliasMap,
  characters: CharacterRecord[],
  scenario: ScenarioRecord,
  judges: JudgeConfig[],
  baseUrl: string,
  apiKey: string,
): Promise<GuessingScenarioResult> {
  if (judges.length === 0) {
    return {
      scenario_id: result.scenario_id,
      scenario_title: result.scenario_title,
      judges: [],
    };
  }

  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey });

  const systemPrompt = buildJudgeSystemPrompt();
  const userMessage = buildJudgeUserMessage(aliasMap, characters, scenario, result.messages);

  const judgeResults: JudgeResult[] = [];

  for (const judgeConfig of judges) {
    process.stdout.write(`  [${judgeConfig.label}] ${judgeConfig.model}… `);

    const output = await callJudge(client, judgeConfig.model, systemPrompt, userMessage, judgeConfig.label);

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
    judgeResults.push({ label: judgeConfig.label, model: judgeConfig.model, assignments, all_correct });

    const wrongCount = assignments.filter((a) => !a.correct).length;
    console.log(all_correct ? "✓ all correct" : `✗ ${wrongCount}/${assignments.length} wrong`);
  }

  return {
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    judges: judgeResults,
  };
}
