import { db, pool } from "../db"
import { dailyGithubActivity } from "@shared/schema"
import { runGithubSync } from "./sync-github"
import { daysAgo } from "./lib/shared"

async function main() {
	console.log("[reset-github] Clearing all rows in daily_github_activity...")
	await db.delete(dailyGithubActivity)
	console.log("[reset-github] Truncated daily_github_activity successfully.")

	// Let's run a full backfill for 365 days
	const lookback = 365
	const from = daysAgo(lookback)
	const to = daysAgo(1) // yesterday
	console.log(`[reset-github] Running full 365-day backfill: ${from} .. ${to}`)
	
	const res = await runGithubSync({ from, to })
	console.log(`[reset-github] Backfill completed! Upserted ${res.rowsUpserted} rows.`)
}

main()
	.then(() => pool.end())
	.catch((err) => {
		console.error("[reset-github] FAILED", err)
		pool.end()
		process.exit(1)
	})
