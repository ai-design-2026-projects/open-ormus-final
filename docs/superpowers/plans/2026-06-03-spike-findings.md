# Task 0 Spike — `@openai/agents` SDK Shape Findings

Date: 2026-06-03
Installed version: **`@openai/agents@0.11.6`** (in `frontend/package.json` as `"@openai/agents": "^0.11.6"`).

The meta-package `@openai/agents` re-exports everything from `@openai/agents-core@0.11.6`
and `@openai/agents-openai@0.11.6` (both pinned exact, bundled as transitive deps). All symbols
below are importable directly from `@openai/agents`; the **owning package** and the `.d.ts` source
path are noted per symbol.

> Bun installs into an isolated store. Real `.d.ts` paths used for this spike:
> - core: `node_modules/.bun/@openai+agents-core@0.11.6+<hash>/node_modules/@openai/agents-core/dist/`
> - openai: `node_modules/.bun/@openai+agents-openai@0.11.6+<hash>/node_modules/@openai/agents-openai/dist/`
>
> Paths below are written relative to each package's `dist/`.

Live verification: **NOT run.** Type extraction from the installed `.d.ts` is the deliverable;
running a live agent requires the MCP server up + an LLM API key and is deferred to the Task 7
manual checklist. No `_spike.ts` was created.

---

## 1. Streaming events

Source: `agents-core` `events.d.ts` (`RunStreamEvent` union); deltas/usage in
`agents-core` `types/protocol.d.ts`; alias in `types/helpers.d.ts`.

The async-iterable of a streamed run yields **`RunStreamEvent`**:

```ts
type RunStreamEvent =
  | RunRawModelStreamEvent     // type === "raw_model_stream_event"
  | RunItemStreamEvent         // type === "run_item_stream_event"
  | RunAgentUpdatedStreamEvent // type === "agent_updated_stream_event"
```

### 1a. Token text deltas — raw model stream event

```ts
class RunRawModelStreamEvent {
  readonly type = "raw_model_stream_event";
  data: ResponseStreamEvent;        // = StreamEvent (discriminated union)
  readonly source: string | undefined;
}
```

`ResponseStreamEvent` (`types/helpers.d.ts:14`) `= StreamEvent`, a discriminated union on `type`:

```ts
type StreamEvent =
  | { type: "output_text_delta"; delta: string }   // <-- text token delta
  | { type: "response_done"; response: {...usage...} }
  | { type: "response_started" }
  | { type: "model"; event: any }                  // StreamEventGenericItem (raw provider event)
```

**Text delta access path:** for an event `e: RunStreamEvent`:
`e.type === "raw_model_stream_event"` AND `e.data.type === "output_text_delta"`
→ the delta string is **`e.data.delta`**.

> Matches the plan's assumption (`raw_model_stream_event` + `data.type === "output_text_delta"`).
> Note: the delta field is **`delta`** (string), not nested further.

### 1b. Tool call started / tool output — run-item stream event

```ts
class RunItemStreamEvent {
  readonly type = "run_item_stream_event";
  name: RunItemStreamEventName;
  item: RunItem;
}

type RunItemStreamEventName =
  | 'message_output_created' | 'handoff_requested' | 'handoff_occurred'
  | 'tool_search_called' | 'tool_search_output_created'
  | 'tool_called'        // <-- tool call started
  | 'tool_output'        // <-- tool output produced
  | 'reasoning_item_created' | 'tool_approval_requested';
```

**DISCREPANCY vs plan.** The plan assumed item *event* discriminants `tool_call_item` /
`tool_call_output_item`. In 0.11.6 the run-item event has a fixed
`type === "run_item_stream_event"` and the discriminant is the **`name`** field:
use `name === "tool_called"` and `name === "tool_output"`.

Confusingly, the **`item.type`** values (the `RunItem` class discriminants — see below) ARE
`tool_call_item` / `tool_call_output_item`. So both strings exist but at different levels:
- event-level discriminant: `e.name` → `"tool_called"` / `"tool_output"`
- item-level discriminant: `e.item.type` → `"tool_call_item"` / `"tool_call_output_item"`

Match on `e.type === "run_item_stream_event"` then on `e.name` (or `e.item.type`).

### 1c. `RunItem` types and field paths

Source: `agents-core` `items.d.ts`. `RunItem` union:
`RunMessageOutputItem | RunToolCallItem | RunToolSearchCallItem | RunToolSearchOutputItem |
RunReasoningItem | RunHandoffCallItem | RunToolCallOutputItem | RunHandoffOutputItem |
RunToolApprovalItem`.

