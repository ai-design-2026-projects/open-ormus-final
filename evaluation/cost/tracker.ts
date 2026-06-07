import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { CostMeta, CostRecord } from "./types";

export class CostTracker {
  private records: CostRecord[] = [];

  record(meta: CostMeta): void {
    this.records.push({ ...meta, costUsd: null });
  }

  async flush(outputPath: string): Promise<void> {
    const dir = dirname(outputPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outputPath, stringifyYaml({ records: this.records }), "utf-8");
  }
}
