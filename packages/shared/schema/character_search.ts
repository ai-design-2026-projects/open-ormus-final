import { z } from "zod";

// Input: search query
export const CharacterSearchInputShape = {
  query: z.string().min(1),
} as const;

export const CharacterSearchInputSchema = z.object(CharacterSearchInputShape);
export type CharacterSearchInput = z.infer<typeof CharacterSearchInputSchema>;

// Step 1 result — basic character identity (5 fields, within Exa limit)
export const CharacterBasicsSchema = z.object({
  name: z.string(),
  imageUrl: z.string().nullable(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string().nullable(),
});
export type CharacterBasics = z.infer<typeof CharacterBasicsSchema>;

// Input for the details step (after basics are known)
export const CharacterDetailsInputSchema = z.object({
  query: z.string().min(1),
  name: z.string().min(1),
  shortDescription: z.string(),
});
export type CharacterDetailsInput = z.infer<typeof CharacterDetailsInputSchema>;

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
  imageUrl: z.string().nullable().optional(),
  shortDescription: z.string(),
  firstAppearanceDate: z.string().nullable(),
  personality: CharacterPersonalitySchema,
} as const;

export const CharacterSearchResultSchema = z.object(CharacterSearchResultShape);
export type CharacterSearchResult = z.infer<typeof CharacterSearchResultSchema>;
