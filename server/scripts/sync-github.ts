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

export const PR_LINE_CAP = 10_000

interface CommitAgg {
	prsOpened: number
	prsMerged: number
	additions: number
	deletions: number
}

function aggKey(date: string, email: string): string {
	return `${date}|${email}`
}

/** Shared GitHub PR sync core used by both org-wide `runGithubSync` and single-user `backfillUserGithub`. */
export async function syncGithubUsersActivity(
	client: GitHubClient,
	org: string,
	users: Array<[username: string, email: string]>,
	fromDay: string,
	toDay: string,
	logPrefix = "[sync-github]",
): Promise<number> {
	const dailyAgg = new Map<string, CommitAgg>()
	const rawPrsToInsert: (typeof githubPullRequests.$inferInsert)[] = []
	const successfulEmails: string[] = []
	let lastError: unknown = null

	for (const [username, rawEmail] of users) {
		const email = rawEmail.toLowerCase()
		try {
			// Throttle: 2 calls per user, 2s between batches to stay under 30/min
			const openedDates = await client.getPRsOpenedDates(org, username, fromDay, toDay)
			await sleep(2000)
			const mergedPRs = await client.getMergedPRsDetails(org, username, fromDay, toDay)
			if (users.length > 1) await sleep(2000)

			for (const date of openedDates) {
				if (date >= fromDay && date <= toDay) {
					const key = aggKey(date, email)
					const accum = dailyAgg.get(key) ?? {
						prsOpened: 0,
						prsMerged: 0,
						additions: 0,
						deletions: 0,
					}
					accum.prsOpened += 1
					dailyAgg.set(key, accum)
				}
			}

			const CHUNK = 5
			for (let i = 0; i < mergedPRs.length; i += CHUNK) {
				const chunk = mergedPRs.slice(i, i + CHUNK)
				const statsResults = await Promise.all(
					chunk.map(async (pr) => {
						try {
							const stats = await client.getPullRequestDetails(org, pr.repo, pr.number)
							return { pr, stats }
						} catch (err) {
							console.error(`${logPrefix} Failed to get PR stats for ${pr.repo}#${pr.number}`, err)
							return { pr, stats: { additions: 0, deletions: 0, body: null } }
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
						accum.prsMerged += 1
						// Winsorize per-PR to prevent massive refactors from blowing up charts.
						accum.additions += Math.min(stats.additions ?? 0, PR_LINE_CAP)
						accum.deletions += Math.min(stats.deletions ?? 0, PR_LINE_CAP)

						rawPrsToInsert.push({
							repo: pr.repo,
							number: pr.number,
							email,
							title: pr.title ?? "",
							body: stats.body ?? null,
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
			lastError = err
			console.warn(
				`${logPrefix} PR search failed for ${username}: ${err instanceof Error ? err.message : err}`,
			)
		}
	}

	if (users.length > 0 && successfulEmails.length === 0) {
		const reason =
			lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error")
		throw new Error(`${logPrefix} GitHub sync failed for all ${users.length} user(s): ${reason}`)
	}

	let rowsUpserted = 0
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

		if (dailyAgg.size > 0) {
			const rows = Array.from(dailyAgg.entries()).map(([key, v]) => {
				const [date, email] = key.split("|")
				return {
					date,
					email,
					prsOpened: v.prsOpened,
					prsMerged: v.prsMerged,
					additions: v.additions,
					deletions: v.deletions,
				}
			})

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
							body: sql`coalesce(excluded.body, ${githubPullRequests.body})`,
							additions: sql`excluded.additions`,
							deletions: sql`excluded.deletions`,
							mergedAt: sql`excluded.merged_at`,
							syncedAt: new Date(),
						},
					})
			}
		}
	})

	return rowsUpserted
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
			const fromDay = range?.from ?? yesterday()
			const toDay = range?.to ?? today()

			const trackedRows = await db
				.select({
					email: trackedUsers.email,
					githubUsername: trackedUsers.githubUsername,
				})
				.from(trackedUsers)
				.where(eq(trackedUsers.isActive, true))

			const usernameToEmail = new Map<string, string>()
			for (const row of trackedRows) {
				if (row.githubUsername) {
					usernameToEmail.set(row.githubUsername.toLowerCase(), row.email.toLowerCase())
				}
			}

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

			const rowsUpserted = await syncGithubUsersActivity(
				client,
				org,
				Array.from(usernameToEmail.entries()),
				fromDay,
				toDay,
				"[sync-github]",
			)

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
