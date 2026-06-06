/**
 * Thin client for the Cursor Admin API.
 * Docs: https://cursor.com/docs/account/teams/admin-api
 *
 * Auth: HTTP Basic, key as username, empty password.
 * Rate limit: 20 req/min on most endpoints. We pace at 18 RPM for safety.
 *
 * Date params on POST endpoints are epoch milliseconds (numbers), not ISO strings.
 */

const BASE_URL = "https://api.cursor.com"

const TARGET_RPM = 18
const MIN_INTERVAL_MS = Math.ceil(60_000 / TARGET_RPM) // ~3334ms between calls
const MAX_RETRIES = 3

/** Serial rate-limit gate: enforces a minimum gap between consecutive requests
 *  AND respects 429 retry-after with exponential fallback. Shared across all
 *  CursorAdminClient calls for a given key. */
class CursorRateGate {
	private nextReadyAt = 0
	private queue: Promise<unknown> = Promise.resolve()

	/** Run `fn` after the gate clears. Serializes everything so we never burst. */
	run<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.queue.then(async () => {
			const wait = this.nextReadyAt - Date.now()
			if (wait > 0) await new Promise((r) => setTimeout(r, wait))
			try {
				return await fn()
			} finally {
				this.nextReadyAt = Date.now() + MIN_INTERVAL_MS
			}
		})
		// Don't let one rejection break the chain — only the awaiter sees the error.
		this.queue = next.catch(() => undefined)
		return next as Promise<T>
	}

	/** Bump the gate forward (e.g. after a 429 with Retry-After). */
	waitFor(extraMs: number): void {
		this.nextReadyAt = Math.max(this.nextReadyAt, Date.now() + extraMs)
	}
}

export interface CursorMember {
	id: number
	email: string
	name?: string | null
	role?: string | null
	isRemoved?: boolean
}

export interface CursorSpendRow {
	userId: number
	email: string
	name?: string | null
	role?: string | null
	spendCents: number
	overallSpendCents?: number
	fastPremiumRequests?: number
	hardLimitOverrideDollars?: number | null
	monthlyLimitDollars?: number | null
}

export interface CursorDailyUsageRow {
	userId: number
	day: string // YYYY-MM-DD
	date: number // epoch ms
	email: string
	isActive?: boolean
	totalLinesAdded?: number
	totalLinesDeleted?: number
	acceptedLinesAdded?: number
	acceptedLinesDeleted?: number
	composerRequests?: number
	chatRequests?: number
	agentRequests?: number
	mostUsedModel?: string | null
}

export interface CursorUsageEvent {
	timestamp: string
	userEmail?: string
	model?: string
	kind?: string
	maxMode?: boolean
	isChargeable?: boolean
	tokenUsage?: {
		inputTokens?: number
		outputTokens?: number
		cacheWriteTokens?: number
		cacheReadTokens?: number
		totalCents?: number
	}
	chargedCents?: number
	cursorTokenFee?: number
}

export class CursorAdminClient {
	private gate = new CursorRateGate()
	private readonly authorization: string

	constructor(apiKey: string) {
		if (!apiKey) throw new Error("Cursor admin API key required")
		this.authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
	}

	private async fetch<T>(
		path: string,
		init: { method: "GET" | "POST"; body?: Record<string, unknown> } = { method: "GET" },
	): Promise<T> {
		return this.gate.run(async () => this.doFetch<T>(path, init, 0))
	}

