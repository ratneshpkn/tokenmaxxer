import { normalizeModelName } from "@shared/model-name"
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

/**
 * Minimum raw token volume in the lookback window for a model to participate
 * in rate derivation (prevents tiny 1-request uncached rows from skewing medians
 * or being picked as the suggested workhorse).
 */
export const MIN_MODEL_TOKENS_FOR_PRICING = 100_000

/**
 * Relative threshold vs. the organization's token-weighted median model rate
 * (in cents per 1M cache-weighted base units). Models >= 1.25x the median
 * base-unit rate are classified as top-tier (heavyweight).
 */
export const TOP_TIER_MEDIAN_MULTIPLIER = 1.25

/**
 * Standard provider pricing multipliers relative to 1 uncached input token:
 * - Uncached input: 1.0x
 * - Cache read: 0.1x (90% discount across Anthropic & OpenAI)
 * - Cache creation / write: 1.25x
 * - Output tokens: 5.0x (standard 5:1 output-to-input price ratio)
 *
 * Dividing `cents` by `baseUnits` (instead of raw `tokens`) removes cache-hit-ratio
 * distortion so a 95%-cached Opus model isn't mispriced below an 80%-cached Sonnet model.
 */
export function computeCacheWeightedBaseUnits(params: {
	uncachedInput: number
	cacheRead: number
	cacheWrite?: number
	output: number
}): number {
	return (
		params.uncachedInput +
		params.cacheRead * 0.1 +
		(params.cacheWrite ?? 0) * 1.25 +
		params.output * 5.0
	)
}

export interface ModelCostSummary {
	tokens: number
	cents: number
	/** Cache-weighted base input-equivalent units; falls back to `tokens` if omitted. */
	baseUnits?: number
}

interface QualifiedModelRate {
	model: string
	tokens: number
	cents: number
	baseUnits: number
	/** Cents per 1M cache-weighted base units. */
	rate: number
}

function getQualifiedModelRates(modelStats: ReadonlyMap<string, ModelCostSummary>): {
	qualified: QualifiedModelRate[]
	medianRate: number
} {
	let all = Array.from(modelStats.entries())
		.filter(([, s]) => s.tokens > 0 && s.cents > 0)
		.map(([model, s]) => {
			const baseUnits = s.baseUnits && s.baseUnits > 0 ? s.baseUnits : s.tokens
			return {
				model,
				tokens: s.tokens,
				cents: s.cents,
				baseUnits,
				rate: (s.cents / baseUnits) * 1_000_000,
			}
		})

	if (all.length === 0) return { qualified: [], medianRate: 0 }

	// Apply minimum volume filter so tiny uncached rows don't skew rate derivation;
	// fall back to all models only if every model in a tiny test fixture is below the threshold.
	const volumeFiltered = all.filter((m) => m.tokens >= MIN_MODEL_TOKENS_FOR_PRICING)
	if (volumeFiltered.length > 0) {
		all = volumeFiltered
	}

	const sortedByRate = [...all].sort((a, b) => a.rate - b.rate)
	const unweightedMedian = sortedByRate[Math.floor(sortedByRate.length / 2)].rate

	// Use the unweighted median across volume-qualified models so that a single high-volume
	// flagship model (e.g. Opus accounting for >50% of org tokens) doesn't pull the median
	// up to the flagship tier, and so the suggested workhorse is constrained below the
	// midpoint of the org's active model pricing tiers.
	const medianRate = unweightedMedian
	return { qualified: all, medianRate }
}

/**
 * Derives the set of top-tier (heavyweight) models purely from realized costs
 * per cache-weighted base unit across the organization window.
 */
export function deriveTopTierModels(
	modelStats: ReadonlyMap<string, ModelCostSummary>,
): Set<string> {
	const { qualified, medianRate } = getQualifiedModelRates(modelStats)
	if (qualified.length === 0) return new Set()

	// Single-model edge case (e.g. single-model test fixtures): treat the sole model as top-tier
	// so per-user token-per-line outlier checks can still evaluate.
	if (qualified.length === 1) {
		return new Set([qualified[0].model])
	}

	const cutoff = medianRate * TOP_TIER_MEDIAN_MULTIPLIER
	const topTier = new Set<string>()
	for (const m of qualified) {
		if (m.rate >= cutoff) {
			topTier.add(m.model)
		}
	}
	return topTier
}

/**
 * Picks the most-used qualified workhorse model strictly below (or at) the median
 * base-unit rate (and not in `topTierModels`), falling back to a generic description
 * when no lighter model is present.
 */
