import { test, expect } from "bun:test";
import { mapRunEvent } from "./stream";

test("text delta maps to text_delta", () => {
  const event = {
    type: "raw_model_stream_event",
    data: { type: "output_text_delta", delta: "Hello" },
  } as never;
  expect(mapRunEvent(event)).toEqual({ type: "text_delta", text: "Hello" });
});

test("tool_called with empty args maps to tool_start with {}", () => {
  const event = {
    type: "run_item_stream_event",
    name: "tool_called",
    item: {
      type: "tool_call_item",
      rawItem: { name: "mcp__openormus__character_list", arguments: "{}" },
    },
  } as never;
  expect(mapRunEvent(event)).toEqual({
    type: "tool_start",
    tool: "mcp__openormus__character_list",
    input: {},
  });
});

test("tool_called with non-empty args parses arguments", () => {
  const event = {
    type: "run_item_stream_event",
    name: "tool_called",
    item: {
      type: "tool_call_item",
      rawItem: { name: "mcp__openormus__character_list", arguments: '{"query":"x"}' },
    },
  } as never;
  const chunk = mapRunEvent(event);
  expect(chunk?.type).toBe("tool_start");
  if (chunk?.type === "tool_start") {
    expect(chunk.input).toEqual({ query: "x" });
  }
});

test("tool_called with malformed args falls back to {}", () => {
  const event = {
    type: "run_item_stream_event",
    name: "tool_called",
    item: {
      type: "tool_call_item",
      rawItem: { name: "mcp__openormus__character_list", arguments: "{bad" },
    },
  } as never;
  const chunk = mapRunEvent(event);
  expect(chunk?.type).toBe("tool_start");
  if (chunk?.type === "tool_start") {
    expect(chunk.input).toEqual({});
  }
});

test("tool_output maps to tool_result with 300-char preview", () => {
  const bigstring = "x".repeat(500);
  const event = {
    type: "run_item_stream_event",
    name: "tool_output",
    item: {
      type: "tool_call_output_item",
      rawItem: { name: "mcp__openormus__character_list" },
      output: bigstring,
    },
  } as never;
  const chunk = mapRunEvent(event);
  expect(chunk?.type).toBe("tool_result");
  if (chunk?.type === "tool_result") {
    expect(chunk.tool).toBe("mcp__openormus__character_list");
    expect(chunk.preview.length).toBe(300);
  }
});

test("unrelated agent_updated_stream_event maps to null", () => {
  const event = { type: "agent_updated_stream_event" } as never;
  expect(mapRunEvent(event)).toBeNull();
});

test("unrelated run-item name maps to null", () => {
  const event = {
    type: "run_item_stream_event",
    name: "message_output_created",
    item: { type: "message_output_item", rawItem: {} },
  } as never;
  expect(mapRunEvent(event)).toBeNull();
});
