import Exa from "exa-js";

let _exa: Exa | null = null;

/**
 * Returns the shared Exa client. Throws at call time (not import time)
 * if EXA_API_KEY is missing — safe to import in environments without the key.
 */
export function getExa(): Exa {
  if (_exa) return _exa;
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "EXA_API_KEY environment variable is required. Set it in .env.local"
    );
  }
  _exa = new Exa(apiKey);
  return _exa;
}
