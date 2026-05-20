import { z } from "zod";

export const EmotionSchema = z.object({
  emotion: z.enum([
    "Joy", "Trust", "Fear", "Surprise",
    "Sadness", "Disgust", "Anger", "Anticipation",
  ]),
  intensity: z.enum(["low", "medium", "high"]),
  subtext: z.string().max(120),
});
export type Emotion = z.infer<typeof EmotionSchema>;

export function parseEmotionBlock(text: string): Emotion | null {
  const match = text.match(/<emotion>([\s\S]*?)<\/emotion>/);
  if (!match?.[1]) return null;
  try {
    return EmotionSchema.parse(JSON.parse(match[1]));
  } catch {
    return null;
  }
}
