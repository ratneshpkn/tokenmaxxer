import { DEFAULTS } from "@shared/constants"
import { appConfig } from "@shared/schema"
import { eq } from "drizzle-orm"
import { db, pool } from "../db"
import { buildBootstrapUpdates } from "../lib/config"
import { getMasterKey } from "../lib/crypto"

/**
 * Idempotent: runs on every container start.
 *
 *   1. Ensure the `app_config` singleton row exists (id=1) with default thresholds.
 *   2. Auto-import any process.env values into `app_config` (only fills empty columns).
 */
async function main(): Promise<void> {
	getMasterKey()

	await db
		.insert(appConfig)
		.values({
			id: 1,
			claudeCodeDailyThresholdCents: DEFAULTS.thresholds.claude_code_daily_cents,
			cursorDailyThresholdCents: DEFAULTS.thresholds.cursor_daily_cents,
		})
		.onConflictDoNothing({ target: appConfig.id })

	const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1)
	if (!row) throw new Error("[bootstrap-config] app_config singleton missing after insert")

	const updates = buildBootstrapUpdates(row)

	if (Object.keys(updates).length > 0) {
		await db
			.update(appConfig)
			.set({ ...updates, updatedAt: new Date() })
			.where(eq(appConfig.id, 1))
		console.log(
			`[bootstrap-config] imported ${Object.keys(updates).length} env value(s) into app_config`,
		)
	} else {
		console.log("[bootstrap-config] app_config singleton ready")
	}
}

if (import.meta.main) {
	main()
		.then(() => pool.end())
		.catch((err) => {
			console.error("[bootstrap-config] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