export function deriveSuggestedWorkhorseModel(
	modelStats: ReadonlyMap<string, ModelCostSummary>,
	topTierModels: ReadonlySet<string>,
): string {
	const { qualified, medianRate } = getQualifiedModelRates(modelStats)
	let bestModel: string | null = null
	let bestTokens = 0

	// First pass: strictly below the median base-unit rate (< medianRate)
	for (const m of qualified) {
		if (topTierModels.has(m.model)) continue
		if (m.rate < medianRate && m.tokens > bestTokens) {
			bestTokens = m.tokens
			bestModel = m.model
		}
	}

	// Second pass: <= medianRate (e.g. when only 2 models are active and the cheaper one is <= median)
	if (!bestModel) {
		for (const m of qualified) {
			if (topTierModels.has(m.model)) continue
			if (m.rate <= medianRate && m.tokens > bestTokens) {
				bestTokens = m.tokens
				bestModel = m.model
			}
		}
	}

	return bestModel ? normalizeModelName(bestModel) : "Standard / Fast tier model"
}

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

	// Track org-wide token, cost, and cache-weighted base units per model
	const orgModelStats = new Map<string, ModelCostSummary>()
	const recordModelUsage = (model: string, tokens: number, cents: number, baseUnits: number) => {
		const prev = orgModelStats.get(model) ?? { tokens: 0, cents: 0, baseUnits: 0 }
		prev.tokens += tokens
		prev.cents += cents
		prev.baseUnits = (prev.baseUnits ?? 0) + baseUnits
		orgModelStats.set(model, prev)
	}

	// Aggregate Claude Code usage
	const ccRows = await db
		.select({
			email: dailyClaudeCodeAttribution.email,
			model: dailyClaudeCodeAttribution.model,
			uncachedInput: dailyClaudeCodeAttribution.uncachedInputTokens,
			cacheRead: dailyClaudeCodeAttribution.cacheReadInputTokens,
			cacheCreation5m: dailyClaudeCodeAttribution.cacheCreation5mTokens,
			cacheCreation1h: dailyClaudeCodeAttribution.cacheCreation1hTokens,
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
		const cacheWrite = (r.cacheCreation5m ?? 0) + (r.cacheCreation1h ?? 0)
		const tokens = r.uncachedInput + r.cacheRead + cacheWrite + r.outputTokens
		const baseUnits = computeCacheWeightedBaseUnits({
			uncachedInput: r.uncachedInput,
			cacheRead: r.cacheRead,
			cacheWrite,
			output: r.outputTokens,
		})
		m.totalTokens += tokens
		m.totalCents += r.cents
		recordModelUsage(r.model, tokens, r.cents, baseUnits)

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
			cacheWriteTokens: dailyCursorUsage.cacheWriteTokens,
			cents: dailyCursorUsage.chargedCents,
		})
		.from(dailyCursorUsage)
		.where(and(gte(dailyCursorUsage.date, fromDay), lte(dailyCursorUsage.date, computedDate)))

	for (const r of cuRows) {
		const m = userMetrics.get(r.email)
		if (!m) continue
		const cacheWrite = r.cacheWriteTokens ?? 0
		const tokens = r.inputTokens + r.outputTokens + r.cacheReadTokens + cacheWrite
		const baseUnits = computeCacheWeightedBaseUnits({
			uncachedInput: r.inputTokens,
			cacheRead: r.cacheReadTokens,
			cacheWrite,
			output: r.outputTokens,
		})
		m.totalTokens += tokens
		m.totalCents += r.cents
		recordModelUsage(r.model, tokens, r.cents, baseUnits)

		const currentModelTokens = m.modelTokens.get(r.model) ?? 0
		m.modelTokens.set(r.model, currentModelTokens + tokens)
	}

	// Derive top-tier models from realized per-model token cost and sum each user's topTierTokens
	const topTierModels = deriveTopTierModels(orgModelStats)
	const suggestedWorkhorse = deriveSuggestedWorkhorseModel(orgModelStats, topTierModels)

	for (const m of userMetrics.values()) {
		for (const [model, tokens] of m.modelTokens.entries()) {
			if (topTierModels.has(model)) {
				m.topTierTokens += tokens
			}
		}
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
				message: `Your average PR complexity is ${prStats.averageComplexity.toFixed(1)}/5, but your high-tier model usage per line changed (${Math.round(userTokensPerLine).toLocaleString()} tokens/line) is ${ratio}x the org median (${Math.round(orgMedianTokensPerLine).toLocaleString()} tokens/line). Consider using ${suggestedWorkhorse} for routine tasks to save ~$${(potentialSavings / 100).toFixed(2)}.`,
				suggestedModel: suggestedWorkhorse,
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
				suggestedModel: suggestedWorkhorse,
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
