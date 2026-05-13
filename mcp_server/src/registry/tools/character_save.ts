import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSaveInputShape,
  type CharacterSaveInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

export async function characterSaveHandler(
  args: CharacterSaveInput
): Promise<SavedCharacterRecord> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const record = await prisma.character.create({
    data: {
      userId,
      name: args.name,
      sheet: args,
    },
  });

  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    sheet: args,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_save",
    "Save a character to your collection. Accepts the full character profile returned by character_search.",
    CharacterSaveInputShape,
    async (args: CharacterSaveInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterSaveHandler(args)),
        },
      ],
    })
  );
}
