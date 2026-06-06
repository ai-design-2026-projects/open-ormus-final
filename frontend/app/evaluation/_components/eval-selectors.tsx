"use client";
import { useRouter } from "next/navigation";
import type { DatasetEntry } from "@/lib/eval-access";

export function EvalSelectors({
  datasets,
  selectedDataset,
  selectedEval,
}: {
  datasets: DatasetEntry[];
  selectedDataset: string;
  selectedEval: string;
}) {
  const router = useRouter();
  const datasetEntry = datasets.find((d) => d.dataset === selectedDataset);

  function onDatasetChange(dataset: string) {
    const firstEval = datasets.find((d) => d.dataset === dataset)?.evals[0]?.name ?? "";
    router.replace(`/evaluation?dataset=${dataset}&eval=${firstEval}`);
  }

  function onEvalChange(evalName: string) {
    router.replace(`/evaluation?dataset=${selectedDataset}&eval=${evalName}`);
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={selectedDataset}
        onChange={(e) => onDatasetChange(e.target.value)}
        className="text-[13px] border rounded-lg px-2 py-1 bg-background text-foreground"
      >
        {datasets.map((d) => (
          <option key={d.dataset} value={d.dataset}>{d.dataset}</option>
        ))}
      </select>
      <select
        value={selectedEval}
        onChange={(e) => onEvalChange(e.target.value)}
        className="text-[13px] border rounded-lg px-2 py-1 bg-background text-foreground"
      >
        {(datasetEntry?.evals ?? []).map((e) => (
          <option key={e.name} value={e.name}>
            {e.name}{e.meta.created_at ? ` · ${new Date(e.meta.created_at).toLocaleString()}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
