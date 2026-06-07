import { describe, test, expect } from "bun:test";
import { formatRetryReason, callWithRetry } from "../call";
import type OpenAI from "openai";

type ChunkSpec =
  | "empty"
  | "bad_json"
  | { content: string; usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } }; id?: string };

function makeStreamClient(responses: ChunkSpec[]): OpenAI {
  let callIdx = 0;
  return {
    chat: {
      completions: {
        create: () => ({
          withResponse: async () => {
            const spec = responses[callIdx++] ?? "empty";
            async function* gen() {
              if (spec === "empty") {
                yield { choices: [{ delta: { content: "" } }], usage: null, id: "id-empty" };
              } else if (spec === "bad_json") {
                yield { choices: [{ delta: { content: "not valid json at all" } }], usage: null, id: "id-bad" };
              } else {
                yield { choices: [{ delta: { content: spec.content } }], usage: spec.usage ?? null, id: spec.id ?? "id-ok" };
              }
            }
            return { data: gen(), response: { headers: new Headers() } };
          },
        }),
      },
    },
  } as unknown as OpenAI;
}

describe("formatRetryReason", () => {
  test("empty response error", () => {
    const result = formatRetryReason(
      new Error("judge returned empty content on attempt 1")
    );
    expect(result).toBe("empty response");
  });

  test("JSON parse failure with preview", () => {
    const result = formatRetryReason(
      new Error('JSON parse failed. Raw response:\n{"bad": json}')
    );
    expect(result).toContain("JSON parse");
    expect(result).toContain('{"bad": json}');
  });

  test("schema validation error (array of messages)", () => {
    const errors = JSON.stringify([
      { message: "field required" },
      { message: "invalid type" },
    ]);
    const result = formatRetryReason(new Error(errors));
    expect(result).toBe("schema: field required; invalid type");
  });

  test("schema validation error with missing message fields", () => {
    const errors = JSON.stringify([
      { message: "required" },
      { code: "ERR_INVALID" }, // no message
    ]);
    const result = formatRetryReason(new Error(errors));
    expect(result).toBe("schema: required; unknown");
  });

  test("generic single-line error under 100 chars", () => {
    const result = formatRetryReason(new Error("connection timeout"));
    expect(result).toBe("connection timeout");
  });

  test("error exactly 100 chars returns as-is", () => {
    const msg = "a".repeat(100);
    const result = formatRetryReason(new Error(msg));
    expect(result).toBe(msg);
  });

  test("error longer than 100 chars gets truncated with ellipsis", () => {
    const longMsg = "a".repeat(150);
    const result = formatRetryReason(new Error(longMsg));
    expect(result).toBe("a".repeat(100) + "…");
  });

  test("multi-line error adds ellipsis if there are more lines", () => {
    const result = formatRetryReason(
      new Error("first line\nsecond line\nthird line")
    );
    expect(result).toBe("first line…");
  });

  test("multi-line error first line > 100 chars gets truncated", () => {
    const longFirstLine = "a".repeat(150);
    const result = formatRetryReason(new Error(`${longFirstLine}\nsecond`));
    expect(result).toBe("a".repeat(100) + "…");
  });

  test("non-Error thrown value (string)", () => {
    const result = formatRetryReason("something went wrong");
    expect(result).toBe("something went wrong");
  });

  test("non-Error thrown value (number)", () => {
    const result = formatRetryReason(42);
    expect(result).toBe("42");
  });

  test("null or undefined becomes empty string", () => {
    const result = formatRetryReason(null);
    expect(result).toBe("null");
  });

  test("JSON parse failure without JSON content", () => {
    const result = formatRetryReason(
      new Error("JSON parse failed. Raw response:\nno json here")
    );
    expect(result).toBe("JSON parse");
  });

  test("schema validation requires JSON to be parseable from full message", () => {
    // trimStart().startsWith("[") checks the trimmed message, but JSON.parse
    // needs the actual message text. If there's content after the JSON, parse fails
    // and falls back to returning first line with ellipsis
    const errors = JSON.stringify([
      { message: "error1" },
      { message: "error2" },
    ]);
    const multilineWithJson = `${errors}\nsome other content`;
    const result = formatRetryReason(new Error(multilineWithJson));
    // JSON.parse fails because there's "\nsome other content" after the array
    // so it falls back to first line (which is the JSON, ~50 chars) with ellipsis
    expect(result).toContain("…");
  });

  test("invalid JSON array-like string fallback to generic error", () => {
    const result = formatRetryReason(
      new Error("[\nthis is not valid json\n]")
    );
    // JSON.parse fails, so it falls back to returning first line ("[")
    // with ellipsis because the full message is longer
    expect(result).toBe("[…");
  });
});

