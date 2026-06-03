import { mock } from "bun:test"

mock.module("@/lib/prisma", () => ({
  prisma: {},
}))

import { describe, test, expect } from "bun:test"
import { LlmUsageSource } from "@/lib/generated/prisma/client"
import { getPeriodFilter, buildSummary } from "../utils"

// getPeriodFilter tests
describe("getPeriodFilter", () => {
  test("all returns empty object", () => {
    expect(getPeriodFilter("all")).toEqual({})
  })

  test("today returns createdAt.gte at start of today", () => {
    const filter = getPeriodFilter("today")
    const filterTyped = filter as { createdAt?: { gte: Date } }
    expect(filterTyped.createdAt).not.toBeUndefined()
    const gte = (filter as { createdAt: { gte: Date } }).createdAt.gte
    expect(gte instanceof Date).toBe(true)
    const now = new Date()
    expect(gte.getFullYear()).toBe(now.getFullYear())
    expect(gte.getMonth()).toBe(now.getMonth())
    expect(gte.getDate()).toBe(now.getDate())
    expect(gte.getHours()).toBe(0)
    expect(gte.getMinutes()).toBe(0)
  })

  test("7d returns createdAt.gte roughly 7 days ago", () => {
    const filter = getPeriodFilter("7d")
    const gte = (filter as { createdAt: { gte: Date } }).createdAt.gte
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    expect(Math.abs(gte.getTime() - sevenDaysAgo)).toBeLessThan(5000)
  })

  test("30d returns createdAt.gte roughly 30 days ago", () => {
    const filter = getPeriodFilter("30d")
    const gte = (filter as { createdAt: { gte: Date } }).createdAt.gte
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(gte.getTime() - thirtyDaysAgo)).toBeLessThan(5000)
  })
})

// buildSummary tests
const agentRows = [
  { agentSessionId: "sess-1", _sum: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 } },
  { agentSessionId: "sess-2", _sum: { inputTokens: 200, outputTokens: 80, costUsd: null } },
]

const convRows = [
  { conversationId: "conv-1", source: LlmUsageSource.CONVERSATION, _sum: { inputTokens: 300, outputTokens: 120, costUsd: 0.05 } },
  { conversationId: "conv-1", source: LlmUsageSource.ORCHESTRATOR, _sum: { inputTokens: 50, outputTokens: 20, costUsd: 0.01 } },
  { conversationId: "conv-2", source: LlmUsageSource.CONVERSATION, _sum: { inputTokens: 400, outputTokens: 160, costUsd: null } },
]

const otherAgg = { _sum: { inputTokens: 10, outputTokens: 5, costUsd: null } }

const convTitles = [
  { id: "conv-1", title: "Scene A" },
  { id: "conv-2", title: "Scene B" },
]

describe("buildSummary", () => {
  const summary = buildSummary("7d", agentRows, convRows, otherAgg, convTitles)

  test("period passthrough", () => {
    expect(summary.period).toBe("7d")
  })

  test("agent totals sum across sessions", () => {
    expect(summary.agent.inputTokens).toBe(300)
    expect(summary.agent.outputTokens).toBe(130)
    expect(summary.agent.sessionCount).toBe(2)
  })

  test("agent costUsd null when any session has null", () => {
    expect(summary.agent.costUsd).toBeNull()
  })

  test("conversations items length matches distinct conversationIds", () => {
    expect(summary.conversations.items).toHaveLength(2)
  })

  test("conversation with orchestrator has non-null orchestrator", () => {
    const conv1 = summary.conversations.items.find((i) => i.id === "conv-1")
    expect(conv1).not.toBeUndefined()
    expect(conv1!.orchestrator).not.toBeNull()
    expect(conv1!.orchestrator!.inputTokens).toBe(50)
  })

  test("conversation without orchestrator has null orchestrator", () => {
    const conv2 = summary.conversations.items.find((i) => i.id === "conv-2")
    expect(conv2!.orchestrator).toBeNull()
  })

  test("conversation totals = conversation + orchestrator", () => {
    const conv1 = summary.conversations.items.find((i) => i.id === "conv-1")!
    expect(conv1.totals.inputTokens).toBe(350)
    expect(conv1.totals.outputTokens).toBe(140)
  })

  test("conversations.totals sums all conversation items", () => {
    expect(summary.conversations.totals.inputTokens).toBe(750)
    expect(summary.conversations.totals.outputTokens).toBe(300)
  })

  test("conversation title populated from convTitles", () => {
    const conv1 = summary.conversations.items.find((i) => i.id === "conv-1")!
    expect(conv1.title).toBe("Scene A")
  })

  test("other maps otherAgg", () => {
    expect(summary.other.inputTokens).toBe(10)
    expect(summary.other.outputTokens).toBe(5)
    expect(summary.other.costUsd).toBeNull()
  })
})
