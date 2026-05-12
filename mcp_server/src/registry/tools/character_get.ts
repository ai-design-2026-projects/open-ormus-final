import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CharacterRecord } from "@open-ormus/shared";
import { characterStore } from "../store.js";

const CharacterGetInputShape = {
  id: z.string(),
} as const;

type CharacterGetResult = CharacterRecord | { error: "not_found" };

export async function characterGetHandler(args: {
  id: string;
}): Promise<CharacterGetResult> {
  const record = characterStore.get(args.id);
  if (!record) return { error: "not_found" };
  return record;
}

export function register(server: McpServer): void {
  server.tool(
    "mcp__openormus__character_get",
    "Retrieve a fictional character by id",
    CharacterGetInputShape,
    async (args: { id: string }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterGetHandler(args)),
        },
      ],
    })
  );
}
