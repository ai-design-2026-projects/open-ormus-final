import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationMessage } from "../generator/conversation";

const promptDir = join(import.meta.dirname, "prompts");
const systemTemplate = Handlebars.compile(readFileSync(join(promptDir, "system.hbs"), "utf8"));
const userTemplate = Handlebars.compile(readFileSync(join(promptDir, "user.hbs"), "utf8"));

export function buildJudgeSystemPrompt(): string {
  return systemTemplate({});
}

export function buildJudgeUserMessage(
  aliasMap: Record<string, string>,
  characters: CharacterRecord[],
  scenario: ScenarioRecord,
  messages: ConversationMessage[],
): string {
  const shuffled = deterministicShuffle(characters, scenario.id);
  return userTemplate({
    scenario: {
      title: scenario.title,
      context: scenario.context,
      initialPrompt: scenario.initial_prompt,
    },
    transcript: messages,
    profiles: shuffled.map((char, i) => ({
      profileNumber: i + 1,
      speechPatternsStr: char.speechPatterns.join("; "),
      notableQuotesStr: char.notableQuotes.map((q) => `"${q}"`).join(" | "),
      personalityTraitsStr: char.personalityTraits.join(", "),
      valuesStr: char.values.join(", "),
      goalsStr: char.goals.join(", "),
      fearsStr: char.fears.join(", "),
      copingStyleStr: char.copingStyle.join("; "),
      archetype: char.archetype,
      backstory: char.backstory,
    })),
    realNames: characters.map((c) => c.name),
    aliases: Object.keys(aliasMap),
  });
}

function deterministicShuffle<T>(arr: T[], seed: string): T[] {
  const copy = [...arr];
  let s = hashSeed(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function hashSeed(str: string): number {
  let h = 0x12345678;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h ^ str.charCodeAt(i), 2654435761) | 0) >>> 0;
  }
  return h;
}
