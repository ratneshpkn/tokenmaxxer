import type { PRFileCache } from "@shared/schema"
import { githubPrEnrichments, githubPullRequests } from "@shared/schema"
import { and, gte, isNotNull, isNull, or, sql } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { classifyPRBatch, type PREnrichmentInput } from "../lib/enrichment-llm"
import { computeDiffSignals, type DiffSignals } from "../lib/pr-diff-signals"

const MAX_FILE_PATHS = 40

interface PreparedPr {
	input: PREnrichmentInput
	signals: DiffSignals
}

/** Build the LLM input from a PR row plus the signals computed from its cached
 *  file list. Signals are returned separately so they can be persisted verbatim
 *  next to the score they informed. */
function preparePr(pr: {
	repo: string
	number: number
	title: string
	body: string | null
	additions: number
	deletions: number
	files: PRFileCache[] | null
}): PreparedPr {
	const files = pr.files ?? []
	const signals = computeDiffSignals(files)
	const filePaths = [...files]
		.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
		.slice(0, MAX_FILE_PATHS)
		.map((f) => f.filename)

	return {
		signals,
		input: {
			repo: pr.repo,
			number: pr.number,
			title: pr.title,
			body: pr.body,
			additions: pr.additions,
			deletions: pr.deletions,
			filePaths,
			effLinesChanged: signals.effLinesChanged,
			effFiles: signals.effFiles,
			breadth: signals.layers.length,
			langSpan: signals.langs.length,
			mechanical: signals.mechanical,
			sensitive: signals.sensitive,
			contentKind: signals.contentKind,
		},
	}
}

export async function runPREnrichment(opts?: {
	forceAll?: boolean
	limit?: number
	days?: number
}): Promise<number> {
	const cfg = await loadConfig()

	if (!cfg.enrichmentApiKey || !cfg.enrichmentModelName) {
		throw new Error(
			"PR Enrichment AI Provider is not configured. Visit /settings to set Provider, Model Name, and API Key.",
		)
	}

	console.log(
		`[enrich-prs] Using LLM provider "${cfg.enrichmentProvider || "anthropic"}" with model "${cfg.enrichmentModelName}"...`,
	)

	// Filter in SQL rather than loading every row: `files` holds a per-PR file list,
	// so an unprojected full-table select would drag the whole cache into memory.
	// `isNotNull(files)` also enforces the file-grounded-only rule — PRs without
	// cached file data are left for the next run after `sync-pr-files` fills them.
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
		// Anti-join beats loading the whole enrichments table to build a key Set.
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

	query = query.where(and(...conditions)).$dynamic()
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

	console.log(`[enrich-prs] Processing ${targetPrs.length} PR(s) for classification...`)

	const llmConfig = {
		provider:
			(cfg.enrichmentProvider as "anthropic" | "openai" | "openai_compatible") || "anthropic",
		apiKey: cfg.enrichmentApiKey,
		modelName: cfg.enrichmentModelName,
		baseUrl: cfg.enrichmentBaseUrl,
	}

	let totalEnriched = 0
	const BATCH_SIZE = 4

	for (let i = 0; i < targetPrs.length; i += BATCH_SIZE) {
		const batch = targetPrs.slice(i, i + BATCH_SIZE)
		try {
			const prepared = batch.map(preparePr)
			// Keyed so each score can be stored next to the signals it was shown.
			const signalsByPr = new Map(
				prepared.map((p) => [`${p.input.repo}#${p.input.number}`, p.signals]),
			)
			const rawResults = await classifyPRBatch(
				prepared.map((p) => p.input),
				llmConfig,
			)

			// The model echoes repo/number back, so an off-by-one or omitted number
			// would upsert onto a DIFFERENT PR's row and clobber its stored score.
			// Only keep results that match a PR we actually sent, and drop duplicate
			// keys — a repeated key makes the multi-row upsert fail for the whole batch.
			const seen = new Set<string>()
			const results = rawResults.filter((r) => {
				const key = `${r.repo}#${r.number}`
				if (!signalsByPr.has(key)) {
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
			if (results.length !== prepared.length) {
				console.warn(
					`[enrich-prs] Batch returned ${results.length} usable result(s) for ${prepared.length} PR(s); the rest will be retried next run.`,
				)
			}

			if (results.length > 0) {
				await db
					.insert(githubPrEnrichments)
					.values(
						results.map((r) => {
							// Non-null: the filter above dropped anything not in the map.
							const s = signalsByPr.get(`${r.repo}#${r.number}`) as DiffSignals
							return {
								repo: r.repo,
								number: r.number,
								category: r.category,
								complexityScore: r.complexityScore,
								complexityReason: r.complexityReason,
								summary: r.summary,
								effLinesChanged: s.effLinesChanged,
								effFiles: s.effFiles,
								breadth: s.layers.length,
								langSpan: s.langs.length,
								mechanical: s.mechanical,
								sensitive: s.sensitive,
								contentKind: s.contentKind,
								syncedAt: new Date(),
							}
						}),
					)
					.onConflictDoUpdate({
						target: [githubPrEnrichments.repo, githubPrEnrichments.number],
						set: {
							category: sql`excluded.category`,
							complexityScore: sql`excluded.complexity_score`,
							complexityReason: sql`excluded.complexity_reason`,
							summary: sql`excluded.summary`,
							effLinesChanged: sql`excluded.eff_lines_changed`,
							effFiles: sql`excluded.eff_files`,
							breadth: sql`excluded.breadth`,
							langSpan: sql`excluded.lang_span`,
							mechanical: sql`excluded.mechanical`,
							sensitive: sql`excluded.sensitive`,
							contentKind: sql`excluded.content_kind`,
							syncedAt: new Date(),
						},
					})
				totalEnriched += results.length

				console.log("\n── CLASSIFICATION RESULTS ──")
				for (const r of results) {
					console.log(`📌 ${r.repo}#${r.number}:`)
					console.log(`   Category:        ${r.category}`)
					console.log(`   Complexity:      ${r.complexityScore}/5 (${r.complexityReason})`)
					console.log(`   Summary:         ${r.summary}`)
				}
				console.log("─────────────────────────────\n")
			}
		} catch (batchErr) {
			console.error(
				`[enrich-prs] Batch ${i / BATCH_SIZE + 1} failed:`,
				batchErr instanceof Error ? batchErr.message : batchErr,
			)
		}
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
