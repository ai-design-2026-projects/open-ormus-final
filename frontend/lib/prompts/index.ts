import Handlebars from "handlebars";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import "./helpers";
import type { CharacterSearchResult } from "@open-ormus/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templateSource = readFileSync(
  join(__dirname, "character-roleplay.hbs"),
  "utf-8"
);
const template = Handlebars.compile(templateSource);

export function buildCharacterPrompt(
  sheet: CharacterSearchResult,
  sceneContext: string
): string {
  return template({
    name: sheet.name,
    shortDescription: sheet.shortDescription,
    ...sheet.personality,
    sceneContext,
  });
}

export function buildReasoningSystemPrompt(): string {
  return `You are simulating a fictional character's unfiltered private thoughts at a single moment in a scene. Rules:
- First person only ("I", not the character's name)
- No dialogue — do not write what the character will say
- No stage directions
- No complete sentences required — fragments are fine
- Raw psychological state: what they feel, want, fear, are hiding
- 3 to 5 fragments only — stop when you have captured the core tension`;
}

export function buildReasoningUserMessage(
  sheet: CharacterSearchResult,
  historyText: string,
  characterName: string,
): string {
  const traits = [
    sheet.shortDescription,
    sheet.personality.values.length > 0 ? `Values: ${sheet.personality.values.join(", ")}` : null,
    sheet.personality.fears.length > 0 ? `Fears: ${sheet.personality.fears.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `Character: ${characterName}
${traits}

Conversation so far:
${historyText}

What is ${characterName} thinking and feeling right now, in this exact moment? What do they want? What are they holding back?`;
}
