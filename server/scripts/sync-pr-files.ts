/** Caches each PR's changed-file list (including full patch content for non-blacklisted
 *  files) into `github_pull_requests.files`, so PR enrichment can compute complexity
 *  signals and inspect actual diffs without hitting GitHub repeatedly. */

import { githubPullRequests } from "@shared/schema"
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { GitHubClient, sleep } from "../lib/github"
import { bumpSyncRunRows, withSyncRun } from "./lib/shared"

const CONCURRENCY = 5
const CHUNK_PAUSE_MS = 500

export async function runPrFilesSync(opts?: {
	existingRunId?: string
	triggeredBy?: string
	/** Re-fetch PRs whose cached `files` entries were stored before `patch` caching was enabled. */
	backfillPatches?: boolean
	/** Optional cutoff (in days) when backfilling patches. */
	days?: number
	/** Optional row cap per run. */
	limit?: number
}): Promise<{ rowsUpserted: number; runId: string }> {
	return withSyncRun(
		"pr_files",
		async (runId) => {
			const cfg = await loadConfig()
			const token = cfg.githubAccessToken
			const org = cfg.githubOrg
			if (!token) {
				throw new Error("GitHub access token not configured — visit /settings to add one.")
			}
			if (!org) {
				throw new Error("GitHub org not configured — visit /settings to set your organization.")
			}

			const missingCondition = opts?.backfillPatches
				? or(
						isNull(githubPullRequests.files),
						// Re-fetch rows that have at least one file with changed lines and no `patch` key anywhere
						sql`(
							jsonb_typeof(${githubPullRequests.files}) = 'array'
							and jsonb_array_length(${githubPullRequests.files}) > 0
							and not exists (
								select 1
								from jsonb_array_elements(${githubPullRequests.files}) as elem
								where elem ? 'patch'
							)
						)`,
					)
				: isNull(githubPullRequests.files)

			const conditions = [missingCondition]
			if (opts?.days && opts.days > 0) {
				const cutoff = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000)
				conditions.push(
					or(gte(githubPullRequests.mergedAt, cutoff), gte(githubPullRequests.openedAt, cutoff)),
				)
			}

			let query = db
				.select({ repo: githubPullRequests.repo, number: githubPullRequests.number })
				.from(githubPullRequests)
				.where(and(...conditions))
				.orderBy(desc(githubPullRequests.mergedAt))
				.$dynamic()

			if (opts?.limit && opts.limit > 0) {
				query = query.limit(opts.limit).$dynamic()
			}

			const pending = await query

			if (pending.length === 0) {
				console.log("[sync-pr-files] No PRs missing cached file data.")
				return { rowsUpserted: 0 }
			}

			console.log(`[sync-pr-files] Fetching file lists for ${pending.length} PR(s)...`)

			const client = new GitHubClient(token)
			let rowsUpserted = 0

			for (let i = 0; i < pending.length; i += CONCURRENCY) {
				const chunk = pending.slice(i, i + CONCURRENCY)
				const fetched = await Promise.all(
					chunk.map(async (pr) => {
						try {
							const files = await client.getPullRequestFiles(org, pr.repo, pr.number)
							return { pr, files }
						} catch (err) {
							console.warn(
								`[sync-pr-files] Failed to fetch files for ${pr.repo}#${pr.number}:`,
								err instanceof Error ? err.message : err,
							)
							return null
						}
					}),
				)

				const written = fetched.filter((r) => r !== null)
				await Promise.all(
					written.map((row) =>
						db
							.update(githubPullRequests)
							.set({ files: row.files })
							.where(
								and(
									eq(githubPullRequests.repo, row.pr.repo),
									eq(githubPullRequests.number, row.pr.number),
								),
							),
					),
				)
				rowsUpserted += written.length
				// Report progress as we go so the polling UI shows a live count on a
				// job that can run for a long time.
				if (written.length > 0) await bumpSyncRunRows(runId, written.length)

				await sleep(CHUNK_PAUSE_MS)
			}

			console.log(`[sync-pr-files] Cached file data for ${rowsUpserted} PR(s).`)
			return { rowsUpserted }
		},
		opts,
	)
}

if (import.meta.main) {
	const backfillPatches = process.argv.includes("--backfill-patches")
	let days: number | undefined
	const daysIdx = process.argv.indexOf("--days")
	if (daysIdx !== -1 && process.argv[daysIdx + 1]) {
		const parsed = parseInt(process.argv[daysIdx + 1], 10)
		if (Number.isFinite(parsed) && parsed > 0) days = parsed
	}
	let limit: number | undefined
	const limitIdx = process.argv.indexOf("--limit")
	if (limitIdx !== -1 && process.argv[limitIdx + 1]) {
		const parsed = parseInt(process.argv[limitIdx + 1], 10)
		if (Number.isFinite(parsed) && parsed > 0) limit = parsed
	}

	runPrFilesSync({ backfillPatches, days, limit })
		.then(() => pool.end())
		.catch((err) => {
			console.error("[sync-pr-files] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
