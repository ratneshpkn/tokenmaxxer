import type { AppUser } from "@shared/schema"
import { dailyClaudeCodeAttribution, dailyCursorUsage, syncRuns } from "@shared/schema"
import { desc, inArray, min } from "drizzle-orm"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { isAuthenticated, requireAdmin } from "../auth/session"
import { db } from "../db"
import { runComputeAlerts } from "../scripts/compute-alerts"
import { daysAgo, startSyncRun, yesterday } from "../scripts/lib/shared"
import { runSlackDigest } from "../scripts/slack-digest"
import { runAnthropicSync } from "../scripts/sync-anthropic"
import { runCursorSync } from "../scripts/sync-cursor"
import { currentUser } from "./index"

/** Manual sync button lookbacks. When the platform already has data, we re-pull just
 *  the recent window (cheap, fast, covers the "fix a bad day" case). When the table is
 *  empty (fresh install / cold start), we pull as much history as the API permits. */
const RECENT_LOOKBACK_DAYS = 30
const COLD_START_LOOKBACK_DAYS = 365

const listQuery = z.object({
	limit: z.coerce.number().int().min(1).max(500).default(50),
	ids: z.string().optional(), // comma-separated run ids
})

export function registerSyncRoutes(app: Hono<AppEnv>): void {
	app.get("/api/sync/runs", isAuthenticated, async (c) => {
		const parse = listQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const { ids, limit } = parse.data
		if (ids) {
			const idArr = ids.split(",").filter(Boolean)
			if (idArr.length === 0) return c.json([])
			const rows = await db.select().from(syncRuns).where(inArray(syncRuns.id, idArr))
			return c.json(rows)
		}
		const rows = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(limit)
		return c.json(rows)
	})

	// Admin-only: kick a sync now. Returns immediately with runId; the job runs in the background.
	// Pass ?full=true for anthropic/cursor to backfill recent data. Default lookback is 30 days;
	// when the platform's daily-usage table is empty (cold start), we look back 365 days instead so
	// the dashboard isn't useless on first run.
	app.post("/api/admin/sync/:job/run", requireAdmin, async (c) => {
		const job = String(c.req.param("job"))
		if (job !== "anthropic" && job !== "cursor" && job !== "alerts" && job !== "slack_digest") {
			return c.json({ message: "Unknown job" }, 400)
		}

		const full = c.req.query("full") === "true"
		let range: { from: string; to: string } | undefined
		if (full && (job === "anthropic" || job === "cursor")) {
			const table = job === "anthropic" ? dailyClaudeCodeAttribution : dailyCursorUsage
			const [row] = await db.select({ earliest: min(table.date) }).from(table)
			const hasData = row?.earliest != null
			const lookback = hasData ? RECENT_LOOKBACK_DAYS : COLD_START_LOOKBACK_DAYS
			range = { from: daysAgo(lookback), to: yesterday() }
		}

		// Create the sync_runs row up front so we can return its id immediately.
		// The runner reuses this row via withSyncRun's existingRunId option, so we
		// end up with exactly one row per click — not two.
		const me = currentUser(c) as AppUser | null
		const triggeredBy = me?.email ? `user:${me.email}` : "user"
		const runId = await startSyncRun(job, triggeredBy)

		const opts = { existingRunId: runId }
		const promise =
			job === "anthropic"
				? runAnthropicSync(range, opts)
				: job === "cursor"
					? runCursorSync(range, opts)
					: job === "alerts"
						? runComputeAlerts(opts)
						: runSlackDigest(opts)

		promise.catch((err) => console.error(`[sync route] ${job} failed`, err))

		return c.json({ ok: true, runId }, 202)
	})

	// Admin-only: backfill both syncs for the last N days (PT-aware).
	app.post("/api/admin/sync/backfill", requireAdmin, async (c) => {
		const days = Number(c.req.query("days"))
		if (!Number.isFinite(days) || days < 1 || days > 365) {
			return c.json({ message: "days must be between 1 and 365" }, 400)
		}
		// PT-aware date math: yesterday is the most recent full day; from = yesterday - (days-1)
		const to = yesterday()
		const from = daysAgo(days)

		const me = currentUser(c) as AppUser | null
		const triggeredBy = me?.email ? `user:${me.email}` : "user"
		const aRunId = await startSyncRun("anthropic", triggeredBy)
		const cRunId = await startSyncRun("cursor", triggeredBy)

		runAnthropicSync({ from, to }, { existingRunId: aRunId }).catch((err) =>
			console.error("[sync route] anthropic backfill failed", err),
		)
		runCursorSync({ from, to }, { existingRunId: cRunId }).catch((err) =>
			console.error("[sync route] cursor backfill failed", err),
		)

		return c.json({ ok: true, runIds: [aRunId, cRunId] }, 202)
	})
}
