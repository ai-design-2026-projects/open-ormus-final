import { test, expect } from "bun:test";
import { itemsToRows, rowsToItems } from "./history";
import type { AgentInputItem } from "@openai/agents";

test("user + assistant items survive a rows round-trip", () => {
  const items = [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "output_text", text: "hello" }] },
  ] as unknown as AgentInputItem[];
  const rows = itemsToRows("session-1", items);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.sessionId).toBe("session-1");
  expect(rows[0]?.role).toBe("user");
  expect(rows[0]?.content).toBe("hi");
  const restored = rowsToItems(rows.map((r) => ({ role: r.role, content: r.content, item: r.item })));
  expect(restored).toEqual(items);
});

test("function-call item (no role) round-trips and is keyed by type", () => {
  const items = [
    { type: "function_call", callId: "c1", name: "tool_x", arguments: "{}" },
  ] as unknown as AgentInputItem[];
  const rows = itemsToRows("s", items);
  expect(rows[0]?.role).toBe("function_call");
  const restored = rowsToItems(rows.map((r) => ({ role: r.role, content: r.content, item: r.item })));
  expect(restored).toEqual(items);
});

test("rows with null item are skipped on read", () => {
  const restored = rowsToItems([{ role: "user", content: "x", item: null }]);
  expect(restored).toEqual([]);
});
