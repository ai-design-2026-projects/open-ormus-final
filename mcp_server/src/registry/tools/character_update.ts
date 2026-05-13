import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterUpdateInputShape,
  type CharacterUpdateInput,
  type SavedCharacterRecord,
} from "@open-ormus/shared";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";

type UpdateResult = SavedCharacterRecord | { error: "not_found" };

export async function characterUpdateHandler(
  args: CharacterUpdateInput
): Promise<UpdateResult> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const updated = await prisma.character.updateMany({
    where: { id: args.id, userId },
    data: {
      name: args.sheet.name,
      sheet: args.sheet,
    },
  });
  if (updated.count === 0) return { error: "not_found" };

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const record = (await prisma.character.findUnique({ where: { id: args.id } }))!;

  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    sheet: args.sheet,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_update",
    "Update a saved character's full profile. Replaces the existing sheet entirely.",
    CharacterUpdateInputShape,
    async (args: CharacterUpdateInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterUpdateHandler(args)),
        },
      ],
    })
  );
}
