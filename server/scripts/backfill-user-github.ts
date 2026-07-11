import { dailyGithubActivity, githubPullRequests } from "@shared/schema"
import { and, eq, gte, lte, sql } from "drizzle-orm"
import { db } from "../db"
import { loadConfig } from "../lib/config"
import { GitHubClient, sleep } from "../lib/github"
import { bumpSyncRunRows, daysAgo, finishSyncRun, startSyncRun, yesterday } from "./lib/shared"

interface BackfillOpts {
	existingRunId?: string
}

/**
 * Backfill GitHub activity for a single user.
 * Fetches commits filtered by author and PRs for just this username,
 * so we don't re-sync the entire org.
 */
export async function backfillUserGithub(
	email: string,
	githubUsername: string,
	lookbackDays: number,
	opts?: BackfillOpts,
): Promise<string> {
	const runId = opts?.existingRunId ?? (await startSyncRun("github", `backfill:${email}`))
	try {
		const cfg = await loadConfig()
		const token = cfg.githubAccessToken
		const org = cfg.githubOrg
		if (!token || !org) {
			throw new Error("GitHub not configured")
		}

		const client = new GitHubClient(token)
		const fromDay = daysAgo(lookbackDays)
		const toDay = yesterday()
		let rowsUpserted = 0

		console.log(
			`[backfill-github] starting for ${email} (gh: ${githubUsername}) ${fromDay}..${toDay}`,
		)

		// 1. PR data
		interface CommitAgg {
			prsOpened: number
			prsMerged: number
			additions: number
			deletions: number
		}
		const agg = new Map<string, CommitAgg>()
		const rawPrsToInsert: (typeof githubPullRequests.$inferInsert)[] = []

		try {
			const openedDates = await client.getPRsOpenedDates(org, githubUsername, fromDay, toDay)
			await sleep(2000)
			const mergedPRs = await client.getMergedPRsDetails(org, githubUsername, fromDay, toDay)

			for (const date of openedDates) {
				if (date >= fromDay && date <= toDay) {
					const key = `${date}|${email}`
					const accum = agg.get(key) ?? {
						prsOpened: 0,
						prsMerged: 0,
						additions: 0,
						deletions: 0,
					}
					accum.prsOpened += 1
					agg.set(key, accum)
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
								`[backfill-github] Failed to get PR stats for ${pr.repo}#${pr.number}`,
								err,
							)
							return { pr, stats: { additions: 0, deletions: 0 } }
						}
					}),
				)

				for (const { pr, stats } of statsResults) {
					const date = pr.mergedAtDateStr
					if (date >= fromDay && date <= toDay) {
						const key = `${date}|${email}`
						const accum = agg.get(key) ?? {
							prsOpened: 0,
							prsMerged: 0,
							additions: 0,
							deletions: 0,
						}
						accum.prsMerged += 1

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

						agg.set(key, accum)
					}
				}
				await sleep(500)
			}
		} catch (err) {
			console.warn(
				`[backfill-github] PR search failed for ${githubUsername}:`,
				err instanceof Error ? err.message : err,
			)
		}

		await db.transaction(async (tx) => {
			// Clear existing activity in the date range before upserting the backfilled records
			await tx
				.delete(dailyGithubActivity)
				.where(
					and(
						eq(dailyGithubActivity.email, email),
						gte(dailyGithubActivity.date, fromDay),
						lte(dailyGithubActivity.date, toDay),
					),
				)

			// 4. Upsert
			if (agg.size > 0) {
				const rows = Array.from(agg.entries()).map(([key, v]) => {
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
								additions: sql`excluded.additions`,
								deletions: sql`excluded.deletions`,
								mergedAt: sql`excluded.merged_at`,
								syncedAt: new Date(),
							},
						})
				}
			}
		})

		if (rowsUpserted > 0) {
			await bumpSyncRunRows(runId, rowsUpserted)
		}

		console.log(`[backfill-github] done for ${email}: ${rowsUpserted} rows`)
		await finishSyncRun(runId, { rowsUpserted })
		return runId
	} catch (err) {
		await finishSyncRun(runId, { error: err as Error })
		throw err
	}
}
