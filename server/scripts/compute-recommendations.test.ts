import { beforeAll, describe, expect, it } from "bun:test"
import {
	dailyClaudeCodeAttribution,
	githubPrEnrichments,
	githubPullRequests,
	modelRecommendations,
	trackedUsers,
} from "@shared/schema"
import { eq } from "drizzle-orm"
import { db } from "../db"
import {
	computeCacheWeightedBaseUnits,
	computeRecommendations,
	deriveSuggestedWorkhorseModel,
	deriveTopTierModels,
} from "./compute-recommendations"

const TEST_DATE = "2026-07-26"

describe("deriveTopTierModels & deriveSuggestedWorkhorseModel", () => {
	it("prices models on cache-weighted base units, filters tiny uncached rows, and constrains workhorse below median rate", () => {
		// Simulate a prod-like mix where Opus has a 95% cache hit rate (making raw $/M tokens look artificially low)
		// while Sonnet 5.5 has an 80% cache hit rate, plus a tiny 2,000-token uncached row that shouldn't skew.
		const opusBaseUnits = computeCacheWeightedBaseUnits({
			uncachedInput: 2_000_000,
			cacheRead: 95_000_000,
			cacheWrite: 2_000_000,
			output: 1_000_000,
		}) // 2M + 9.5M + 2.5M + 5M = 19M base units
		const sonnetBaseUnits = computeCacheWeightedBaseUnits({
			uncachedInput: 5_000_000,
			cacheRead: 40_000_000,
			cacheWrite: 3_000_000,
			output: 2_000_000,
		}) // 5M + 4M + 3.75M + 10M = 22.75M base units

		const stats = new Map([
			// Flagship 1: $15/M base units -> 28,500 cents for 19M base units (100M raw tokens)
			["claude-opus-5-5", { tokens: 100_000_000, cents: 28_500, baseUnits: opusBaseUnits }],
			// Flagship 2: $10/M base units (1,000 cents/M base units)
			["claude-fable-5", { tokens: 10_000_000, cents: 2_000, baseUnits: 2_000_000 }],
			// Mid-tier model at median ($5/M base units = 500 cents/M base units)
			["gpt-5.5-medium", { tokens: 5_000_000, cents: 500, baseUnits: 1_000_000 }],
			// Workhorse below median ($3/M base units = 300 cents/M base units, high volume) -> resolves to Claude Sonnet 5.5
			[
				"claude-sonnet-5-5",
				{
					tokens: 50_000_000,
					cents: Math.round(sonnetBaseUnits * 0.0003),
					baseUnits: sonnetBaseUnits,
				},
			],
			// Lighter model ($1/M base units = 100 cents/M base units, lower volume than Sonnet 5.5)
			["claude-haiku-4-5", { tokens: 8_000_000, cents: 200, baseUnits: 2_000_000 }],
			// Tiny uncached outlier (2,000 tokens, below MIN_MODEL_TOKENS_FOR_PRICING) -> ignored
			["tiny-uncached-outlier", { tokens: 2_000, cents: 500, baseUnits: 2_000 }],
		])

		const topTier = deriveTopTierModels(stats)
		expect(topTier.has("claude-opus-5-5")).toBe(true)
		expect(topTier.has("claude-fable-5")).toBe(true)
		expect(topTier.has("claude-sonnet-5-5")).toBe(false)
		expect(topTier.has("claude-haiku-4-5")).toBe(false)
		expect(topTier.has("tiny-uncached-outlier")).toBe(false)

		const workhorse = deriveSuggestedWorkhorseModel(stats, topTier)
		expect(workhorse).toBe("Claude Sonnet 5.5")
	})
})

