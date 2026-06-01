import type { AnthropicTool } from "../types";

export const wizardTool: AnthropicTool = {
  name: "start_character_wizard",
  description:
    "Start the step-by-step wizard to create a custom original character from scratch. " +
    "Call this when the user wants to create a character without searching online. " +
    "After this tool returns, follow the wizard instructions exactly: ask each question ONE AT A TIME, " +
    "wait for the user's answer before asking the next, then call mcp__openormus__character_save when done.",
  input_schema: { type: "object" as const, properties: {}, required: [] },
};

export function handleWizard(): string {
  return JSON.stringify({
    status: "wizard_started",
    instructions:
      "Ask the user these questions STRICTLY ONE AT A TIME in this order. " +
      "Do not ask the next question until the user has answered the current one. " +
      "1) What is the character's name? " +
      "2) What fictional universe do they come from, or are they an original creation? " +
      "3) List 3 to 5 core personality traits. " +
      "4) Summarise their backstory in 2 to 3 sentences. " +
      "5) Give 2 to 3 examples of their speech patterns or notable quotes. " +
      "6) What are their main goals and their deepest fears? " +
      "7) (Optional) Name any key relationships — the user can say 'none' or 'skip'. " +
      "After collecting all answers, call mcp__openormus__character_save with the assembled sheet. " +
      "Set firstAppearanceDate to null if not known. " +
      "Set imageUrl to null.",
  });
}