**Tool call item** (`name === "tool_called"`):

```ts
class RunToolCallItem extends RunItemBase {
  readonly type: "tool_call_item";
  rawItem: protocol.ToolCallItem;   // for function tools: FunctionCallItem
  agent: Agent;
}
```
`FunctionCallItem` (`types/protocol.d.ts`):
```ts
{ type: "function_call"; callId: string; name: string; arguments: string; /* JSON string */
  namespace?: string; status?: "in_progress"|"completed"|"incomplete"; id?: string }
```
- **tool name:** `item.rawItem.name`
- **arguments:** `item.rawItem.arguments` (a **string**, JSON-encoded — `JSON.parse` it)
- **call id:** `item.rawItem.callId`

**Tool output item** (`name === "tool_output"`):

```ts
class RunToolCallOutputItem extends RunItemBase {
  readonly type: "tool_call_output_item";
  output: string | unknown;          // convenience accessor (already-extracted output)
  rawItem: protocol.FunctionCallResultItem | ComputerCallResultItem | ShellCallResultItem | ApplyPatchCallResultItem;
  agent: Agent<any, any>;
}
```
`FunctionCallResultItem`:
```ts
{ type: "function_call_result"; name: string; callId: string;
  status: "in_progress"|"completed"|"incomplete";
  output: string | { type:"text"; text } | { type:"image"; ... } | { type:"file"; ... } | InputContent[] }
```
- **output (simplest):** `item.output` (`string | unknown`)
- **tool name:** `item.rawItem.name`
- **call id:** `item.rawItem.callId`
- **structured output:** `item.rawItem.output` (string or content object/array)

---

## 2. Usage (per-call token usage)

Two surfaces — the **raw model event** and the aggregated **`Usage`** class.

### 2a. Raw per-response usage — inside `response_done`

Source: `agents-core` `types/protocol.d.ts` (`StreamEventResponseCompleted`).
From a raw model stream event with `data.type === "response_done"`:

```ts
data.response: {
  id: string;                 // <-- generation / response id
  requestId?: string;
  usage: {
    requests?: number;
    inputTokens: number;      // <-- prompt / input tokens
    outputTokens: number;     // <-- completion / output tokens
    totalTokens: number;
    inputTokensDetails?:  Record<string, number> | Array<Record<string, number>>;
    outputTokensDetails?: Record<string, number> | Array<Record<string, number>>;
    requestUsageEntries?: Array<{ inputTokens; outputTokens; totalTokens;
                                  inputTokensDetails?; outputTokensDetails?; endpoint? }>;
  };
  output: AgentOutputItem[];
}
```

- prompt/input tokens: `data.response.usage.inputTokens`
- completion/output tokens: `data.response.usage.outputTokens`
- response/generation id: `data.response.id`
- **cached tokens / reasoning tokens:** NOT first-class fields. They live inside the
  `inputTokensDetails` / `outputTokensDetails` **records** keyed by provider strings
  (OpenAI emits `cached_tokens` under input details and `reasoning_tokens` under output details).
  Read e.g. `usage.inputTokensDetails["cached_tokens"]` and
  `usage.outputTokensDetails["reasoning_tokens"]`. These keys are provider-dependent and may be
  absent; guard with `noUncheckedIndexedAccess` in mind.

> DISCREPANCY vs plan: the plan implied flat fields for cached/reasoning tokens. In 0.11.6 they are
> nested in the `*TokensDetails` records (string-keyed maps), not top-level. There is no dedicated
> `cachedTokens` / `reasoningTokens` field on `usage`.

### 2b. Aggregated `Usage` class (run-level)

Source: `agents-core` `usage.d.ts`. Exposed via `result.state.usage` (RunState) and on
`ModelResponse.usage` (`model.d.ts`: `ModelResponse = { usage: Usage; output; responseId?; requestId?; providerData? }`).

```ts
class Usage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensDetails:  Array<Record<string, number>>;   // note: ARRAY at aggregate level
  outputTokensDetails: Array<Record<string, number>>;
  requestUsageEntries: RequestUsage[] | undefined;       // per-request breakdown
}
class RequestUsage {
  inputTokens; outputTokens; totalTokens;
  inputTokensDetails: Record<string, number>;
  outputTokensDetails: Record<string, number>;
  endpoint?: 'responses.create' | 'responses.compact' | (string & {});
}
```
For per-call detail/cost, iterate `usage.requestUsageEntries`.

---

## 3. Model wrapper — `OpenAIChatCompletionsModel`