describe("compute-recommendations", () => {
	beforeAll(async () => {
		await db
			.insert(trackedUsers)
			.values([
				{ email: "user1@test.com", name: "User One", isActive: true },
				{ email: "user2@test.com", name: "User Two", isActive: true },
				{ email: "user3@test.com", name: "User Three", isActive: true },
			])
			.onConflictDoNothing()
	})
	it("runs cleanly without throwing errors when user data is empty or sparse", async () => {
		const count = await computeRecommendations({
			computedDate: TEST_DATE,
			lookbackDays: 14,
		})
		expect(typeof count).toBe("number")
		expect(count).toBeGreaterThanOrEqual(0)
	})

	it("generates cost_optimization recommendation when user cost per M tokens is above 1.5x median", async () => {
		// Clean up existing usage data
		await db
			.delete(dailyClaudeCodeAttribution)
			.where(eq(dailyClaudeCodeAttribution.date, TEST_DATE))
		await db.delete(modelRecommendations).where(eq(modelRecommendations.computedDate, TEST_DATE))

		// User 1: High cost per token (200k tokens, $10.00 = 1000 cents -> $50/M)
		// User 2: Med cost per token (200k tokens, $2.00 = 200 cents -> $10/M)
		// User 3: Low cost per token (200k tokens, $1.50 = 150 cents -> $7.50/M)
		await db.insert(dailyClaudeCodeAttribution).values([
			{
				date: TEST_DATE,
				email: "user1@test.com",
				model: "claude-3-5-sonnet-20241022",
				uncachedInputTokens: 100_000,
				cacheReadInputTokens: 50_000,
				outputTokens: 50_000,
				attributedCents: 1000,
			},
			{
				date: TEST_DATE,
				email: "user2@test.com",
				model: "claude-3-5-sonnet-20241022",
				uncachedInputTokens: 100_000,
				cacheReadInputTokens: 50_000,
				outputTokens: 50_000,
				attributedCents: 200,
			},
			{
				date: TEST_DATE,
				email: "user3@test.com",
				model: "claude-3-5-sonnet-20241022",
				uncachedInputTokens: 100_000,
				cacheReadInputTokens: 50_000,
				outputTokens: 50_000,
				attributedCents: 150,
			},
		])

		const count = await computeRecommendations({
			computedDate: TEST_DATE,
			lookbackDays: 14,
		})

		expect(count).toBeGreaterThanOrEqual(1)

		const recs = await db
			.select()
			.from(modelRecommendations)
			.where(eq(modelRecommendations.email, "user1@test.com"))

		const costRec = recs.find((r) => r.type === "cost_optimization")
		expect(costRec).toBeDefined()
		expect(costRec?.severity).toBe("info")
		expect(costRec?.metadata?.userCentsPerToken).toBeGreaterThan(0)
	})

	it("generates work_type_mismatch recommendation on high top-tier burn rate for low complexity PRs", async () => {
		await db
			.delete(dailyClaudeCodeAttribution)
			.where(eq(dailyClaudeCodeAttribution.date, TEST_DATE))
		await db.delete(modelRecommendations).where(eq(modelRecommendations.computedDate, TEST_DATE))
		await db.delete(githubPullRequests).where(eq(githubPullRequests.repo, "repo1"))
		await db.delete(githubPrEnrichments).where(eq(githubPrEnrichments.repo, "repo1"))

		// Top-tier model usage (>1M tokens)
		await db.insert(dailyClaudeCodeAttribution).values([
			{
				date: TEST_DATE,
				email: "user1@test.com",
				model: "claude-3-opus-20240229",
				uncachedInputTokens: 600_000,
				cacheReadInputTokens: 300_000,
				outputTokens: 300_000,
				attributedCents: 3000,
			},
			{
				date: TEST_DATE,
				email: "user2@test.com",
				model: "claude-3-opus-20240229",
				uncachedInputTokens: 600_000,
				cacheReadInputTokens: 300_000,
				outputTokens: 300_000,
				attributedCents: 3000,
			},
			{
				date: TEST_DATE,
				email: "user3@test.com",
				model: "claude-3-opus-20240229",
				uncachedInputTokens: 600_000,
				cacheReadInputTokens: 300_000,
				outputTokens: 300_000,
				attributedCents: 3000,
			},
		])

		// PRs
		const mergedAt = new Date(`${TEST_DATE}T12:00:00Z`)
		await db
			.insert(githubPullRequests)
			.values([
				{
					repo: "repo1",
					number: 101,
					title: "PR1",
					author: "user1",
					email: "user1@test.com",
					mergedAt,
					additions: 5,
					deletions: 5,
				},
				{
					repo: "repo1",
					number: 102,
					title: "PR2",
					author: "user1",
					email: "user1@test.com",
					mergedAt,
					additions: 5,
					deletions: 5,
				},
				{
					repo: "repo1",
					number: 201,
					title: "PR3",
					author: "user2",
					email: "user2@test.com",
					mergedAt,
					additions: 100,
					deletions: 100,
				},
				{
					repo: "repo1",
					number: 202,
					title: "PR4",
					author: "user2",
					email: "user2@test.com",
					mergedAt,
					additions: 100,
					deletions: 100,
				},
				{
					repo: "repo1",
					number: 301,
					title: "PR5",
					author: "user3",
					email: "user3@test.com",
					mergedAt,
					additions: 150,
					deletions: 150,
				},
				{
					repo: "repo1",
					number: 302,
					title: "PR6",
					author: "user3",
					email: "user3@test.com",
					mergedAt,
					additions: 150,
					deletions: 150,
				},
			])
			.onConflictDoNothing()

		await db
			.insert(githubPrEnrichments)
			.values([
				{ repo: "repo1", number: 101, category: "bugfix", complexityScore: 1 },
				{ repo: "repo1", number: 102, category: "bugfix", complexityScore: 1 },
				{ repo: "repo1", number: 201, category: "feature", complexityScore: 1 },
				{ repo: "repo1", number: 202, category: "feature", complexityScore: 1 },
				{ repo: "repo1", number: 301, category: "feature", complexityScore: 1 },
				{ repo: "repo1", number: 302, category: "feature", complexityScore: 1 },
			])
			.onConflictDoNothing()

		const count = await computeRecommendations({
			computedDate: TEST_DATE,
			lookbackDays: 14,
		})

		expect(count).toBeGreaterThanOrEqual(1)

		const recs = await db
			.select()
			.from(modelRecommendations)
			.where(eq(modelRecommendations.email, "user1@test.com"))

		const mismatchRec = recs.find((r) => r.type === "work_type_mismatch")
		expect(mismatchRec).toBeDefined()
		expect(mismatchRec?.severity).toBe("warning")
		expect(mismatchRec?.suggestedModel).toBe("Standard / Fast tier model")
	})

	it("is idempotent on re-runs and cleans up stale recommendations when 0 recs are generated", async () => {
		// First run: generate recommendations
		await computeRecommendations({ computedDate: TEST_DATE, lookbackDays: 14 })

		// Delete usage so next run computes 0 recommendations
		await db
			.delete(dailyClaudeCodeAttribution)
			.where(eq(dailyClaudeCodeAttribution.date, TEST_DATE))

		const count = await computeRecommendations({ computedDate: TEST_DATE, lookbackDays: 14 })
		expect(count).toBe(0)

		const recs = await db
			.select()
			.from(modelRecommendations)
			.where(eq(modelRecommendations.computedDate, TEST_DATE))

		expect(recs.length).toBe(0)
	})
})
