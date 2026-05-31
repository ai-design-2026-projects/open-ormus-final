import type { CharacterRecord } from "../runner/config";

export const ALIAS_POOL = [
  "Alex", "Jordan", "Morgan", "Taylor", "Casey",
  "Quinn", "Riley", "Avery", "Sage", "Dakota",
] as const;

export type AliasMap = Record<string, string>; // key: alias, value: real name

export function buildAliasMap(characterNames: string[]): AliasMap {
  if (characterNames.length > ALIAS_POOL.length) {
    throw new Error(
      `Too many characters: ${characterNames.length} exceeds alias pool size of ${ALIAS_POOL.length}`
    );
  }
  const map: AliasMap = {};
  for (let i = 0; i < characterNames.length; i++) {
    map[ALIAS_POOL[i]!] = characterNames[i]!;
  }
  return map;
}

export function reconstructAliasMap(
  convCharacters: Array<{ id: string; name: string }>,
  allCharacters: CharacterRecord[],
): AliasMap {
  const map: AliasMap = {};
  for (const convChar of convCharacters) {
    const found = allCharacters.find((c) => c.id === convChar.id);
    if (!found) {
      throw new Error(`Character id "${convChar.id}" not found in dataset`);
    }
    map[convChar.name] = found.name;
  }
  return map;
}

export function realNameToAlias(aliasMap: AliasMap, realName: string): string {
  for (const [alias, name] of Object.entries(aliasMap)) {
    if (name === realName) return alias;
  }
  throw new Error(`No alias found for real name "${realName}"`);
}
