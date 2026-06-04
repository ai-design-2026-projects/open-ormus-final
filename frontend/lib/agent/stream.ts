import type { RunStreamEvent } from "@openai/agents";

export type StreamChunk =
  | { type: "session_created"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "error"; message: string }
  | { type: "done"; sessionId: string };

const encoder = new TextEncoder();

/** Encodes a StreamChunk as a Server-Sent Events data line. */
export function encodeChunk(chunk: StreamChunk): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}

/** Minimal shapes for the nested fields read off a RunStreamEvent. */
interface RawModelTextDelta {
  type: "raw_model_stream_event";
  data: { type: "output_text_delta"; delta: string };
}
interface RunItemToolCalled {
  type: "run_item_stream_event";
  name: "tool_called";
  item: { rawItem: { name?: string; arguments?: string } };
}
interface RunItemToolOutput {
  type: "run_item_stream_event";
  name: "tool_output";
  item: { rawItem: { name?: string }; output: unknown };
}

/**
 * Translates one SDK run-stream event into a StreamChunk, or null when the
 * event has no frontend representation.
 */
export function mapRunEvent(event: RunStreamEvent): StreamChunk | null {
  if (event.type === "raw_model_stream_event") {
    const data = (event as RawModelTextDelta).data;
    if (data?.type === "output_text_delta") {
      return { type: "text_delta", text: data.delta };
    }
    return null;
  }

  if (event.type === "run_item_stream_event") {
    if (event.name === "tool_called") {
      const { rawItem } = (event as RunItemToolCalled).item;
      let input: unknown = {};
      try {
        input = JSON.parse(rawItem.arguments ?? "{}");
      } catch {
        input = {};
      }
      return { type: "tool_start", tool: rawItem.name ?? "", input };
    }
    if (event.name === "tool_output") {
      const { item } = event as RunItemToolOutput;
      const raw = item.output;
      let result: unknown = raw;

      // Case 1: { content: [{ type: "text", text: "..." }] }
      if (
        typeof raw === "object" &&
        raw !== null &&
        "content" in raw &&
        Array.isArray((raw as { content: unknown[] }).content)
      ) {
        const first = (raw as { content: unknown[] }).content[0];
        if (
          typeof first === "object" &&
          first !== null &&
          "text" in first &&
          typeof (first as { text: unknown }).text === "string"
        ) {
          try {
            result = JSON.parse((first as { text: string }).text);
          } catch {
            result = (first as { text: string }).text;
          }
        }
      // Case 2: bare content item { type: "text", text: "..." }
      } else if (
        typeof raw === "object" &&
        raw !== null &&
        "text" in raw &&
        typeof (raw as { text: unknown }).text === "string"
      ) {
        try {
          result = JSON.parse((raw as { text: string }).text);
        } catch {
          result = (raw as { text: string }).text;
        }
      }
      return {
        type: "tool_result",
        tool: item.rawItem.name ?? "",
        result,
      };
    }
    return null;
  }

  return null;
}
