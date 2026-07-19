import { cursorMembers, cursorSpendSnapshots, dailyCursorUsage, trackedUsers } from "@shared/schema"
import { sql } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { CursorAdminClient, dateRangeToEpochMs } from "../lib/cursor-admin"
import { ensureModelAliases } from "../lib/model-aliases"
import { bumpSyncRunRows, parseDateRangeArgs, today, withSyncRun, yesterday } from "./lib/shared"

export interface SyncRange {
	from: string
	to: string
}

interface Agg {
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheWriteTokens: number
	chargedCents: number
	requestCount: number
}

function aggKey(date: string, email: string, model: string): string {
	return `${date}|${email}|${model}`
}

export async function runCursorSync(
	range?: SyncRange,
	opts?: { existingRunId?: string; triggeredBy?: string },
): Promise<{ rowsUpserted: number; runId: string }> {
	return withSyncRun(
		"cursor",
		async (runId) => {
			const cfg = await loadConfig()
			const apiKey = cfg.cursorAdminApiKey ?? process.env.CURSOR_ADMIN_API_KEY
			if (!apiKey) {
				throw new Error(
					"Cursor admin API key not configured — visit /setup or /settings to add one.",
				)
			}
			if (cfg.cursorAdminApiKey == null && process.env.CURSOR_ADMIN_API_KEY) {
				console.warn(
					"[sync-cursor] WARNING: using CURSOR_ADMIN_API_KEY from process.env (.env fallback). " +
						"Removed in v0.3.",
				)
			}
			const client = new CursorAdminClient(apiKey)
			let rowsUpserted = 0
			const fromDay = range?.from ?? yesterday()
			const toDay = range?.to ?? today()
			// Cursor max date range = 30 days per call. Chunk if needed.
			const [startMs, endMs] = dateRangeToEpochMs(fromDay, toDay)

			// ── 1. Members snapshot ─────────────────────────────────────────────
			const members = await client.listMembers()
			if (members.length > 0) {
				await db
					.insert(cursorMembers)
					.values(
						members.map((m) => ({
							id: String(m.id),
							email: m.email.toLowerCase(),
							name: m.name ?? null,
							role: m.role ?? null,
							isRemoved: m.isRemoved ?? false,
							syncedAt: new Date(),
						})),
					)
					.onConflictDoUpdate({
						target: cursorMembers.id,
						set: {
							email: cursorMembers.email,
							name: cursorMembers.name,
							role: cursorMembers.role,
							isRemoved: cursorMembers.isRemoved,
							syncedAt: new Date(),
						},
					})
				rowsUpserted += members.length
				await bumpSyncRunRows(runId, members.length)

				await db
					.insert(trackedUsers)
					.values(
						members.map((m) => ({
							email: m.email.toLowerCase(),
							name: m.name ?? null,
							cursorUserId: String(m.id),
						})),
					)
					.onConflictDoUpdate({
						target: trackedUsers.email,
						set: { cursorUserId: trackedUsers.cursorUserId, updatedAt: new Date() },
					})
			}

			// ── 2. Spend snapshot (today's view of current cycle) ───────────────
			const { rows: spend, cycleStartMs } = await client.getSpend()
			if (cycleStartMs) {
				console.log(
					`[sync-cursor] cursor billing cycle started ${new Date(cycleStartMs).toISOString().slice(0, 10)}`,
				)
			}
			if (spend.length > 0) {
				const snap = today()
				await db
					.insert(cursorSpendSnapshots)
					.values(
						spend.map((s) => ({
							snapshotDate: snap,
							email: s.email.toLowerCase(),
							spendCents: Math.round(s.spendCents ?? 0),
							overallSpendCents: Math.round(s.overallSpendCents ?? 0),
							fastPremiumRequests: Math.round(s.fastPremiumRequests ?? 0),
							hardLimitDollars: s.hardLimitOverrideDollars ?? null,
							monthlyLimitDollars: s.monthlyLimitDollars ?? null,
						})),
					)
					.onConflictDoUpdate({
						target: [cursorSpendSnapshots.snapshotDate, cursorSpendSnapshots.email],
						set: {
							spendCents: cursorSpendSnapshots.spendCents,
							overallSpendCents: cursorSpendSnapshots.overallSpendCents,
							fastPremiumRequests: cursorSpendSnapshots.fastPremiumRequests,
							syncedAt: new Date(),
						},
					})
				rowsUpserted += spend.length
				await bumpSyncRunRows(runId, spend.length)
			}

			// ── 3. Filtered usage events → aggregate per chunk and persist incrementally ──
			// Cursor caps each call at 30 days. Persist after every chunk so a failure
			// mid-backfill doesn't lose all earlier chunks.
			const dayMs = 24 * 60 * 60 * 1000
			const windowMs = 30 * dayMs
			let totalEvents = 0
			for (let cur = startMs; cur <= endMs; cur += windowMs) {
				const chunkEnd = Math.min(cur + windowMs - 1, endMs)
				const chunkLabel = `${new Date(cur).toISOString().slice(0, 10)}..${new Date(chunkEnd).toISOString().slice(0, 10)}`
				const chunkEvents = await client.filteredUsageEvents(cur, chunkEnd)
				totalEvents += chunkEvents.length

				// Aggregate just this chunk.
				const agg = new Map<string, Agg>()
				for (const ev of chunkEvents) {
					const email = ev.userEmail?.toLowerCase()
					if (!email) continue
					let evDate = toDay
					if (ev.timestamp != null) {
						const raw: unknown = ev.timestamp
						const asNum = typeof raw === "number" ? raw : Number(raw)
						const d = Number.isFinite(asNum) ? new Date(asNum) : new Date(String(raw))
						if (!Number.isNaN(d.getTime())) evDate = d.toISOString().slice(0, 10)
					}
					const model = ev.model ?? "unknown"
					const key = aggKey(evDate, email, model)
					const accum = agg.get(key) ?? {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						chargedCents: 0,
						requestCount: 0,
					}
					accum.inputTokens += ev.tokenUsage?.inputTokens ?? 0
					accum.outputTokens += ev.tokenUsage?.outputTokens ?? 0
					accum.cacheReadTokens += ev.tokenUsage?.cacheReadTokens ?? 0
					accum.cacheWriteTokens += ev.tokenUsage?.cacheWriteTokens ?? 0
					accum.chargedCents += ev.chargedCents ?? 0
					accum.requestCount += 1
					agg.set(key, accum)
				}

				if (agg.size === 0) {
					console.log(`[sync-cursor] chunk ${chunkLabel}: 0 events`)
					continue
				}

				const rows = Array.from(agg.entries()).map(([key, v]) => {
					const [date, email, model] = key.split("|")
					return {
						date,
						email,
						model,
						inputTokens: Math.round(v.inputTokens),
						outputTokens: Math.round(v.outputTokens),
						cacheReadTokens: Math.round(v.cacheReadTokens),
						cacheWriteTokens: Math.round(v.cacheWriteTokens),
						chargedCents: Math.round(v.chargedCents),
						requestCount: v.requestCount,
					}
				})

				await ensureModelAliases(rows.map((r) => r.model))

				await db
					.insert(dailyCursorUsage)
					.values(rows)
					.onConflictDoUpdate({
						target: [dailyCursorUsage.date, dailyCursorUsage.email, dailyCursorUsage.model],
						set: {
							inputTokens: sql`excluded.input_tokens`,
							outputTokens: sql`excluded.output_tokens`,
							cacheReadTokens: sql`excluded.cache_read_tokens`,
							cacheWriteTokens: sql`excluded.cache_write_tokens`,
							chargedCents: sql`excluded.charged_cents`,
							requestCount: sql`excluded.request_count`,
							syncedAt: new Date(),
						},
					})
				rowsUpserted += rows.length
				await bumpSyncRunRows(runId, rows.length)
				console.log(
					`[sync-cursor] chunk ${chunkLabel}: ${chunkEvents.length} events → ${rows.length} rows`,
				)
			}

			console.log(
				`[sync-cursor] upserted ${rowsUpserted} rows (${members.length} members, ${spend.length} spend, ${totalEvents} events for ${fromDay}..${toDay})`,
			)
			return { rowsUpserted }
		},
		opts,
	)
}

if (import.meta.main) {
	const range = parseDateRangeArgs(process.argv)
	runCursorSync(range ?? undefined)
		.then(() => pool.end())
		.catch((err) => {
			console.error("[sync-cursor] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
