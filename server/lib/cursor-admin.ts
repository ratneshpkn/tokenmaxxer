/**
 * Thin client for the Cursor Admin API.
 * Docs: https://cursor.com/docs/account/teams/admin-api
 *
 * Auth: HTTP Basic, key as username, empty password.
 * Rate limit: 20 req/min on most endpoints. We pace at 18 RPM for safety.
 *
 * Date params on POST endpoints are epoch milliseconds (numbers), not ISO strings.
 */

import { fetchWithRetry, sleep, type TransportDeps } from "./http-transport"

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

	constructor(private sleepFn: (ms: number) => Promise<void> = sleep) {}

	/** Run `fn` after the gate clears. Serializes everything so we never burst. */
	run<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.queue.then(async () => {
			const wait = this.nextReadyAt - Date.now()
			if (wait > 0) await this.sleepFn(wait)
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
	private gate: CursorRateGate
	private readonly authorization: string

	constructor(
		apiKey: string,
		private deps?: TransportDeps,
	) {
		if (!apiKey) throw new Error("Cursor admin API key required")
		this.authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
		this.gate = new CursorRateGate(deps?.sleepFn)
	}

	private async fetch<T>(
		path: string,
		init: { method: "GET" | "POST"; body?: Record<string, unknown> } = { method: "GET" },
	): Promise<T> {
		return this.gate.run(async () => {
			const headers: Record<string, string> = {
				authorization: this.authorization,
				accept: "application/json",
			}
			if (init.body) headers["content-type"] = "application/json"

			const res = await fetchWithRetry(
				BASE_URL + path,
				{
					method: init.method,
					headers,
					body: init.body ? JSON.stringify(init.body) : undefined,
				},
				{
					label: "cursor-admin",
					baseDelayMs: 2000,
					maxRetries429: MAX_RETRIES,
					maxRetries5xx: MAX_RETRIES,
					maxRetriesNetwork: MAX_RETRIES,
					...this.deps,
				},
			)
			if (!res.ok) {
				const t = await res.text()
				throw new Error(`Cursor admin ${res.status} ${path}: ${t.slice(0, 500)}`)
			}
			return (await res.json()) as T
		})
	}

	async validateCredentials(): Promise<void> {
		await this.listMembers()
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
	const dayMs = 24 * 60 * 60 * 1000
	const start = new Date(`${startYmd}T00:00:00Z`).getTime() - dayMs
	const end = new Date(`${endYmd}T23:59:59Z`).getTime() + dayMs
	return [start, end]
}