Source: `agents-openai` `openaiChatCompletionsModel.d.ts`. Package: `@openai/agents-openai`.

```ts
import OpenAI from 'openai';
import { Model, ModelRequest, ModelResponse, ResponseStreamEvent } from '@openai/agents-core';

type OpenAIChatCompletionsModelOptions = { strictFeatureValidation?: boolean };

class OpenAIChatCompletionsModel implements Model {
  constructor(client: OpenAI, model: string, options?: OpenAIChatCompletionsModelOptions);
  getRetryAdvice(args: ModelRetryAdviceRequest): ModelRetryAdvice | undefined;
  getResponse(request: ModelRequest): Promise<ModelResponse>;
  getStreamedResponse(request: ModelRequest): AsyncIterable<ResponseStreamEvent>;
}
```

To subclass: `super(client, model, options?)`; override
`getStreamedResponse(request: ModelRequest): AsyncIterable<ResponseStreamEvent>`
(an async generator). `ResponseStreamEvent = StreamEvent` (the `output_text_delta`/`response_done`/… union from §1).
`ModelResponse = { usage: Usage; output: AgentOutputItem[]; responseId?: string; requestId?: string; providerData?: Record<string,any> }`.

> Constructor takes **positional** args `(client, model, options?)` — NOT a single options object.

---

## 4. MCP — `MCPServerStreamableHttp`

Source: `agents-core` `mcp.d.ts`. Package: `@openai/agents-core` (re-exported from `@openai/agents`).

```ts
interface MCPServerStreamableHttpOptions {
  url: string;                       // <-- endpoint URL
  name?: string;                     // <-- label/name
  cacheToolsList?: boolean;
  clientSessionTimeoutSeconds?: number;
  logger?: Logger;
  toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
  toolMetaResolver?: MCPToolMetaResolver;
  errorFunction?: MCPToolErrorFunction | null;
  timeout?: number;
  authProvider?: any;
  requestInit?: any;                 // <-- custom HTTP headers go here: { headers: {...} }
  fetch?: any;
  reconnectionOptions?: any;
  sessionId?: string;
}

class MCPServerStreamableHttp /* implements MCPServerWithResources */ {
  constructor(options: MCPServerStreamableHttpOptions);
  readonly name: string;
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(toolName: string, args: Record<string, unknown> | null,
           meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
}
```

Confirmed: accepts `url`, `name`, and custom headers via **`requestInit`** (standard fetch
`RequestInit`, so `requestInit: { headers: { Authorization: ... } }`). Methods: `connect()`,
`close()`, `listTools()` (returns `MCPTool[]`). No `headers` top-level option — use `requestInit`.

To attach to an agent: `new Agent({ ..., mcpServers: [server] })` (`agent.d.ts`: `mcpServers: MCPServer[]`).

---

## 5. Config functions

| Function | Package | Source | Signature |
| --- | --- | --- | --- |
| `setDefaultOpenAIClient` | `@openai/agents-openai` | `defaults.d.ts` | `(client: OpenAI): void` |
| `setOpenAIAPI` | `@openai/agents-openai` | `defaults.d.ts` | `(value: 'chat_completions' \| 'responses'): void` |
| `setTracingDisabled` | `@openai/agents-core` | `tracing/index.d.ts` | `(disabled: boolean): void` |

All three are re-exported from `@openai/agents`.

> Plan's assumption holds: `setOpenAIAPI("chat_completions")` takes a **string** literal
> (`'chat_completions' | 'responses'`), not an object.
> Extra: `setDefaultOpenAIKey(key)`, `setTracingExportApiKey(key)`,
> `setOpenAIResponsesTransport('http' | 'websocket')` also available from `agents-openai`.

---

## 6. Turn cap

Source: `agents-core` `run.d.ts` (options) + `errors.d.ts` (error class).

- Option name: **`maxTurns`** — `maxTurns?: number | null` on `SharedRunOptions`
  (both `StreamRunOptions` and `NonStreamRunOptions`).
- Error class: **`MaxTurnsExceededError`** — `import { MaxTurnsExceededError } from '@openai/agents'`.
  Extends `AgentsError` (abstract base). `AgentsError` carries `state?: RunState<...>` (see §7).

```ts
run(agent, input, { stream: true, maxTurns: 10 });
```

---

## 7. History / partial results

Source: `agents-core` `result.d.ts` (`StreamedRunResult` / `RunResultBase`),
`runState.d.ts` (`RunState`), `errors.d.ts` (`AgentsError`).

