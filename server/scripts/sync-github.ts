import { dailyGithubActivity, githubPullRequests, trackedUsers } from "@shared/schema"
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { GitHubClient, sleep } from "../lib/github"
import { discoverGithubUsernames } from "../lib/github-discovery"
import { bumpSyncRunRows, parseDateRangeArgs, today, withSyncRun, yesterday } from "./lib/shared"

export interface SyncRange {
	from: string
	to: string
}

interface CommitAgg {
	prsOpened: number
	prsMerged: number
	additions: number
	deletions: number
}

function aggKey(date: string, email: string): string {
	return `${date}|${email}`
}

export async function runGithubSync(
	range?: SyncRange,
	opts?: { existingRunId?: string; triggeredBy?: string },
): Promise<{ rowsUpserted: number; runId: string }> {
	return withSyncRun(
		"github",
		async (runId) => {
			const cfg = await loadConfig()
			const token = cfg.githubAccessToken
			const org = cfg.githubOrg
			if (!token) {
				throw new Error("GitHub access token not configured — visit /settings to add one.")
			}
			if (!org) {
				throw new Error(
					"GitHub org not configured — visit /settings to set your GitHub organization.",
				)
			}

			const client = new GitHubClient(token)
			let rowsUpserted = 0
			const fromDay = range?.from ?? yesterday()
			const toDay = range?.to ?? today()

			// ── 1. Build username → email mapping from tracked_users ────────
			const trackedRows = await db
				.select({
					email: trackedUsers.email,
					name: trackedUsers.name,
					githubUsername: trackedUsers.githubUsername,
				})
				.from(trackedUsers)
				.where(eq(trackedUsers.isActive, true))

			const usernameToEmail = new Map<string, string>()

			for (const row of trackedRows) {
				const emailLower = row.email.toLowerCase()
				if (row.githubUsername) {
					usernameToEmail.set(row.githubUsername.toLowerCase(), emailLower)
				}
			}

			// ── 1b. Auto-discover GitHub usernames for users who don't have one ──
			try {
				const newlyMapped = await discoverGithubUsernames(client, org, token)
				for (const [login, email] of newlyMapped) {
					usernameToEmail.set(login.toLowerCase(), email.toLowerCase())
				}
			} catch (err) {
				console.warn(
					`[sync-github] auto-discovery failed: ${err instanceof Error ? err.message : err}`,
				)
			}

			// ── 2. PR data via search API (throttled) ────────────────────────
			// For each tracked user with a GitHub username, query PRs opened/merged
			// in the date range. We query the full range at once and map them exactly.
			const dailyAgg = new Map<string, CommitAgg>()
			const rawPrsToInsert: (typeof githubPullRequests.$inferInsert)[] = []

			const usersWithGithub = Array.from(usernameToEmail.entries())
			const successfulEmails: string[] = []
			for (const [username, email] of usersWithGithub) {
				try {
					// Throttle: 2 calls per user, 2s between batches to stay under 30/min
					const openedDates = await client.getPRsOpenedDates(org, username, fromDay, toDay)
					await sleep(2000)
					const mergedPRs = await client.getMergedPRsDetails(org, username, fromDay, toDay)
					await sleep(2000)

					for (const date of openedDates) {
						if (date >= fromDay && date <= toDay) {
							const key = aggKey(date, email)
							const accum = dailyAgg.get(key) ?? {
								prsOpened: 0,
								prsMerged: 0,
								additions: 0,
								deletions: 0,
							}
							accum.prsOpened = (accum.prsOpened || 0) + 1
							dailyAgg.set(key, accum)
						}
					}

					const CHUNK = 5
					for (let i = 0; i < mergedPRs.length; i += CHUNK) {
						const chunk = mergedPRs.slice(i, i + CHUNK)
						const statsResults = await Promise.all(
							chunk.map(async (pr) => {
								try {
									const stats = await client.getPullRequestStats(org, pr.repo, pr.number)
									return { pr, stats }
								} catch (err) {
									console.error(
										`[sync-github] Failed to get PR stats for ${pr.repo}#${pr.number}`,
										err,
									)
									return { pr, stats: { additions: 0, deletions: 0 } }
								}
							}),
						)

						for (const { pr, stats } of statsResults) {
							const date = pr.mergedAtDateStr
							if (date >= fromDay && date <= toDay) {
								const key = aggKey(date, email)
								const accum = dailyAgg.get(key) ?? {
									prsOpened: 0,
									prsMerged: 0,
									additions: 0,
									deletions: 0,
								}
								accum.prsMerged = (accum.prsMerged || 0) + 1

								// Winsorize per-PR to prevent massive refactors from
								// blowing up the charts. Raw values are preserved in
								// github_pull_requests so we can re-aggregate later
								// with different cutoffs if needed.
								const PR_LINE_CAP = 10_000
								accum.additions += Math.min(stats.additions ?? 0, PR_LINE_CAP)
								accum.deletions += Math.min(stats.deletions ?? 0, PR_LINE_CAP)

								rawPrsToInsert.push({
									repo: pr.repo,
									number: pr.number,
									email,
									title: pr.title ?? "",
									additions: stats.additions ?? 0,
									deletions: stats.deletions ?? 0,
									mergedAt: new Date(pr.mergedAtIso),
								})

								dailyAgg.set(key, accum)
							}
						}
						await sleep(500)
					}

					successfulEmails.push(email)
				} catch (err) {
					console.warn(
						`[sync-github] PR search failed for ${username}: ${err instanceof Error ? err.message : err}`,
					)
				}
			}

			console.log(`[sync-github] collected PR stats and dates for users`)

			// Clear existing activity in the date range for successfully synced users before inserting new sync records
			await db.transaction(async (tx) => {
				if (successfulEmails.length > 0) {
					await tx
						.delete(dailyGithubActivity)
						.where(
							and(
								gte(dailyGithubActivity.date, fromDay),
								lte(dailyGithubActivity.date, toDay),
								inArray(dailyGithubActivity.email, successfulEmails),
							),
						)
				}

				// ── 3. Merge commits + PRs → upsert daily_github_activity ────────
				if (dailyAgg.size > 0) {
					const rows = Array.from(dailyAgg.entries()).map(([key, v]) => {
						const [date, email] = key.split("|")
						return {
							date,
							email,
							prsOpened: v.prsOpened ?? 0,
							prsMerged: v.prsMerged ?? 0,
							additions: v.additions,
							deletions: v.deletions,
						}
					})

					// Batch upsert in chunks of 500
					const CHUNK = 500
					for (let i = 0; i < rows.length; i += CHUNK) {
						const chunk = rows.slice(i, i + CHUNK)
						await tx
							.insert(dailyGithubActivity)
							.values(chunk)
							.onConflictDoUpdate({
								target: [dailyGithubActivity.date, dailyGithubActivity.email],
								set: {
									prsOpened: sql`excluded.prs_opened`,
									prsMerged: sql`excluded.prs_merged`,
									additions: sql`excluded.additions`,
									deletions: sql`excluded.deletions`,
									syncedAt: new Date(),
								},
							})
						rowsUpserted += chunk.length
					}
				}

				// ── 4. Insert raw PR logs ────────
				if (rawPrsToInsert.length > 0) {
					const CHUNK = 500
					for (let i = 0; i < rawPrsToInsert.length; i += CHUNK) {
						const chunk = rawPrsToInsert.slice(i, i + CHUNK)
						await tx
							.insert(githubPullRequests)
							.values(chunk)
							.onConflictDoUpdate({
								target: [githubPullRequests.repo, githubPullRequests.number],
								set: {
									email: sql`excluded.email`,
									title: sql`excluded.title`,
									additions: sql`excluded.additions`,
									deletions: sql`excluded.deletions`,
									mergedAt: sql`excluded.merged_at`,
									syncedAt: new Date(),
								},
							})
					}
				}
			})

			// Update the sync run row counter after the transaction succeeds
			if (rowsUpserted > 0) {
				await bumpSyncRunRows(runId, rowsUpserted)
			}

			console.log(`[sync-github] upserted ${rowsUpserted} rows for ${fromDay}..${toDay}`)
			return { rowsUpserted }
		},
		opts,
	)
}

if (import.meta.main) {
	const range = parseDateRangeArgs(process.argv)
	runGithubSync(range ?? undefined)
		.then(() => pool.end())
		.catch((err) => {
			console.error("[sync-github] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
