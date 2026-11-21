import { githubPrEnrichments, githubPullRequests } from "@shared/schema"
import { and, desc, gte, isNotNull, isNull, or, sql } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { classifyPRBatch } from "../lib/enrichment-llm"
import { bumpSyncRunRows, withSyncRun } from "./lib/shared"

const CONCURRENCY = 4

export async function runPREnrichment(opts?: {
	forceAll?: boolean
	limit?: number
	days?: number
	existingRunId?: string
	triggeredBy?: string
}): Promise<number> {
	const res = await withSyncRun(
		"prs_enrich",
		async (runId) => {
			const rowsUpserted = await doRunPREnrichment(runId, opts)
			return { rowsUpserted }
		},
		opts,
	)
	return res.rowsUpserted
}

async function doRunPREnrichment(
	runId: string,
	opts?: {
		forceAll?: boolean
		limit?: number
		days?: number
	},
): Promise<number> {
	const cfg = await loadConfig()

	if (!cfg.enrichmentApiKey || !cfg.enrichmentModelName) {
		throw new Error(
			"PR Enrichment AI Provider is not configured. Visit /settings to set Provider, Model Name, and API Key.",
		)
	}

	console.log(
		`[enrich-prs] Using LLM provider "${cfg.enrichmentProvider || "anthropic"}" with model "${cfg.enrichmentModelName}"...`,
	)

	const conditions = [isNotNull(githubPullRequests.files)]

	if (opts?.days && opts.days > 0) {
		const cutoff = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000)
		conditions.push(
			or(
				gte(githubPullRequests.mergedAt, cutoff),
				gte(githubPullRequests.openedAt, cutoff),
			) as ReturnType<typeof isNotNull>,
		)
	}

	let query = db
		.select({
			repo: githubPullRequests.repo,
			number: githubPullRequests.number,
			title: githubPullRequests.title,
			body: githubPullRequests.body,
			additions: githubPullRequests.additions,
			deletions: githubPullRequests.deletions,
			files: githubPullRequests.files,
		})
		.from(githubPullRequests)
		.$dynamic()

	if (!opts?.forceAll) {
		query = query
			.leftJoin(
				githubPrEnrichments,
				and(
					sql`${githubPrEnrichments.repo} = ${githubPullRequests.repo}`,
					sql`${githubPrEnrichments.number} = ${githubPullRequests.number}`,
				),
			)
			.$dynamic()
		conditions.push(isNull(githubPrEnrichments.repo))
	}

	query = query
		.where(and(...conditions))
		.orderBy(desc(githubPullRequests.mergedAt), desc(githubPullRequests.openedAt))
		.$dynamic()
	if (opts?.limit && opts.limit > 0) query = query.limit(opts.limit).$dynamic()

	const targetPrs = await query

	const [{ pending } = { pending: 0 }] = await db
		.select({ pending: sql<number>`count(*)::int` })
		.from(githubPullRequests)
		.where(isNull(githubPullRequests.files))
	if (pending > 0) {
		console.log(
			`[enrich-prs] ${pending} PR(s) have no cached file data and were not scored — run \`bun run prs:files\` first.`,
		)
	}

	if (targetPrs.length === 0) {
		console.log("[enrich-prs] No matching GitHub PRs to enrich.")
		return 0
	}

	console.log(`[enrich-prs] Processing ${targetPrs.length} PR(s) for agentic classification...`)

	const llmConfig = {
		provider:
			(cfg.enrichmentProvider as "anthropic" | "openai" | "openai_compatible") || "anthropic",
		apiKey: cfg.enrichmentApiKey,
		modelName: cfg.enrichmentModelName,
		baseUrl: cfg.enrichmentBaseUrl,
	}

	let totalEnriched = 0
	let lastError: unknown = null

	for (let i = 0; i < targetPrs.length; i += CONCURRENCY) {
		const wave = targetPrs.slice(i, i + CONCURRENCY)
		try {
			const validKeys = new Set(wave.map((pr) => `${pr.repo}#${pr.number}`))
			const rawResults = await classifyPRBatch(wave, llmConfig, CONCURRENCY, (_pr, err) => {
				lastError = err
			})

			const seen = new Set<string>()
			const results = rawResults.filter((r) => {
				const key = `${r.repo}#${r.number}`
				if (!validKeys.has(key)) {
					console.warn(`[enrich-prs] Discarding result for un-requested PR "${key}".`)
					return false
				}
				if (seen.has(key)) {
					console.warn(`[enrich-prs] Discarding duplicate result for "${key}".`)
					return false
				}
				seen.add(key)
				return true
			})

			if (results.length !== wave.length) {
				console.warn(
					`[enrich-prs] Wave returned ${results.length} usable result(s) for ${wave.length} PR(s); the rest will be retried next run.`,
				)
			}

			if (results.length > 0) {
				await db
					.insert(githubPrEnrichments)
					.values(
						results.map((r) => ({
							repo: r.repo,
							number: r.number,
							category: r.category,
							complexityScore: r.complexityScore,
							complexityReason: r.complexityReason,
							summary: r.summary,
							syncedAt: new Date(),
						})),
					)
					.onConflictDoUpdate({
						target: [githubPrEnrichments.repo, githubPrEnrichments.number],
						set: {
							category: sql`excluded.category`,
							complexityScore: sql`excluded.complexity_score`,
							complexityReason: sql`excluded.complexity_reason`,
							summary: sql`excluded.summary`,
							effLinesChanged: null,
							effFiles: null,
							breadth: null,
							langSpan: null,
							mechanical: null,
							sensitive: null,
							contentKind: null,
							syncedAt: new Date(),
						},
					})
				totalEnriched += results.length
				await bumpSyncRunRows(runId, results.length)

				console.log("\n── CLASSIFICATION RESULTS ──")
				for (const r of results) {
					console.log(`📌 ${r.repo}#${r.number}:`)
					console.log(`   Category:        ${r.category}`)
					console.log(`   Complexity:      ${r.complexityScore}/5 (${r.complexityReason})`)
					console.log(`   Summary:         ${r.summary}`)
				}
				console.log("─────────────────────────────\n")
			}
		} catch (waveErr) {
			lastError = waveErr
			console.error(
				`[enrich-prs] Wave ${i / CONCURRENCY + 1} failed:`,
				waveErr instanceof Error ? waveErr.message : waveErr,
			)
		}
	}

	if (targetPrs.length > 0 && totalEnriched === 0) {
		throw lastError instanceof Error
			? lastError
			: new Error(
					`[enrich-prs] All ${targetPrs.length} PR evaluation(s) failed${lastError ? `: ${String(lastError)}` : ""}`,
				)
	}

	console.log(`[enrich-prs] Complete! Enriched ${totalEnriched} PR(s) into github_pr_enrichments.`)
	return totalEnriched
}

if (import.meta.main) {
	const forceAll = process.argv.includes("--force")
	let limit: number | undefined
	const limitIdx = process.argv.indexOf("--limit")
	if (limitIdx !== -1 && process.argv[limitIdx + 1]) {
		limit = parseInt(process.argv[limitIdx + 1], 10)
	}

	let days: number | undefined
	const daysIdx = process.argv.indexOf("--days")
	if (daysIdx !== -1 && process.argv[daysIdx + 1]) {
		days = parseInt(process.argv[daysIdx + 1], 10)
	}

	runPREnrichment({ forceAll, limit, days })
		.then(() => pool.end())
		.catch((err) => {
			console.error("[enrich-prs] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