	private async doFetch<T>(
		path: string,
		init: { method: "GET" | "POST"; body?: Record<string, unknown> },
		attempt: number,
	): Promise<T> {
		const headers: Record<string, string> = {
			authorization: this.authorization,
			accept: "application/json",
		}
		if (init.body) headers["content-type"] = "application/json"

		// Network-level errors (ECONNRESET / fetch failed / DNS / etc.) reach us as
		// thrown exceptions, not non-OK responses. Catch and retry with backoff.
		let res: Response
		try {
			res = await fetch(BASE_URL + path, {
				method: init.method,
				headers,
				body: init.body ? JSON.stringify(init.body) : undefined,
			})
		} catch (err) {
			if (attempt < MAX_RETRIES) {
				const backoffMs = 2 ** attempt * 2000
				this.gate.waitFor(backoffMs)
				await new Promise((r) => setTimeout(r, backoffMs))
				return this.doFetch<T>(path, init, attempt + 1)
			}
			throw err
		}

		// Retry on 429 (rate limit) and 5xx (server error) with exponential backoff.
		const retryable = res.status === 429 || (res.status >= 500 && res.status < 600)
		if (retryable && attempt < MAX_RETRIES) {
			const retryAfter = Number(res.headers.get("retry-after"))
			const backoffMs =
				Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 2000 // 2s, 4s, 8s
			this.gate.waitFor(backoffMs)
			await new Promise((r) => setTimeout(r, backoffMs))
			return this.doFetch<T>(path, init, attempt + 1)
		}
		if (!res.ok) {
			const t = await res.text()
			throw new Error(`Cursor admin ${res.status} ${path}: ${t.slice(0, 500)}`)
		}
		return (await res.json()) as T
	}

	async listMembers(): Promise<CursorMember[]> {
		const r = await this.fetch<{ teamMembers: CursorMember[] }>("/teams/members", {
			method: "GET",
		})
		return r.teamMembers ?? []
	}

	async getSpend(): Promise<{ rows: CursorSpendRow[]; cycleStartMs: number | null }> {
		const out: CursorSpendRow[] = []
		let cycleStartMs: number | null = null
		let page = 1
		while (true) {
			const r = await this.fetch<{
				teamMemberSpend: CursorSpendRow[]
				totalPages: number
				subscriptionCycleStart?: number
			}>("/teams/spend", { method: "POST", body: { page, pageSize: 100 } })
			const batch = r.teamMemberSpend ?? []
			out.push(...batch)
			if (cycleStartMs == null && r.subscriptionCycleStart != null) {
				cycleStartMs = r.subscriptionCycleStart
			}
			if (page >= (r.totalPages ?? 1) || batch.length === 0) break
			page++
		}
		return { rows: out, cycleStartMs }
	}

	async dailyUsage(startEpochMs: number, endEpochMs: number): Promise<CursorDailyUsageRow[]> {
		const out: CursorDailyUsageRow[] = []
		let page = 1
		while (true) {
			const r = await this.fetch<{
				data: CursorDailyUsageRow[]
				pagination?: { hasNextPage?: boolean }
			}>("/teams/daily-usage-data", {
				method: "POST",
				body: { startDate: startEpochMs, endDate: endEpochMs, page, pageSize: 1000 },
			})
			const batch = r.data ?? []
			out.push(...batch)
			if (!r.pagination?.hasNextPage || batch.length === 0) break
			page++
		}
		return out
	}

	async filteredUsageEvents(startEpochMs: number, endEpochMs: number): Promise<CursorUsageEvent[]> {
		const out: CursorUsageEvent[] = []
		let page = 1
		while (true) {
			const r = await this.fetch<{
				usageEvents: CursorUsageEvent[]
				pagination?: { hasNextPage?: boolean }
			}>("/teams/filtered-usage-events", {
				method: "POST",
				body: { startDate: startEpochMs, endDate: endEpochMs, page, pageSize: 1000 },
			})
			const batch = r.usageEvents ?? []
			out.push(...batch)
			if (!r.pagination?.hasNextPage || batch.length === 0) break
			page++
		}
		return out
	}
}

/** Returns [startEpochMs, endEpochMs] for the inclusive UTC date range. */
export function dateRangeToEpochMs(startYmd: string, endYmd: string): [number, number] {
	const start = new Date(`${startYmd}T00:00:00Z`).getTime()
	const end = new Date(`${endYmd}T23:59:59Z`).getTime()
	return [start, end]
}
