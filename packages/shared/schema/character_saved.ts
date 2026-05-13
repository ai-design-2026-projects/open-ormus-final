import { z } from "zod";
import { CharacterPersonalitySchema, CharacterSearchResultSchema } from "./character_search";

// Zod v4 z.string().uuid() enforces RFC 4122 version nibble [1-8], which rejects
// some valid-looking UUIDs (e.g. 00000000-0000-0000-0000-000000000001). Using a
// lenient regex that checks UUID shape without constraining the version nibble.
const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Invalid UUID"
  );

// Save input — mirrors CharacterSearchResult fields
export const CharacterSaveInputShape = {
  name: z.string().min(1),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
  personality: CharacterPersonalitySchema,
} as const;

export const CharacterSaveInputSchema = z.object(CharacterSaveInputShape);
export type CharacterSaveInput = z.infer<typeof CharacterSaveInputSchema>;

// Update input — full sheet replacement
export const CharacterUpdateInputShape = {
  id: uuidSchema,
  sheet: CharacterSearchResultSchema,
} as const;

export const CharacterUpdateInputSchema = z.object(CharacterUpdateInputShape);
export type CharacterUpdateInput = z.infer<typeof CharacterUpdateInputSchema>;

// Delete input
export const CharacterDeleteInputShape = {
  id: uuidSchema,
} as const;

export const CharacterDeleteInputSchema = z.object(CharacterDeleteInputShape);
export type CharacterDeleteInput = z.infer<typeof CharacterDeleteInputSchema>;

// DB record returned to callers
export const SavedCharacterRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string(),
  sheet: CharacterSearchResultSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedCharacterRecord = z.infer<typeof SavedCharacterRecordSchema>;

// DB search input — fuzzy similarity on name and shortDescription
export const CharacterDbSearchInputShape = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
} as const;

export const CharacterDbSearchInputSchema = z.object(CharacterDbSearchInputShape);
export type CharacterDbSearchInput = z.infer<typeof CharacterDbSearchInputSchema>;
