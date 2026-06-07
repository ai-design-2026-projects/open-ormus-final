export function termColors(tty = process.stdout.isTTY ?? false) {
  const e = tty ? (s: string) => s : () => "";
  return {
    reset:   e("\x1b[0m"),
    dim:     e("\x1b[2m"),
    green:   e("\x1b[32m"),
    red:     e("\x1b[31m"),
    boldRed: e("\x1b[1;31m"),
  };
}

/**
 * Extracts and parses a JSON object from an LLM response.
 * Handles: markdown code fences, trailing text, extra closing braces.
 */
export function parseJsonFromLlm(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {}

  const start = stripped.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < stripped.length; i++) {
      if (stripped[i] === "{") depth++;
      else if (stripped[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(stripped.slice(start, i + 1));
          } catch {}
          break;
        }
      }
    }
  }

  throw new Error(`No valid JSON object found`);
}
