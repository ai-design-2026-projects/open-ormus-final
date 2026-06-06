"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Monogram } from "@/components/ui/monogram";
import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import type { ToolRendererProps } from "../tool-call-block";
import type { MessageRecord } from "@open-ormus/shared";
import { MessageRecordSchema } from "@open-ormus/shared";
import { renderInline } from "@/lib/render-inline";

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={`bg-surface-sunk animate-pulse rounded-[var(--r-md)] ${className ?? ""}`} />
  );
}

const ConversationStartResultSchema = z.object({
  conversationId: z.string(),
  jobId: z.string(),
});

const ConversationJobStatusResultSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "awaiting_user"]),
  doneTurns: z.number(),
  totalTurns: z.number(),
  error: z.string().optional(),
  messages: z.array(MessageRecordSchema).optional(),
});

function statusTone(status: string): "ok" | "warn" | "flag" | "neutral" {
  if (status === "completed") return "ok";
  if (status === "failed") return "flag";
  if (status === "cancelled") return "neutral";
  return "warn"; // pending, running, awaiting_user
}

export function ConversationPanel({ input, result, isLoading }: ToolRendererProps) {
  const [turns, setTurns] = useState<MessageRecord[]>([]);
  const [streamStatus, setStreamStatus] = useState<string>("pending");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [doneTurns, setDoneTurns] = useState(0);
  const [totalTurns, setTotalTurns] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    if (isLoading || !result) return;

    // Extract jobId: from result for conversation_start, from input for conversation_job_status
    const startParsed = ConversationStartResultSchema.safeParse(result);
    const statusParsed = ConversationJobStatusResultSchema.safeParse(result);
    const inputJobId =
      typeof input === "object" &&
      input !== null &&
      "jobId" in input &&
      typeof (input as { jobId: unknown }).jobId === "string"
        ? (input as { jobId: string }).jobId
        : null;

    let jobId: string | null = null;

    if (startParsed.success) {
      jobId = startParsed.data.jobId;
    } else if (statusParsed.success) {
      // Pre-populate existing turns from job status result
      if (statusParsed.data.messages) {
        setTurns(statusParsed.data.messages);
      }
      setStreamStatus(statusParsed.data.status);
      setDoneTurns(statusParsed.data.doneTurns);
      setTotalTurns(statusParsed.data.totalTurns);
      // Only stream remaining turns if job is not already terminal
      const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
      if (!TERMINAL_STATUSES.has(statusParsed.data.status)) {
        jobId = inputJobId;
      }
    }

    if (!jobId) return;

    const es = new EventSource(`/api/conversations/jobs/${jobId}/stream`);

    es.addEventListener("turn", (e) => {
      const turn = JSON.parse(e.data) as MessageRecord;
      setTurns((prev) => [...prev, turn]);
    });

    es.addEventListener("status", (e) => {
      const s = JSON.parse(e.data) as {
        status: string;
        doneTurns: number;
        totalTurns: number;
      };
      setStreamStatus(s.status);
      setDoneTurns(s.doneTurns);
      setTotalTurns(s.totalTurns);
    });

    es.addEventListener("done", (e) => {
      const d = "data" in e ? JSON.parse((e as MessageEvent).data) as { status?: string } : null;
      if (d?.status) setStreamStatus(d.status);
      es.close();
    });

    es.addEventListener("error", (e) => {
      if ("data" in e) {
        const d = JSON.parse((e as MessageEvent).data) as { message: string };
        setStreamError(d.message);
      } else {
        setStreamError("Connection lost");
      }
      es.close();
    });

    return () => es.close();
  }, [isLoading, input, result]);

  if (isLoading) {
    return (
      <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] shadow-[var(--shadow-inset),var(--shadow-1)] overflow-hidden">
        <div className="bg-surface-2 border-b border-hair px-4 py-3 flex items-center justify-between">
          <Shimmer className="h-4 w-36" />
          <Shimmer className="h-5 w-16" />
        </div>
        <div className="divide-y divide-hair">
          <TurnSkeleton />
          <TurnSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-1 border border-hair rounded-[var(--r-lg)] shadow-[var(--shadow-inset),var(--shadow-1)] overflow-hidden">
      {/* Header */}
      <div className="bg-surface-2 border-b border-hair px-4 py-3 flex items-center justify-between">
        <div>
          <p className="t-body-s font-medium text-ink">Conversation</p>
          {totalTurns > 0 && (
            <p className="t-meta">{doneTurns}/{totalTurns} turns</p>
          )}
          {streamError && (
            <p className="t-meta text-signal-flag mt-0.5">{streamError}</p>
          )}
        </div>
        <Badge tone={statusTone(streamStatus)} className="capitalize">
          {streamStatus}
        </Badge>
      </div>

      {/* Turn feed */}
      <div className="max-h-72 overflow-y-auto scrollbar-paper divide-y divide-hair">
        {turns.length === 0 && (streamStatus === "running" || streamStatus === "pending") && (
          <>
            <TurnSkeleton />
            <TurnSkeleton />
          </>
        )}
        {turns.map((turn) => (
          <Turn key={turn.id} turn={turn} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function Turn({ turn }: { turn: MessageRecord }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <Monogram name={turn.characterName} size={28} shape="circle" flat />
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-1 mb-0.5">
          <span className="t-body-s font-medium text-ink">{turn.characterName}</span>
          {turn.emotion && (
            <Tag tone="neutral" className="ml-1">{turn.emotion}</Tag>
          )}
        </div>
        <p className="t-body-s text-ink-dim mt-0.5 whitespace-pre-wrap">{renderInline(turn.content)}</p>
      </div>
    </div>
  );
}

function TurnSkeleton() {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <div className="bg-surface-sunk animate-pulse rounded-full size-7 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="bg-surface-sunk animate-pulse rounded-[var(--r-md)] h-3 w-20" />
        <div className="bg-surface-sunk animate-pulse rounded-[var(--r-md)] h-2.5 w-full" />
        <div className="bg-surface-sunk animate-pulse rounded-[var(--r-md)] h-2.5 w-3/4" />
      </div>
    </div>
  );
}

