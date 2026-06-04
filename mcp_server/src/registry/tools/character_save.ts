// mcp_server/src/registry/tools/character_save.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CharacterSaveInputShape,
  TOOL_DESCRIPTIONS,
  type CharacterSaveInput,
  type SavedCharacterRecord,
  type CharacterPicture,
} from "@open-ormus/shared";
import { saveCharacter } from "@open-ormus/shared/services/character.service";
import { processAndStorePictures } from "@open-ormus/shared/services/character_picture.service";
import { prisma } from "../../db.js";
import { userIdStorage } from "../../auth/context.js";
import { randomUUID } from "crypto";

export async function characterSaveHandler(
  args: CharacterSaveInput
): Promise<SavedCharacterRecord> {
  const userId = userIdStorage.getStore();
  if (!userId) throw new Error("userId not in context");

  const { imageUrl, ...sheetData } = args;

  let pictures: CharacterPicture[] = [];
  let characterId: string | undefined;

  if (imageUrl) {
    characterId = randomUUID();
    try {
      pictures = await processAndStorePictures(
        prisma,
        imageUrl,
        userId,
        characterId,
        {
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        }
      );
    } catch (err) {
      // Image unavailable — save character without pictures
      console.warn(`[character_save] picture fetch skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  return saveCharacter(prisma, userId, sheetData, pictures, characterId);
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
