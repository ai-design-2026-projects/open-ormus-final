import OpenAI from "openai";
import { callJudge } from "./call";
import { buildJudgeSystemPrompt, buildJudgeUserMessage } from "./prompt";
import { termColors } from "../utils";
import type { AliasMap } from "./alias";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationResult } from "../generator/conversation";
import type { JudgeResult, JudgeAssignmentResult, GuessingScenarioResult } from "./types";
import type { JudgeConfig } from "./config";
import type { CostTracker } from "../cost/tracker";

const col = termColors();

export async function runJudges(
  result: ConversationResult,
  aliasMap: AliasMap,
  characters: CharacterRecord[],
  scenario: ScenarioRecord,
  judges: JudgeConfig[],
  baseUrl: string,
  apiKey: string,
  tracker: CostTracker,
  conversationId: string,
  log: (line: string) => void,
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

  return {
    scenario_id: result.scenario_id,
    scenario_title: result.scenario_title,
    judges: judgeResults,
  };
}
