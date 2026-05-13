import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Invalid UUID"
  );

export const CreateConversationInputSchema = z.object({
  title: z.string().min(1),
  context: z.string().min(1),
  characterIds: z.array(uuidSchema).min(1),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;

export const MessageRecordSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  characterId: uuidSchema,
  characterName: z.string(),
  content: z.string(),
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
  createdAt: z.string(),
  participants: z.array(
    z.object({
      characterId: uuidSchema,
      name: z.string(),
      turnOrder: z.number().int().min(0),
    })
  ),
  messages: z.array(MessageRecordSchema),
});
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;
