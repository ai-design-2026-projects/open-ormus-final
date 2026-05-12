import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CharacterCreateInputShape, type CharacterCreateInput, type CharacterRecord } from "@open-ormus/shared";
import { characterStore } from "../store.js";

export async function characterCreateHandler(
  args: CharacterCreateInput
): Promise<CharacterRecord> {
  const record: CharacterRecord = {
    id: crypto.randomUUID(),
    name: args.name,
    description: args.description,
    traits: args.traits,
    createdAt: new Date().toISOString(),
  };
  characterStore.set(record.id, record);
  return record;
}

export function register(server: McpServer): void {
  // @ts-expect-error -- CharacterCreateInputShape uses Zod v4; server.tool() expects Zod v3 ZodRawShape.
  // Structurally compatible at runtime. Tracked: AGENTS.md §11, resolves before M3-05.
  server.tool(
    "mcp__openormus__character_create",
    "Create a fictional character with a name, description, and personality traits",
    CharacterCreateInputShape,
    async (args: CharacterCreateInput) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await characterCreateHandler(args)),
        },
      ],
    })
  );
}
