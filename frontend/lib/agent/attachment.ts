import { z } from "zod";

export const AttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  fileData: z.string().refine(
    (s) => s.startsWith("data:application/pdf;base64,"),
    { message: "fileData must be a PDF data URL (data:application/pdf;base64,...)" },
  ),
});

export type Attachment = z.infer<typeof AttachmentSchema>;
