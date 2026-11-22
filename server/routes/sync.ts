import { SYNC_JOBS, type SyncJob } from "@shared/constants"
import type { AppUser } from "@shared/schema"
import {
	dailyClaudeCodeAttribution,
	dailyCursorUsage,
	dailyGithubActivity,
	syncRuns,
} from "@shared/schema"
import { desc, inArray, min } from "drizzle-orm"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { currentUser, isAuthenticated, requireAdmin } from "../auth/session"
import { db } from "../db"
import { loadConfig } from "../lib/config"
import { daysAgo, today } from "../scripts/lib/shared"
import { dispatchSyncJob } from "../sync/runner"

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
	app.post("/api/admin/sync/:job/run", requireAdmin, async (c) => {
		const job = String(c.req.param("job"))
		if (!SYNC_JOBS.includes(job as SyncJob)) {
			return c.json({ message: "Unknown job" }, 400)
		}

		const full = c.req.query("full") === "true"
		let range: { from: string; to: string } | undefined
		if (full && (job === "anthropic" || job === "cursor" || job === "github")) {
			const table =
				job === "anthropic"
					? dailyClaudeCodeAttribution
					: job === "cursor"
						? dailyCursorUsage
						: dailyGithubActivity
			const [row] = await db.select({ earliest: min(table.date) }).from(table)
			const hasData = row?.earliest != null
			const lookback = hasData ? RECENT_LOOKBACK_DAYS : COLD_START_LOOKBACK_DAYS
			range = { from: daysAgo(lookback), to: today() }
		}

		const me = currentUser(c) as AppUser | null
		const triggeredBy = me?.email ? `user:${me.email}` : "user"
		const result = await dispatchSyncJob(job as SyncJob, { range, triggeredBy })
		if (result.skipped) {
			return c.json({ message: `${job} sync is already running` }, 409)
		}

		return c.json({ ok: true, runId: result.runId }, 202)
	})

	// Admin-only: backfill both syncs for the last N days (PT-aware).
	app.post("/api/admin/sync/backfill", requireAdmin, async (c) => {
		const days = Number(c.req.query("days"))
		if (!Number.isFinite(days) || days < 1 || days > 365) {
			return c.json({ message: "days must be between 1 and 365" }, 400)
		}
		// PT-aware date math: today is the most recent day; from = today - (days-1)
		const range = { from: daysAgo(days), to: today() }

		const cfg = await loadConfig()
		const me = currentUser(c) as AppUser | null
		const triggeredBy = me?.email ? `user:${me.email}` : "user"

		const jobs: SyncJob[] = cfg.githubAccessToken
			? ["anthropic", "cursor", "github"]
			: ["anthropic", "cursor"]
		const dispatched = await Promise.all(
			jobs.map(async (job) => ({ job, res: await dispatchSyncJob(job, { range, triggeredBy }) })),
		)
		const runIds = dispatched.flatMap((d) => (d.res.skipped ? [] : [d.res.runId]))
		const skippedJobs = dispatched.flatMap((d) => (d.res.skipped ? [d.job] : []))

		if (runIds.length === 0) {
			return c.json(
				{ message: "All requested backfill jobs are already running", skippedJobs },
				409,
			)
		}

		return c.json({ ok: true, runIds, ...(skippedJobs.length > 0 ? { skippedJobs } : {}) }, 202)
	})
}
