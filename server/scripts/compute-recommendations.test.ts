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
import { computeRecommendations } from "./compute-recommendations"

const TEST_DATE = "2026-07-26"

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

describe("compute-recommendations", () => {
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
		expect(mismatchRec?.suggestedModel).toBe("Claude 3.5 Haiku")
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