describe("callWithRetry", () => {
  const identity = (v: unknown) => v as { ok: boolean };
  const noop = () => {};

  test("returns result and usage on first-attempt success", async () => {
    const client = makeStreamClient([{ content: '{"ok":true}' }]);
    const { result, usage } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", noop);
    expect(result).toEqual({ ok: true });
    expect(usage).toBeNull();
  });

  test("populates usage when chunk.usage is present", async () => {
    const client = makeStreamClient([{
      content: '{"ok":true}',
      usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 1 } },
    }]);
    const { usage } = await callWithRetry(client, "test-model", [], { type: "json_object" }, identity, "lbl", noop);
    expect(usage).not.toBeNull();
    expect(usage!.model).toBe("test-model");
    expect(usage!.inputTokens).toBe(10);
    expect(usage!.outputTokens).toBe(5);
    expect(usage!.cachedTokens).toBe(2);
    expect(usage!.reasoningTokens).toBe(1);
    expect(typeof usage!.latencyMs).toBe("number");
  });

  test("retries on empty content and succeeds on 2nd attempt", async () => {
    const client = makeStreamClient(["empty", { content: '{"ok":true}' }]);
    const logs: string[] = [];
    const { result } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", (l) => logs.push(l));
    expect(result).toEqual({ ok: true });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("empty response");
  });

  test("retries on bad JSON and succeeds on 2nd attempt", async () => {
    const client = makeStreamClient(["bad_json", { content: '{"ok":true}' }]);
    const logs: string[] = [];
    await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", (l) => logs.push(l));
    expect(logs[0]).toContain("JSON parse");
  });

  test("retries when parse callback throws", async () => {
    let parseCall = 0;
    const strictParse = (v: unknown) => {
      parseCall++;
      if (parseCall === 1) throw new Error("schema: field required");
      return v as { ok: boolean };
    };
    const client = makeStreamClient([{ content: '{"ok":true}' }, { content: '{"ok":true}' }]);
    const logs: string[] = [];
    const { result } = await callWithRetry(client, "m", [], { type: "json_object" }, strictParse, "lbl", (l) => logs.push(l));
    expect(result).toEqual({ ok: true });
    expect(logs[0]).toContain("schema: field required");
  });

  test("throws after all 3 retries fail", async () => {
    const client = makeStreamClient(["empty", "empty", "empty"]);
    await expect(
      callWithRetry(client, "m", [], { type: "json_object" }, identity, "my-label", noop),
    ).rejects.toThrow("[my-label] (m) all 3 attempts failed");
  });

  test("log callback receives one line per failed attempt", async () => {
    const client = makeStreamClient(["empty", "empty", "empty"]);
    const logs: string[] = [];
    await expect(
      callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", (l) => logs.push(l)),
    ).rejects.toThrow();
    expect(logs).toHaveLength(3);
  });

  test("generationId comes from x-generation-id header when present", async () => {
    const headers = new Headers({ "x-generation-id": "gen-abc" });
    const client = {
      chat: {
        completions: {
          create: () => ({
            withResponse: async () => {
              async function* gen() {
                yield { choices: [{ delta: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, id: "chunk-id" };
              }
              return { data: gen(), response: { headers } };
            },
          }),
        },
      },
    } as unknown as OpenAI;
    const { usage } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", noop);
    expect(usage!.generationId).toBe("gen-abc");
  });

  test("generationId falls back to first chunk id when header absent", async () => {
    const client = makeStreamClient([{ content: '{"ok":true}', usage: { prompt_tokens: 1, completion_tokens: 1 }, id: "chunk-fallback" }]);
    const { usage } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", noop);
    expect(usage!.generationId).toBe("chunk-fallback");
  });

  test("empty choices array yields empty content and is retried", async () => {
    let call = 0;
    const client = {
      chat: {
        completions: {
          create: () => ({
            withResponse: async () => {
              call++;
              async function* gen() {
                if (call === 1) {
                  yield { choices: [], usage: null, id: "id" };
                } else {
                  yield { choices: [{ delta: { content: '{"ok":true}' } }], usage: null, id: "id" };
                }
              }
              return { data: gen(), response: { headers: new Headers() } };
            },
          }),
        },
      },
    } as unknown as OpenAI;
    const logs: string[] = [];
    const { result } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", (l) => logs.push(l));
    expect(result).toEqual({ ok: true });
    expect(logs[0]).toContain("empty response");
  });

  test("network error from withResponse is retried", async () => {
    let call = 0;
    const client = {
      chat: {
        completions: {
          create: () => ({
            withResponse: async () => {
              call++;
              if (call === 1) throw new Error("ECONNREFUSED");
              async function* gen() {
                yield { choices: [{ delta: { content: '{"ok":true}' } }], usage: null, id: "id" };
              }
              return { data: gen(), response: { headers: new Headers() } };
            },
          }),
        },
      },
    } as unknown as OpenAI;
    const logs: string[] = [];
    const { result } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", (l) => logs.push(l));
    expect(result).toEqual({ ok: true });
    expect(logs[0]).toContain("ECONNREFUSED");
  });

  test("log line starts with '[label] (model) attempt N/MAX:' prefix", async () => {
    const client = makeStreamClient(["empty", "empty", { content: '{"ok":true}' }]);
    const logs: string[] = [];
    await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", (l) => logs.push(l));
    expect(logs[0]).toMatch(/^\[lbl\] \(m\) attempt 1\/3:/);
    expect(logs[1]).toMatch(/^\[lbl\] \(m\) attempt 2\/3:/);
  });

  test("cachedTokens is null when prompt_tokens_details is absent", async () => {
    const client = makeStreamClient([{
      content: '{"ok":true}',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }]);
    const { usage } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", noop);
    expect(usage!.cachedTokens).toBeNull();
  });

  test("reasoningTokens is null when completion_tokens_details is absent", async () => {
    const client = makeStreamClient([{
      content: '{"ok":true}',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }]);
    const { usage } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", noop);
    expect(usage!.reasoningTokens).toBeNull();
  });

  test("parses JSON wrapped in markdown code fences", async () => {
    const client = makeStreamClient([{ content: '```json\n{"ok":true}\n```' }]);
    const { result } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", noop);
    expect(result).toEqual({ ok: true });
  });

  test("assembles content from multiple delta chunks", async () => {
    const client = {
      chat: {
        completions: {
          create: () => ({
            withResponse: async () => {
              async function* gen() {
                yield { choices: [{ delta: { content: '{"ok"' } }], usage: null, id: "id" };
                yield { choices: [{ delta: { content: ":true}" } }], usage: { prompt_tokens: 5, completion_tokens: 2 }, id: "id" };
              }
              return { data: gen(), response: { headers: new Headers() } };
            },
          }),
        },
      },
    } as unknown as OpenAI;
    const { result, usage } = await callWithRetry(client, "m", [], { type: "json_object" }, identity, "lbl", noop);
    expect(result).toEqual({ ok: true });
    expect(usage!.inputTokens).toBe(5);
  });
});
