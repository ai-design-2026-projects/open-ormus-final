import { z } from "zod";

export const SceneSimulateInputShape = {
  characterIds: z.array(z.string()).min(1),
  setting: z.string(),
  prompt: z.string(),
} as const;

export const SceneSimulateInputSchema = z.object(SceneSimulateInputShape);
export type SceneSimulateInput = z.infer<typeof SceneSimulateInputSchema>;

const DialogueLineSchema = z.object({
  characterId: z.string(),
  line: z.string(),
});

const SceneResultShape = {
  sceneId: z.string(),
  setting: z.string(),
  prompt: z.string(),
  dialogue: z.array(DialogueLineSchema),
} as const;

export const SceneResultSchema = z.object(SceneResultShape);
export type SceneResult = z.infer<typeof SceneResultSchema>;
