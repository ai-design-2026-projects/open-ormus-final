import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Invalid UUID"
  );

export const TurnStrategySchema = z.enum(['ORCHESTRATOR', 'ROUND_ROBIN']);
export type TurnStrategy = z.infer<typeof TurnStrategySchema>;

export const CreateConversationInputSchema = z.object({
  title: z.string().min(1),
  context: z.string().min(1),
  characterIds: z.array(uuidSchema).min(1),
  turnStrategy: TurnStrategySchema.optional().default('ORCHESTRATOR'),
  userParticipates: z.boolean().optional().default(false),
  userTurnOrder: z.number().int().min(0).optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;

export const MessageRecordSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  characterId: uuidSchema.nullable(),
  authorUserId: uuidSchema.nullable(),
  characterName: z.string(),
  content: z.string(),
  reasoning: z.string().nullable(),
  emotion: z.string(),
  intensity: z.string(),
  subtext: z.string(),
  createdAt: z.string(),
});
export type MessageRecord = z.infer<typeof MessageRecordSchema>;

export const ConversationListItemSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  createdAt: z.string(),
  participants: z.array(
    z.object({
      characterId: uuidSchema,
      name: z.string(),
    })
  ),
  lastMessage: z
    .object({
      characterName: z.string(),
      content: z.string(),
      createdAt: z.string(),
    })
    .nullable(),
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

export const ConversationRecordSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  context: z.string(),
  turnStrategy: TurnStrategySchema,
  createdAt: z.string(),
  participants: z.array(
    z.object({
      characterId: uuidSchema.nullable(),
      name: z.string(),
      turnOrder: z.number().int().min(0),
      isUserParticipant: z.boolean(),
    })
  ),
  messages: z.array(MessageRecordSchema),
});
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;

export const ImproveContextInputSchema = z.object({
  draft: z.string().min(1),
  characterIds: z.array(uuidSchema).min(1),
  userParticipates: z.boolean().optional().default(false),
});
export type ImproveContextInput = z.infer<typeof ImproveContextInputSchema>;

export const ImproveContextOutputSchema = z.object({
  improved: z.string().min(1),
});
export type ImproveContextOutput = z.infer<typeof ImproveContextOutputSchema>;