- **Full conversation items after a completed run:** `stream.history` — getter on
  `RunResultBase` (so on both `RunResult` and `StreamedRunResult`):
  ```ts
  get history(): AgentInputItem[];
  ```
  Matches plan's `stream.history`. The item type is **`AgentInputItem`** (§8).
  Related accessors: `stream.output` (`AgentOutputItem[]`), `stream.newItems` (`RunItem[]`),
  `stream.finalOutput`, `stream.lastResponseId`, `stream.input`.

- **`StreamedRunResult`** is `AsyncIterable<RunStreamEvent>`. Other members:
  `currentTurn: number`, `maxTurns: number | null | undefined`, `get completed(): Promise<void>`,
  `get error(): unknown`, `get cancelled(): boolean`, `toStream()`, `toTextStream()`,
  `[Symbol.asyncIterator]()`.

- **Items completed so far on abort/error mid-run:** errors carry the run state.
  `AgentsError` (base of `MaxTurnsExceededError`, `ToolCallError`, etc.) has
  `state?: RunState<any, Agent<any, any>>`, and `RunState` exposes
  ```ts
  get history(): AgentInputItem[];   // runState.d.ts
  get usage(): Usage;
  get currentAgent(): TAgent;
  ```
  So on a caught error: **`error.state?.history`** → `AgentInputItem[]` of items so far,
  and `error.state?.usage` for tokens consumed before the failure.
  Matches plan's `error.state.history` (note `state` is optional → use `?.`).

---

## 8. Input items

Source: `agents-core` `run.d.ts` (run signature), `types/aliases.d.ts` (`AgentInputItem`),
`types/protocol.d.ts` (`UserMessageItem`).

`Runner.run` / top-level `run` input type:

```ts
run(agent, input: string | AgentInputItem[] | RunState<...>, options?)
```

`AgentInputItem` (`types/aliases.d.ts`) is a union:

```ts
type AgentInputItem =
  | UserMessageItem | AssistantMessageItem | SystemMessageItem
  | ToolSearchCallItem | ToolSearchOutputItem | HostedToolCallItem
  | FunctionCallItem | ComputerUseCallItem | ShellCallItem | ApplyPatchCallItem
  | FunctionCallResultItem | ComputerCallResultItem | ShellCallResultItem | ApplyPatchCallResultItem
  | ReasoningItem | CompactionItem | UnknownItem;
```

**User message item shape** (`UserMessageItem`):

```ts
{
  role: "user";
  type?: "message";                       // optional literal
  id?: string;
  content: string | Array<UserContent>;   // string shorthand OR content array
  providerData?: Record<string, any>;
}
```
`UserContent` array items (discriminated on `type`):
`{ type: "input_text"; text: string }` | `{ type: "input_image"; image?; detail? }` |
`{ type: "input_file"; file?; filename? }` | `{ type: "audio"; audio; format?; transcript? }`.

Minimal user turn:
```ts
const input: AgentInputItem[] = [
  { role: "user", content: "hello" },
  // or: { role: "user", content: [{ type: "input_text", text: "hello" }] }
];
```
Assistant content uses `type: "output_text"` (note: output side, vs `input_text` on user side).

---

## 9. Summary of discrepancies vs the plan's assumptions

1. **Run-item event discriminant** — plan assumed item types `tool_call_item` /
   `tool_call_output_item` at the event level. In 0.11.6 the *event* is
   `type === "run_item_stream_event"` discriminated by **`name`** (`"tool_called"` /
   `"tool_output"`). The `tool_call_item` / `tool_call_output_item` strings exist only as
   **`item.type`** (the `RunItem` class discriminant). Later code must match on
   `e.name` (or `e.item.type`), not on `e.type`.
2. **Cached / reasoning tokens** — not flat fields. They are string-keyed entries inside
   `usage.inputTokensDetails` / `usage.outputTokensDetails` (records on the raw event /
   `RequestUsage`; arrays-of-records on the aggregate `Usage`). Provider-dependent keys
   (`cached_tokens`, `reasoning_tokens`). No dedicated property.
3. **`OpenAIChatCompletionsModel` constructor** is positional `(client, model, options?)`, not an
   options object.
4. **MCP custom headers** go through `requestInit` (fetch `RequestInit`), there is no top-level
   `headers` option.
5. **`error.state` is optional** (`state?: RunState`) on `AgentsError` — access with `?.`.

Confirmed matching the plan: `raw_model_stream_event` + `data.type === "output_text_delta"` +
`data.delta`; `setOpenAIAPI("chat_completions")` (string); `stream.history`;
`error.state.history`; `maxTurns` + `MaxTurnsExceededError`.
