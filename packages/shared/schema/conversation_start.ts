import { z } from "zod";
import { TurnStrategySchema, MessageRecordSchema } from "./conversation";

const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Invalid UUID"
  );

export const ConversationStartInputSchema = z.object({
  characterIds: z.array(uuidSchema).min(2).max(20),
  context: z.string().min(1),
  turnStrategy: TurnStrategySchema,
  turns: z.number().int().min(1).max(500),
  title: z.string().optional(),
});
export type ConversationStartInput = z.infer<typeof ConversationStartInputSchema>;
export const ConversationStartInputShape = ConversationStartInputSchema.shape;

export const ConversationJobStatusSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "awaiting_user"]),
  doneTurns: z.number().int(),
  totalTurns: z.number().int(),
  error: z.string().optional(),
  messages: z.array(MessageRecordSchema).optional(),
});
export type ConversationJobStatus = z.infer<typeof ConversationJobStatusSchema>;
