import { pool } from "../db"
import { daysAgo, yesterday } from "./lib/shared"
import { runAnthropicSync } from "./sync-anthropic"
import { runCursorSync } from "./sync-cursor"

/**
 * Pull historical usage from both platforms.
 * Usage:
 *   bun run server/scripts/backfill.ts                # default 30 days
 *   bun run server/scripts/backfill.ts --days 60
 *   bun run server/scripts/backfill.ts --from 2026-03-01 --to 2026-04-28
 */
async function main(): Promise<void> {
	const argv = process.argv
	const fromIdx = argv.indexOf("--from")
	const toIdx = argv.indexOf("--to")
	const daysIdx = argv.indexOf("--days")

	let from: string
	let to: string
	if (fromIdx >= 0 && toIdx >= 0) {
		from = argv[fromIdx + 1]
		to = argv[toIdx + 1]
	} else {
		const days = daysIdx >= 0 ? parseInt(argv[daysIdx + 1], 10) : 30
		from = daysAgo(days)
		to = yesterday()
	}

	console.log(`[backfill] ${from} → ${to}`)

	console.log(`[backfill] anthropic …`)
	const a = await runAnthropicSync({ from, to })
	console.log(`[backfill] anthropic done: ${a.rowsUpserted} rows`)

	console.log(`[backfill] cursor …`)
	const c = await runCursorSync({ from, to })
	console.log(`[backfill] cursor done: ${c.rowsUpserted} rows`)

	console.log(`[backfill] complete: ${a.rowsUpserted + c.rowsUpserted} rows total`)
}

if (import.meta.main) {
	main()
		.then(() => pool.end())
		.catch((err) => {
			console.error("[backfill] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
