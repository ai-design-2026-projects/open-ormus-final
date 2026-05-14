export type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; preview: string }
  | { type: "error"; message: string }
  | { type: "done"; sessionId: string };

const encoder = new TextEncoder();

/** Encodes a StreamChunk as a Server-Sent Events data line. */
export function encodeChunk(chunk: StreamChunk): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}
