/** Caches each PR's changed-file list (no patch content) into
 *  `github_pull_requests.files`, so PR enrichment can compute complexity signals
 *  without hitting GitHub. A merged PR's file list is immutable, so rows are
 *  fetched once and never refreshed. */

import { githubPullRequests } from "@shared/schema"
import { and, eq, isNull } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { GitHubClient, sleep } from "../lib/github"
import { bumpSyncRunRows, withSyncRun } from "./lib/shared"

const CONCURRENCY = 5
const CHUNK_PAUSE_MS = 500

export async function runPrFilesSync(opts?: {
	existingRunId?: string
	triggeredBy?: string
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

			const pending = await db
				.select({ repo: githubPullRequests.repo, number: githubPullRequests.number })
				.from(githubPullRequests)
				.where(isNull(githubPullRequests.files))

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
	runPrFilesSync()
		.then(() => pool.end())
		.catch((err) => {
			console.error("[sync-pr-files] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
