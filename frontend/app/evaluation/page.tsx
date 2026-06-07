import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed, listDatasets } from "@/lib/eval-access";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppNav } from "@/components/app-shell/AppNav";
import { EvalSelectors } from "./_components/eval-selectors";
import { ConfigPanel } from "./_components/config-panel";
import { DatasetTab } from "./_components/dataset-tab";
import { GenerateTab } from "./_components/generate-tab";
import { JudgeTab } from "./_components/judge-tab";
import { ReconstructTab } from "./_components/reconstruct-tab";
import { DriftTab } from "./_components/drift-tab";
import { CostsTab } from "./_components/costs-tab";

export default async function EvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string; eval?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isEmailAllowed(user.email)) notFound();

  const params = await searchParams;
  const datasets = listDatasets();

  if (datasets.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <AppNav />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
          <p className="text-[15px] font-medium">No evaluation data yet</p>
          <p className="text-[13px] text-muted-foreground max-w-sm">
            Generate a dataset first, then run the evaluation pipeline.
          </p>
          <code className="text-[12px] bg-muted px-3 py-2 rounded-lg mt-1 text-left block max-w-sm whitespace-pre">
            {`bun evaluation/generate_dataset.ts evaluation/configs/generate-dataset.yaml\nbun evaluation/run_pipeline.ts <dataset-name>`}
          </code>
        </div>
      </div>
    );
  }

  const selectedDataset = params.dataset ?? datasets[0]!.dataset;
  const datasetEntry = datasets.find((d) => d.dataset === selectedDataset) ?? datasets[0]!;
  const selectedEval = params.eval ?? datasetEntry.evals[0]?.name ?? null;
  const evalEntry = datasetEntry.evals.find((e) => e.name === selectedEval) ?? datasetEntry.evals[0];

  return (
    <div className="min-h-screen flex flex-col">
      <AppNav />
      <div className="px-6 py-4 border-b flex items-center gap-4">
        <span className="font-medium text-[15px]">Evaluation</span>
        <EvalSelectors
          datasets={datasets}
          selectedDataset={selectedDataset}
          selectedEval={selectedEval ?? ""}
        />
      </div>

      {evalEntry ? (
        <>
          <ConfigPanel meta={evalEntry.meta} />
          <Tabs defaultValue="dataset" className="flex-1">
            <TabsList className="px-6 border-b rounded-none h-10 bg-transparent gap-1 justify-start">
              <TabsTrigger value="dataset">Dataset</TabsTrigger>
              <TabsTrigger value="generate">Generate</TabsTrigger>
              <TabsTrigger value="judge">Judge</TabsTrigger>
              <TabsTrigger value="reconstruct">Reconstruct</TabsTrigger>
              <TabsTrigger value="drift">Drift</TabsTrigger>
              <TabsTrigger value="costs">Costs</TabsTrigger>
            </TabsList>
            <TabsContent value="dataset" className="p-6">
              <DatasetTab />
            </TabsContent>
            <TabsContent value="generate" className="p-6">
              <GenerateTab dataset={selectedDataset} evalName={selectedEval ?? ""} />
            </TabsContent>
            <TabsContent value="judge" className="p-6">
              <JudgeTab dataset={selectedDataset} evalName={selectedEval ?? ""} />
            </TabsContent>
            <TabsContent value="reconstruct" className="p-6">
              <ReconstructTab dataset={selectedDataset} evalName={selectedEval ?? ""} />
            </TabsContent>
            <TabsContent value="drift" className="p-6">
              <DriftTab dataset={selectedDataset} evalName={selectedEval ?? ""} />
            </TabsContent>
            <TabsContent value="costs" className="p-6">
              <CostsTab dataset={selectedDataset} evalName={selectedEval ?? ""} />
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
          <p className="text-[15px] font-medium">No runs yet for {selectedDataset}</p>
          <p className="text-[13px] text-muted-foreground max-w-sm">
            Run the evaluation pipeline on this dataset.
          </p>
          <code className="text-[12px] bg-muted px-3 py-2 rounded-lg mt-1 text-left block max-w-sm">
            bun evaluation/run_pipeline.ts {selectedDataset}
          </code>
        </div>
      )}
    </div>
  );
}
