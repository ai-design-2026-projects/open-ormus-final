import { test, expect } from "bun:test";
import { AttachmentSchema } from "./attachment";

test("accepts valid PDF data URL", () => {
  const result = AttachmentSchema.safeParse({
    filename: "doc.pdf",
    fileData: "data:application/pdf;base64,AAAA",
  });
  expect(result.success).toBe(true);
});

test("rejects non-PDF MIME type", () => {
  const result = AttachmentSchema.safeParse({
    filename: "doc.txt",
    fileData: "data:text/plain;base64,AAAA",
  });
  expect(result.success).toBe(false);
});

test("rejects empty filename", () => {
  const result = AttachmentSchema.safeParse({
    filename: "",
    fileData: "data:application/pdf;base64,AAAA",
  });
  expect(result.success).toBe(false);
});

test("rejects filename over 255 chars", () => {
  const result = AttachmentSchema.safeParse({
    filename: "a".repeat(256),
    fileData: "data:application/pdf;base64,AAAA",
  });
  expect(result.success).toBe(false);
});
