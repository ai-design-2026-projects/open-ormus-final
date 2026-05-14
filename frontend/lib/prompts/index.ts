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
