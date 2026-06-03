// mcp_server/src/registry/tools/character_save.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSaveInputShape,
  TOOL_DESCRIPTIONS,
  type CharacterSaveInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { saveCharacter } from "@open-ormus/shared/services/character.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

export async function characterSaveHandler(
  args: CharacterSaveInput
): Promise<SavedCharacterRecord> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");
  return saveCharacter(prisma, userId, args);
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_create",
    TOOL_DESCRIPTIONS.character_create,
    CharacterSaveInputShape,
    async (args: CharacterSaveInput) => ({
      content: [{ type: "text" as const, text: JSON.stringify(await characterSaveHandler(args)) }],
    })
  );
}
