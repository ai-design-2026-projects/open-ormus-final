import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";
import type { CharacterRecord } from "../generator/config";

export type PromptCharacter = {
  id: string;
  name: string;
  archetype: string;
  record: CharacterRecord;
};

const promptDir = join(import.meta.dirname, "prompts");
const systemTemplate = Handlebars.compile(readFileSync(join(promptDir, "system.hbs"), "utf8"));
const userTemplate = Handlebars.compile(readFileSync(join(promptDir, "user.hbs"), "utf8"));

export function buildJudgeSystemPrompt(): string {
  return systemTemplate({});
}

export function buildJudgeUserPrompt(
  scenario: ScenarioRecord,
  characters: PromptCharacter[],
  priorMessages: ConversationMessage[],
  segmentMessages: ConversationMessage[],
  segmentIndex: number,
  totalSegments: number,
  firstTurn: number,
  lastTurn: number,
): string {
  return userTemplate({
    scenario: {
      stressAxes: scenario.stress_axes.join(", "),
      socialContext: scenario.social_context,
      pressureSource: scenario.pressure_source,
      initialPrompt: scenario.initial_prompt,
    },
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      archetype: c.archetype,
      traitsStr: c.record.personalityTraits.join(", "),
      valuesStr: c.record.values.join(", "),
      fearsStr: c.record.fears.join(", "),
      goalsStr: c.record.goals.join(", "),
      copingStr: c.record.copingStyle.join(", "),
      speechStr: c.record.speechPatterns.join(", "),
    })),
    hasPrior: priorMessages.length > 0,
    priorEnd: firstTurn - 1,
    priorMessages,
    segmentIndex,
    totalSegments,
    firstTurn,
    lastTurn,
    currentSegment: segmentMessages,
    characterIds: characters.map((c) => c.id).join(", "),
  });
}
