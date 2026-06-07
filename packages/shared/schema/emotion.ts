import { z } from "zod";

export const EmotionSchema = z.object({
  emotion: z.enum([
    "Joy", "Trust", "Fear", "Surprise",
    "Sadness", "Disgust", "Anger", "Anticipation",
  ]),
  intensity: z.enum(["low", "medium", "high"]),
  subtext: z.string().max(300),
});
export type Emotion = z.infer<typeof EmotionSchema>;

export function parseEmotionBlock(text: string): Emotion | null {
  const match = text.match(/<\|emotion\|>([\s\S]*?)<\|emotion\|>/);
  if (!match?.[1]) return null;
  try {
    const sanitized = match[1].replace(/\r?\n/g, " ");
    return EmotionSchema.parse(JSON.parse(sanitized));
  } catch {
    return null;
  }
}
