import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SceneSimulateInputShape,
  type SceneSimulateInput,
  type SceneResult,
} from "@open-ormus/shared";
import { characterStore } from "../store.js";

const CANNED_LINES = [
  "I greet you with cautious eyes.",
  "What brings you to this forsaken place?",
  "The world is vast, and yet here we are.",
  "Let us not waste what little time remains.",
] as const;

type SceneSimulateResult =
  | SceneResult
  | { error: "character_not_found"; id: string };

export async function sceneSimulateHandler(
  args: SceneSimulateInput
): Promise<SceneSimulateResult> {
  // Validate all character IDs exist
  for (const id of args.characterIds) {
    if (!characterStore.has(id)) {
      return { error: "character_not_found", id };
    }
  }

  const dialogue = args.characterIds.map((characterId, i) => ({
    characterId,
    line: CANNED_LINES[i % CANNED_LINES.length] ?? "...",
  }));

  return {
    sceneId: crypto.randomUUID(),
    setting: args.setting,
    prompt: args.prompt,
    dialogue,
  };
}

export function register(server: McpServer): void {
  // @ts-expect-error -- SceneSimulateInputShape uses Zod v4; server.tool() expects Zod v3 ZodRawShape.
  // Structurally compatible at runtime. Tracked: AGENTS.md §11, resolves before M3-05.
  server.tool(
    "mcp__openormus__scene_simulate",
    "Simulate a scene between fictional characters (stub — no LLM call yet)",
    SceneSimulateInputShape,
    async (args: SceneSimulateInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await sceneSimulateHandler(args)),
        },
      ],
    })
  );
}
