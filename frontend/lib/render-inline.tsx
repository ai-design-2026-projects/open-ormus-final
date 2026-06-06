import type { ReactNode } from "react";

/**
 * Splits text on *...*  markers and renders stage directions as italic+dimmed.
 * Works in any text-color context — uses opacity rather than a hardcoded token.
 */
export function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i} className="opacity-60">{part.slice(1, -1)}</em>;
    }
    return part || undefined;
  });
}
