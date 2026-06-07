export class ProgressReporter {
  private completed = 0;
  private readonly total: number;
  private readonly label: string;
  private readonly allBuffers: string[][] = [];

  constructor(label: string, total: number) {
    this.label = label;
    this.total = total;
  }

  /** Create a per-item log buffer. Pass `(line) => buf.push(line)` as the log callback. */
  itemBuffer(): string[] {
    const buf: string[] = [];
    this.allBuffers.push(buf);
    return buf;
  }

  /** Call when one item (conversation) completes — updates the progress line on stderr. */
  tick(): void {
    this.completed++;
    process.stderr.write(`  [${this.label}] ${this.completed}/${this.total}\n`);
  }

  /** Flush all buffered item logs to stdout in insertion order. */
  flush(): void {
    for (const buf of this.allBuffers) {
      for (const line of buf) process.stdout.write(line);
    }
  }
}
