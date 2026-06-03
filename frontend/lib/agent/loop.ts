import { Agent, Runner, MaxTurnsExceededError } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { type UsageContext } from "@/lib/llm-usage";
import { LlmUsageSource } from "@/lib/generated/prisma/client";
import { encodeChunk, mapRunEvent } from "./stream";
import { LoggingModel } from "./sdk";
import type { AgentMcpServer } from "./mcp_bridge";
import { AGENT_SYSTEM_PROMPT } from "./prompt";

export async function runAgent(
  priorItems: AgentInputItem[],
  userMessage: string,
  mcpServer: AgentMcpServer,
  onChunk: (data: Uint8Array) => void,
  ctx: UsageContext = { source: LlmUsageSource.AGENT_SESSION },
  signal?: AbortSignal,
): Promise<{ items: AgentInputItem[]; error: Error | null }> {
  const send = (chunk: Parameters<typeof encodeChunk>[0]) => {
    onChunk(encodeChunk(chunk));
  };

  const input: AgentInputItem[] = [
    ...priorItems,
    { role: "user", content: userMessage } as AgentInputItem,
  ];

  const agent = new Agent({
    name: "openormus",
    instructions: AGENT_SYSTEM_PROMPT,
    model: new LoggingModel(ctx),
    mcpServers: [mcpServer],
  });

  // Hard cap on tool-call rounds. Without it, a model that keeps emitting tool
  // calls loops forever and the request hangs. Configurable via env; 12 covers
  // legitimate multi-step flows.
  const MAX_TURNS = Number(process.env["AGENT_MAX_ITERATIONS"] ?? 12);

  // Captured error. Kept rather than thrown so the caller still persists the
  // items accumulated so far (user turn, prior assistant/tool rounds). Defaults
  // to `input` so the user turn returns even if the run throws before producing
  // any history.
  let error: Error | null = null;
  let finalItems: AgentInputItem[] = input;

  try {
    const stream = await new Runner().run(agent, input, {
      stream: true,
      maxTurns: MAX_TURNS,
      ...(signal ? { signal } : {}),
    });

    for await (const event of stream) {
      const chunk = mapRunEvent(event);
      if (chunk) send(chunk);
    }
    // Surface any terminal error raised during the run.
    await stream.completed;
    finalItems = stream.history;
  } catch (err) {
    // The thrown error carries the run state; recover the items completed so far
    // so partial work persists regardless of branch.
    const recovered = (err as { state?: { history?: AgentInputItem[] } }).state?.history;

    if (err instanceof MaxTurnsExceededError) {
      // Turn cap hit: a clean stop, not an error to surface.
      send({ type: "text_delta", text: "\n\n[Stopped: reached maximum tool-call rounds.]" });
    } else if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      // Client abort: clean stop; keep the partial turn for persistence.
    } else {
      error = err instanceof Error ? err : new Error("Agent run failed");
    }

    if (Array.isArray(recovered) && recovered.length > 0) finalItems = recovered;
  }

  return { items: finalItems, error };
}
