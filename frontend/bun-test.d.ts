// Minimal type declarations for bun:test — covers what the test suite actually uses.
// Replace with bun-types package if the test surface grows.
declare module "bun:test" {
  type TestFn = () => void | Promise<void>;

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: TestFn): void;
  export function it(name: string, fn: TestFn): void;

  interface Matchers {
    toEqual(expected: unknown): void;
    toHaveLength(length: number): void;
    toBe(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toContain(item: unknown): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toThrow(message?: string | RegExp): void;
    not: Matchers;
    resolves: Matchers;
    rejects: Matchers;
  }

  export function expect(value: unknown): Matchers;

  export const mock: {
    module(path: string, factory: () => unknown): void;
  };
}
