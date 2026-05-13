import { z } from "zod";

// Input: search query
export const CharacterSearchInputShape = {
  query: z.string().min(1),
} as const;

export const CharacterSearchInputSchema = z.object(CharacterSearchInputShape);
export type CharacterSearchInput = z.infer<typeof CharacterSearchInputSchema>;

// Personality details
const CharacterPersonalityShape = {
  personalityTraits: z.array(z.string()),
  backstory: z.string(),
  relationships: z.record(z.string(), z.string()),
  speechPatterns: z.array(z.string()),
  values: z.array(z.string()),
  fears: z.array(z.string()),
  goals: z.array(z.string()),
  notableQuotes: z.array(z.string()),
  abilities: z.array(z.string()),
  copingStyle: z.array(z.string()),
  knowledgeScope: z.record(z.string(), z.string()),
} as const;

export const CharacterPersonalitySchema = z.object(CharacterPersonalityShape);
export type CharacterPersonality = z.infer<typeof CharacterPersonalitySchema>;

// Success result
const CharacterSearchResultShape = {
  name: z.string(),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string(),
  confidence: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
  personality: CharacterPersonalitySchema,
} as const;

export const CharacterSearchResultSchema = z.object(CharacterSearchResultShape);
export type CharacterSearchResult = z.infer<typeof CharacterSearchResultSchema>;
