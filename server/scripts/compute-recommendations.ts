import {
	dailyClaudeCodeAttribution,
	dailyCursorUsage,
	githubPrEnrichments,
	githubPullRequests,
	modelRecommendations,
	trackedUsers,
} from "@shared/schema"
import { and, eq, gte, lte } from "drizzle-orm"
import { db, pool } from "../db"
import { parseDateRangeArgs, today, withSyncRun } from "./lib/shared"

const TOP_TIER_MODELS = ["claude-3-opus", "opus", "claude-3-7-sonnet", "gpt-4o", "cursor-gpt-4o"]

export interface ComputeRecommendationOpts {
	computedDate?: string
	lookbackDays?: number
	existingRunId?: string
	triggeredBy?: string
}

export async function computeRecommendations(opts?: ComputeRecommendationOpts): Promise<number> {
	const res = await withSyncRun(
		"recommendations",
		async () => {
			const count = await doComputeRecommendations(opts)
			return { rowsUpserted: count }
		},
		opts,
	)
	return res.rowsUpserted
}

async function doComputeRecommendations(opts?: ComputeRecommendationOpts): Promise<number> {
	const computedDate = opts?.computedDate ?? today()
	const lookbackDays = opts?.lookbackDays ?? 14

	// Calculate start date ISO
	const startDate = new Date(computedDate)
	startDate.setDate(startDate.getDate() - lookbackDays)
	const fromDay = startDate.toISOString().slice(0, 10)

	// Fetch active tracked users
	const users = await db
		.select({ email: trackedUsers.email, name: trackedUsers.name })
		.from(trackedUsers)
		.where(eq(trackedUsers.isActive, true))

	if (users.length === 0) {
		await db.delete(modelRecommendations).where(eq(modelRecommendations.computedDate, computedDate))
		return 0
	}

	// 1. Calculate per-user token and cost aggregations across Claude Code and Cursor
	const userMetrics = new Map<
		string,
		{
			totalTokens: number
			totalCents: number
			topTierTokens: number
			modelTokens: Map<string, number>
		}
	>()

	for (const u of users) {
		userMetrics.set(u.email, {
			totalTokens: 0,
			totalCents: 0,
			topTierTokens: 0,
			modelTokens: new Map(),
		})
	}

	// Aggregate Claude Code usage
	const ccRows = await db
		.select({
			email: dailyClaudeCodeAttribution.email,
			model: dailyClaudeCodeAttribution.model,
			uncachedInput: dailyClaudeCodeAttribution.uncachedInputTokens,
			cacheRead: dailyClaudeCodeAttribution.cacheReadInputTokens,
			outputTokens: dailyClaudeCodeAttribution.outputTokens,
			cents: dailyClaudeCodeAttribution.attributedCents,
		})
		.from(dailyClaudeCodeAttribution)
		.where(
			and(
				gte(dailyClaudeCodeAttribution.date, fromDay),
				lte(dailyClaudeCodeAttribution.date, computedDate),
			),
		)

	for (const r of ccRows) {
		const m = userMetrics.get(r.email)
		if (!m) continue
		const tokens = r.uncachedInput + r.cacheRead + r.outputTokens
		m.totalTokens += tokens
		m.totalCents += r.cents
		const isTopTier = TOP_TIER_MODELS.some((tm) => r.model.toLowerCase().includes(tm))
		if (isTopTier) m.topTierTokens += tokens

		const currentModelTokens = m.modelTokens.get(r.model) ?? 0
		m.modelTokens.set(r.model, currentModelTokens + tokens)
	}

	// Aggregate Cursor usage
	const cuRows = await db
		.select({
			email: dailyCursorUsage.email,
			model: dailyCursorUsage.model,
			inputTokens: dailyCursorUsage.inputTokens,
			outputTokens: dailyCursorUsage.outputTokens,
			cacheReadTokens: dailyCursorUsage.cacheReadTokens,
			cents: dailyCursorUsage.chargedCents,
		})
		.from(dailyCursorUsage)
		.where(and(gte(dailyCursorUsage.date, fromDay), lte(dailyCursorUsage.date, computedDate)))

	for (const r of cuRows) {
		const m = userMetrics.get(r.email)
		if (!m) continue
		const tokens = r.inputTokens + r.outputTokens + r.cacheReadTokens
		m.totalTokens += tokens
		m.totalCents += r.cents
		const isTopTier = TOP_TIER_MODELS.some((tm) => r.model.toLowerCase().includes(tm))
		if (isTopTier) m.topTierTokens += tokens

		const currentModelTokens = m.modelTokens.get(r.model) ?? 0
		m.modelTokens.set(r.model, currentModelTokens + tokens)
	}

	// Calculate Org Median Cost per M-Tokens
	const centsPerMTokensList: number[] = []
	for (const [_, metrics] of userMetrics.entries()) {
		if (metrics.totalTokens > 50_000) {
			// minimum token threshold for statistical validity
			const rate = (metrics.totalCents / metrics.totalTokens) * 1_000_000
			centsPerMTokensList.push(rate)
		}
	}
	centsPerMTokensList.sort((a, b) => a - b)
	const orgMedianCentsPerMToken =
		centsPerMTokensList.length > 0
			? centsPerMTokensList[Math.floor(centsPerMTokensList.length / 2)]
			: 0

	// 2. Fetch PR enrichments joined with GitHub pull requests in window
	const prRows = await db
		.select({
			email: githubPullRequests.email,
			repo: githubPullRequests.repo,
			number: githubPullRequests.number,
			additions: githubPullRequests.additions,
			deletions: githubPullRequests.deletions,
			category: githubPrEnrichments.category,
			complexityScore: githubPrEnrichments.complexityScore,
		})
		.from(githubPullRequests)
		.innerJoin(
			githubPrEnrichments,
			and(
				eq(githubPullRequests.repo, githubPrEnrichments.repo),
				eq(githubPullRequests.number, githubPrEnrichments.number),
			),
		)
		.where(
			and(
				gte(githubPullRequests.mergedAt, new Date(fromDay)),
				lte(githubPullRequests.mergedAt, new Date(`${computedDate}T23:59:59Z`)),
			),
		)

	const userPrStats = new Map<
		string,
		{
			totalPrs: number
			totalLinesChanged: number
			totalComplexity: number
			averageComplexity: number
		}
	>()
	for (const u of users) {
		userPrStats.set(u.email, {
			totalPrs: 0,
			totalLinesChanged: 0,
			totalComplexity: 0,
			averageComplexity: 0,
		})
	}

	for (const pr of prRows) {
		const stats = userPrStats.get(pr.email)
		if (!stats) continue
		stats.totalPrs++
		stats.totalLinesChanged += (pr.additions ?? 0) + (pr.deletions ?? 0)
		stats.totalComplexity += pr.complexityScore
	}

	for (const stats of userPrStats.values()) {
		if (stats.totalPrs > 0) stats.averageComplexity = stats.totalComplexity / stats.totalPrs
	}

	const tokensPerLineList: number[] = []
	for (const u of users) {
		const m = userMetrics.get(u.email)
		const pr = userPrStats.get(u.email)
		if (m && m.topTierTokens > 100_000 && pr && pr.totalLinesChanged > 0) {
			tokensPerLineList.push(m.topTierTokens / pr.totalLinesChanged)
		}
	}
	tokensPerLineList.sort((a, b) => a - b)
	const orgMedianTokensPerLine =
		tokensPerLineList.length > 0 ? tokensPerLineList[Math.floor(tokensPerLineList.length / 2)] : 0

	// 3. Generate Recommendations
	const newRecs: (typeof modelRecommendations.$inferInsert)[] = []

	for (const u of users) {
		const metrics = userMetrics.get(u.email)
		const prStats = userPrStats.get(u.email)
		if (!metrics || metrics.totalTokens === 0) continue

		const userCentsPerMToken = (metrics.totalCents / metrics.totalTokens) * 1_000_000
		const userTokensPerLine =
			prStats && prStats.totalLinesChanged > 0
				? metrics.topTierTokens / prStats.totalLinesChanged
				: 0

		// Rule 1: High-tier model burn rate per line of code output (Tokens / Delta Line)
		if (
			prStats &&
			prStats.totalPrs >= 2 &&
			prStats.averageComplexity <= 2.2 &&
			metrics.topTierTokens > 1_000_000 &&
			orgMedianTokensPerLine > 0 &&
			userTokensPerLine > 2.5 * orgMedianTokensPerLine
		) {
			const potentialSavings = Math.round(metrics.totalCents * 0.4) // estimated ~40% savings with lighter models
			const ratio = (userTokensPerLine / orgMedianTokensPerLine).toFixed(1)
			newRecs.push({
				email: u.email,
				computedDate,
				type: "work_type_mismatch",
				severity: "warning",
				title: "High-tier model burn rate on low-complexity PRs",
				message: `Your average PR complexity is ${prStats.averageComplexity.toFixed(1)}/5, but your high-tier model usage per line changed (${Math.round(userTokensPerLine).toLocaleString()} tokens/line) is ${ratio}x the org median (${Math.round(orgMedianTokensPerLine).toLocaleString()} tokens/line). Consider using Claude 3.5 Haiku or Sonnet standard for routine tasks to save ~$${(potentialSavings / 100).toFixed(2)}.`,
				suggestedModel: "Claude 3.5 Haiku",
				potentialSavingsCents: potentialSavings,
				metadata: {
					userCentsPerToken: userCentsPerMToken,
				},
			})
		}

		// Rule 2: Cost-per-Token Outlier
		if (
			orgMedianCentsPerMToken > 0 &&
			userCentsPerMToken > 1.5 * orgMedianCentsPerMToken &&
			metrics.totalTokens > 100_000
		) {
			const diffRatio = (userCentsPerMToken / orgMedianCentsPerMToken).toFixed(1)
			newRecs.push({
				email: u.email,
				computedDate,
				type: "cost_optimization",
				severity: "info",
				title: "Cost-per-token above organization median",
				message: `Your effective cost per million tokens ($${(userCentsPerMToken / 100).toFixed(2)}/M) is ${diffRatio}x the org median ($${(orgMedianCentsPerMToken / 100).toFixed(2)}/M).`,
				suggestedModel: "Claude 3.5 Sonnet / Haiku",
				potentialSavingsCents: Math.round(metrics.totalCents * 0.3),
				metadata: {
					orgAvgCentsPerToken: orgMedianCentsPerMToken,
					userCentsPerToken: userCentsPerMToken,
				},
			})
		}
	}

	// 4. Clear existing recommendations for today and persist new ones within a transaction
	await db.transaction(async (tx) => {
		await tx.delete(modelRecommendations).where(eq(modelRecommendations.computedDate, computedDate))

		if (newRecs.length > 0) {
			await tx.insert(modelRecommendations).values(newRecs)
		}
	})

	console.log(
		`[compute-recommendations] generated ${newRecs.length} recommendations for ${computedDate}`,
	)

	return newRecs.length
}

if (import.meta.main) {
	const args = parseDateRangeArgs(process.argv)
	computeRecommendations({ computedDate: args?.to ?? today() })
		.then((count) => {
			console.log(`[compute-recommendations] completed (${count} created)`)
			pool.end()
		})
		.catch((err) => {
			console.error("[compute-recommendations] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
