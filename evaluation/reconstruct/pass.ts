import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadReconstructConfig } from "./config";
import { runReconstructionForConversation } from "./index";
import { initReconstructOutputDir, writeReconstructResults, writeSummary } from "./writer";
import { computeSummary } from "./scoring";
import { loadConversationEntries } from "../shared/loader";
import { PASS_DIRS } from "../shared/constants";
import { CostTracker } from "../cost/tracker";
import { fetchPassCosts } from "../cost/fetcher";
import { buildFailureBlock } from "../utils";
import { track, permanentWrite } from "../progress";
import type { CharacterRecord, ScenarioRecord } from "../generator/config";
import type { ConversationReconstructionResult } from "./types";

import rawCharacters from "../dataset/characters.yaml";
import rawScenarios from "../dataset/scenarios.yaml";

const ALL_CHARACTERS = rawCharacters as CharacterRecord[];
const ALL_SCENARIOS = rawScenarios as ScenarioRecord[];

export async function runReconstructionPass(configPath: string, evalName: string, datasetDir?: string): Promise<void> {
  const rawConfigText = readFileSync(configPath, "utf-8");
  const config = loadReconstructConfig(rawConfigText, evalName, undefined, datasetDir);
  const apiKey = process.env["LLM_API_KEY"]!;

  const outputDir = initReconstructOutputDir(config.evalDir, config);
  const tracker = new CostTracker();

  try {
    const entries = loadConversationEntries(config.conversationsDir);

    const handle = track("reconstruct", entries.length);

    const processable = entries.filter(({ file, result, i }) => {
      if (!result.messages || result.messages.length === 0) {
        handle.print(`[${i + 1}/${entries.length}] ${file} — skipped (failed conversation)`);
        return false;
      }
      return true;
    });

    if (processable.length === 0) {
      throw new Error("No processable conversations found — all files were skipped or empty.");
    }

    const allResults: ConversationReconstructionResult[] = await Promise.all(
      processable.map(async ({ file, result }, idx) => {
        const scenario = ALL_SCENARIOS.find((s) => s.id === result.scenario_id);
        if (!scenario) throw new Error(`Scenario "${result.scenario_id}" not found (from ${file})`);

        const characters = result.characters.map((c) => {
          const found = ALL_CHARACTERS.find((r) => r.id === c.id);
          if (!found) throw new Error(`Character "${c.id}" not found (from ${file})`);
          return found;
        });

        const label = `${result.scenario_id} · ${result.characters.map((c) => c.name).join(" + ")}`;
        const conversationId = file.replace(".yaml", "");

        const detail: string[] = [];
        try {
          const convResult = await runReconstructionForConversation(
            result, file, scenario, characters, config, apiKey, tracker, conversationId,
            (line) => detail.push(line),
          );
          handle.tick(true);
          return convResult;
        } catch (err) {
          const block = buildFailureBlock(
            "reconstruct",
            `[${idx + 1}/${processable.length}]`,
            err,
            detail,
          );
          handle.fail(block);
          handle.tick(false);
          throw new Error(`[${idx + 1}/${processable.length}] ${label} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }),
    );

    writeReconstructResults(outputDir, allResults);
    writeSummary(outputDir, computeSummary(allResults, config.comparators.map((c) => c.model), config.segments));

    const costsPath = join(config.evalDir, "costs", `${PASS_DIRS.reconstruct}.yaml`);
    await tracker.flush(costsPath);
    try { await fetchPassCosts(costsPath); } catch (err) {
      permanentWrite(`[costs] Cost fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true });
    process.stderr.write(`\nReconstruction failed — removed incomplete output: ${outputDir}\n`);
    throw err;
  }
}
