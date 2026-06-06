"use client";
import { useState } from "react";
import type { EvalMeta } from "@/lib/eval-access";

export function ConfigPanel({ meta }: { meta: EvalMeta }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b px-6 py-2 text-[13px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="text-[10px]">{open ? "▼" : "▶"}</span>
        <span>Config</span>
      </button>

      {open && (
        <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-[12px] pb-2">
          {/* Generate pass */}
          {meta.passes?.generate && (
            <>
              <span className="text-muted-foreground">Model</span>
              <span>{meta.passes.generate.model ?? "—"}</span>
              {meta.passes.generate.turn_strategy && (
                <>
                  <span className="text-muted-foreground">Turn strategy</span>
                  <span>{meta.passes.generate.turn_strategy}</span>
                </>
              )}
              {meta.passes.generate.runs !== undefined && (
                <>
                  <span className="text-muted-foreground">Runs</span>
                  <span>{meta.passes.generate.runs}</span>
                </>
              )}
            </>
          )}

          {/* Judge pass */}
          {meta.passes?.judge && (
            <>
              <span className="text-muted-foreground">Judge model</span>
              <span>{meta.passes.judge.model ?? "—"}</span>
              {meta.passes.judge.judges !== undefined && (
                <>
                  <span className="text-muted-foreground">Judges</span>
                  <span>{meta.passes.judge.judges}</span>
                </>
              )}
            </>
          )}

          {/* Reconstruct pass */}
          {meta.passes?.reconstruct && (
            <>
              <span className="text-muted-foreground">Reconstructor</span>
              <span>{meta.passes.reconstruct.reconstructor ?? "—"}</span>
              {meta.passes.reconstruct.comparators && (
                <>
                  <span className="text-muted-foreground">Comparators</span>
                  <span>{meta.passes.reconstruct.comparators.join(", ")}</span>
                </>
              )}
              {meta.passes.reconstruct.segments !== undefined && (
                <>
                  <span className="text-muted-foreground">Segments</span>
                  <span>{meta.passes.reconstruct.segments}</span>
                </>
              )}
            </>
          )}

          {/* Drift pass */}
          {meta.passes?.drift && (
            <>
              {meta.passes.drift.models && (
                <>
                  <span className="text-muted-foreground">Drift models</span>
                  <span>{meta.passes.drift.models.join(", ")}</span>
                </>
              )}
              {meta.passes.drift.judges !== undefined && (
                <>
                  <span className="text-muted-foreground">Drift judges</span>
                  <span>{meta.passes.drift.judges}</span>
                </>
              )}
              {meta.passes.drift.segments !== undefined && (
                <>
                  <span className="text-muted-foreground">Drift segments</span>
                  <span>{meta.passes.drift.segments}</span>
                </>
              )}
            </>
          )}

          {/* Timestamps */}
          {meta.created_at && (
            <>
              <span className="text-muted-foreground">Eval run at</span>
              <span>{new Date(meta.created_at).toLocaleString()}</span>
            </>
          )}
          {meta.dataset_dir && (
            <>
              <span className="text-muted-foreground">Dataset</span>
              <span>{meta.dataset_dir}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
