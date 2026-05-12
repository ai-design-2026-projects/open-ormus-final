import { z } from "zod";

// Raw shape — compatible with McpServer.tool() ZodRawShape parameter (v1 API)
export const CharacterCreateInputShape = {
  name: z.string().min(1),
  description: z.string(),
  traits: z.array(z.string()),
} as const;

export const CharacterCreateInputSchema = z.object(CharacterCreateInputShape);
export type CharacterCreateInput = z.infer<typeof CharacterCreateInputSchema>;

// Raw shape for record (used internally, not for tool input)
const CharacterRecordShape = {
  id: z.string(),
  name: z.string(),
  description: z.string(),
  traits: z.array(z.string()),
  createdAt: z.string(),
} as const;

export const CharacterRecordSchema = z.object(CharacterRecordShape);
export type CharacterRecord = z.infer<typeof CharacterRecordSchema>;
