import type { SyncJob } from "@shared/constants"
import { syncRuns } from "@shared/schema"
import { eq, sql } from "drizzle-orm"
import { db } from "../../db"

/** Returns YYYY-MM-DD for the given Date in America/Los_Angeles. */
export function ymd(d: Date, tz = "America/Los_Angeles"): string {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		timeZone: tz,
	})
	return fmt.format(d)
}

/** Parse any UTC/ISO timestamp and convert it to a local date string (YYYY-MM-DD) */
export function toLocalDateStr(
	isoString: string | null | undefined,
	tz = "America/Los_Angeles",
): string {
	if (!isoString) return ""
	try {
		const d = new Date(isoString)
		if (!Number.isNaN(d.getTime())) {
			return d.toLocaleDateString("en-CA", { timeZone: tz })
		}
	} catch (_err) {
		// fallback
	}
	return isoString.slice(0, 10)
}

/** Returns yesterday's date as YYYY-MM-DD in the given tz. */
export function yesterday(tz = "America/Los_Angeles"): string {
	const now = new Date()
	const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
	return ymd(oneDayAgo, tz)
}

/** Returns today's date as YYYY-MM-DD in the given tz. */
export function today(tz = "America/Los_Angeles"): string {
	return ymd(new Date(), tz)
}

/** Returns YYYY-MM-DD for `n` days ago (always >=1 means past). */
export function daysAgo(n: number, tz = "America/Los_Angeles"): string {
	const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000)
	return ymd(d, tz)
}

/** Inclusive list of YYYY-MM-DD dates between `from` and `to`. */
export function listDays(from: string, to: string): string[] {
	const out: string[] = []
	const start = new Date(`${from}T00:00:00Z`)
	const end = new Date(`${to}T00:00:00Z`)
	for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
		out.push(new Date(t).toISOString().slice(0, 10))
	}
	return out
}

/** Parse `--days N` / `--from YYYY-MM-DD` / `--to YYYY-MM-DD` from process.argv. */
export interface DateRangeArgs {
	from: string
	to: string
}
export function parseDateRangeArgs(argv: string[]): DateRangeArgs | null {
	const idx = (k: string): number => argv.indexOf(k)
	const fromIdx = idx("--from")
	const toIdx = idx("--to")
	const daysIdx = idx("--days")
	if (fromIdx >= 0 && toIdx >= 0) {
		return { from: argv[fromIdx + 1], to: argv[toIdx + 1] }
	}
	if (daysIdx >= 0) {
		const n = parseInt(argv[daysIdx + 1], 10)
		if (Number.isFinite(n) && n > 0) {
			return { from: daysAgo(n), to: yesterday() }
		}
	}
	return null
}

export async function startSyncRun(job: SyncJob, triggeredBy?: string): Promise<string> {
	const [row] = await db
		.insert(syncRuns)
		.values({ job, status: "running", startedAt: new Date(), triggeredBy: triggeredBy ?? null })
		.returning({ id: syncRuns.id })
	return row.id
}

/** Bump the `rows_upserted` counter on an in-progress sync_runs row by `delta`.
 *  Called from inside long-running syncs after each chunk/day so the UI's polling
 *  table can show live progress (e.g. "RUNNING · 4,231 rows so far") instead of 0. */
export async function bumpSyncRunRows(runId: string, delta: number): Promise<void> {
	if (delta <= 0) return
	await db.execute(sql`
    update sync_runs set rows_upserted = rows_upserted + ${delta} where id = ${runId}
  `)
}

/** Reap orphaned `running` sync_runs rows. At server boot, any row still in `running`
 *  state is by definition an orphan — no in-process runner exists. Marks them `failed`. */
export async function reapOrphanedSyncRuns(): Promise<number> {
	const result = await db.execute<{ id: string }>(sql`
    update sync_runs
       set status = 'failed',
           completed_at = now(),
           error = 'orphaned (server restart or crash)'
     where status = 'running'
    returning id
  `)
	return result.rows?.length ?? 0
}

export async function finishSyncRun(
	id: string,
	result: { rowsUpserted?: number; error?: Error | string },
): Promise<void> {
	const status = result.error ? "failed" : "success"
	await db
		.update(syncRuns)
		.set({
			status,
			completedAt: new Date(),
			rowsUpserted: result.rowsUpserted ?? 0,
			error: result.error
				? result.error instanceof Error
					? result.error.message
					: String(result.error)
				: null,
		})
		.where(eq(syncRuns.id, id))
}

/** Wraps a sync job: bookends it with sync_runs lifecycle. Pass `existingRunId`
 *  to reuse a row created by the caller (so the HTTP route can return the id
 *  immediately and the runner doesn't insert a duplicate). */
export async function withSyncRun<T extends { rowsUpserted?: number }>(
	job: SyncJob,
	fn: (runId: string) => Promise<T>,
	opts?: { existingRunId?: string; triggeredBy?: string },
): Promise<T & { runId: string }> {
	const id = opts?.existingRunId ?? (await startSyncRun(job, opts?.triggeredBy))
	try {
		const result = await fn(id)
		await finishSyncRun(id, { rowsUpserted: result.rowsUpserted })
		return { ...result, runId: id }
	} catch (err) {
		await finishSyncRun(id, { error: err as Error })
		throw err
	}
}
