import type { CharacterRecord } from "@open-ormus/shared";

// Shared in-memory store used by character_create and character_get tools.
// Keyed by character id. Seeded with fixtures so character_get has data to return.
export const characterStore = new Map<string, CharacterRecord>();

const fixtures: CharacterRecord[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Aria",
    description: "A curious wanderer with a gift for languages",
    traits: ["curious", "empathetic", "polyglot"],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Brann",
    description: "A stoic blacksmith who hides a turbulent past",
    traits: ["stoic", "skilled", "secretive"],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

for (const fixture of fixtures) {
  characterStore.set(fixture.id, fixture);
}
