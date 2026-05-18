import { describe, it, expect } from "bun:test"

function hashHue(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h * 31 + str.charCodeAt(i)) >>> 0)
  return h % 360
}

describe("hashHue", () => {
  it("returns a number in [0, 359]", () => {
    expect(hashHue("Sherlock Holmes")).toBeGreaterThanOrEqual(0)
    expect(hashHue("Sherlock Holmes")).toBeLessThan(360)
  })
  it("is deterministic", () => {
    expect(hashHue("Iris Vega")).toBe(hashHue("Iris Vega"))
  })
  it("produces different values for different names", () => {
    expect(hashHue("Sherlock Holmes")).not.toBe(hashHue("James Moriarty"))
  })
  it("handles empty string", () => {
    expect(hashHue("")).toBe(0)
  })
})
