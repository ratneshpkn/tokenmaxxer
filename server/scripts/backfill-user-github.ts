import { loadConfig } from "../lib/config"
import { GitHubClient } from "../lib/github"
import { bumpSyncRunRows, daysAgo, withSyncRun, yesterday } from "./lib/shared"
import { syncGithubUsersActivity } from "./sync-github"

interface BackfillOpts {
	existingRunId?: string
}

/**
 * Backfill GitHub activity for a single user by delegating to the shared
 * `syncGithubUsersActivity` core inside `withSyncRun`.
 */
export async function backfillUserGithub(
	email: string,
	githubUsername: string,
	lookbackDays: number,
	opts?: BackfillOpts,
): Promise<string> {
	const { runId } = await withSyncRun(
		"github",
		async (id) => {
			const cfg = await loadConfig()
			const token = cfg.githubAccessToken
			const org = cfg.githubOrg
			if (!token || !org) {
				throw new Error("GitHub not configured")
			}

			const fromDay = daysAgo(lookbackDays)
			const toDay = yesterday()
			console.log(
				`[backfill-github] starting for ${email} (gh: ${githubUsername}) ${fromDay}..${toDay}`,
			)

			const rowsUpserted = await syncGithubUsersActivity(
				new GitHubClient(token),
				org,
				[[githubUsername, email]],
				fromDay,
				toDay,
				"[backfill-github]",
			)

			if (rowsUpserted > 0) {
				await bumpSyncRunRows(id, rowsUpserted)
			}
			console.log(`[backfill-github] done for ${email}: ${rowsUpserted} rows`)
			return { rowsUpserted }
		},
		{ existingRunId: opts?.existingRunId, triggeredBy: `backfill:${email}` },
	)
	return runId
}
