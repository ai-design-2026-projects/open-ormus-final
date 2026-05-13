import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SceneSimulateInputShape,
  type SceneSimulateInput,
  type SceneResult,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

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
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  // Validate all character IDs exist and belong to the user
  for (const id of args.characterIds) {
    const record = await prisma.character.findFirst({ where: { id, userId } });
    if (!record) {
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
