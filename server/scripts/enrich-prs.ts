import { githubPrEnrichments, githubPullRequests } from "@shared/schema"
import { sql } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { classifyPRBatch } from "../lib/enrichment-llm"

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

	const rawPrs = await db.select().from(githubPullRequests)

	let targetPrs = rawPrs

	if (opts?.days && opts.days > 0) {
		const cutoff = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000)
		targetPrs = targetPrs.filter(
			(p) =>
				(p.mergedAt && new Date(p.mergedAt) >= cutoff) ||
				(p.openedAt && new Date(p.openedAt) >= cutoff),
		)
	}

	if (!opts?.forceAll) {
		const existingEnrichments = await db.select().from(githubPrEnrichments)
		const enrichedKeys = new Set(existingEnrichments.map((e) => `${e.repo}#${e.number}`))
		targetPrs = targetPrs.filter((p) => !enrichedKeys.has(`${p.repo}#${p.number}`))
	}

	if (opts?.limit && opts.limit > 0) {
		targetPrs = targetPrs.slice(0, opts.limit)
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
	const BATCH_SIZE = 10

	for (let i = 0; i < targetPrs.length; i += BATCH_SIZE) {
		const batch = targetPrs.slice(i, i + BATCH_SIZE)
		try {
			const results = await classifyPRBatch(
				batch.map((p) => ({
					repo: p.repo,
					number: p.number,
					title: p.title,
					additions: p.additions,
					deletions: p.deletions,
				})),
				llmConfig,
			)

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
