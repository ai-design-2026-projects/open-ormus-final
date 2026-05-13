import { z } from "zod";

// Input shape
export const ShowSearchInputShape = {
  query: z.string().min(1),
} as const;

export const ShowSearchInputSchema = z.object(ShowSearchInputShape);
export type ShowSearchInput = z.infer<typeof ShowSearchInputSchema>;

// Individual show result
export const ShowResultSchema = z.object({
  title: z.string(),
  description: z.string(),
  characters: z.array(z.string()),
  year: z.number().int().nullable(),
  genre: z.string().nullable(),
});

export type ShowResult = z.infer<typeof ShowResultSchema>;

// Full search results
export const ShowSearchResultSchema = z.object({
  results: z.array(ShowResultSchema).max(3),
});

export type ShowSearchResult = z.infer<typeof ShowSearchResultSchema>;
