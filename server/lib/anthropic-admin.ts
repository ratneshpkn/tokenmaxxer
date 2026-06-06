/**
 * Thin client for the Anthropic Admin API.
 * Docs: https://platform.claude.com/docs/en/api/admin
 *       https://platform.claude.com/docs/en/build-with-claude/claude-code-analytics-api
 *       https://platform.claude.com/docs/en/api/admin/cost_report
 *
 * Auth: x-api-key (sk-ant-admin...) + anthropic-version: 2023-06-01
 */

const BASE_URL = "https://api.anthropic.com"
const API_VERSION = "2023-06-01"

const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 60_000

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Exponential backoff: attempt 1 -> 1s, 2 -> 2s, 3 -> 4s, 4 -> 8s, 5 -> 16s; capped at 60s. */
function backoffMs(attempt: number): number {
	const ms = BACKOFF_BASE_MS * 2 ** (attempt - 1)
	return Math.min(ms, BACKOFF_CAP_MS)
}

/**
 * Parse an HTTP `Retry-After` header value defensively.
 * Per RFC 7231 it can be a non-negative integer (delta-seconds) or an HTTP-date.
 * Returns milliseconds to wait, or null if missing/malformed/non-positive.
 */
function parseRetryAfter(value: string | null): number | null {
	if (!value) return null
	const trimmed = value.trim()
	if (!trimmed) return null
	// delta-seconds (integer)
	if (/^\d+$/.test(trimmed)) {
		const secs = parseInt(trimmed, 10)
		if (!Number.isFinite(secs) || secs < 0) return null
		return Math.min(secs * 1000, BACKOFF_CAP_MS)
	}
	// HTTP-date
	const dateMs = Date.parse(trimmed)
	if (!Number.isFinite(dateMs)) return null
	const delta = dateMs - Date.now()
	if (delta <= 0) return null
	return Math.min(delta, BACKOFF_CAP_MS)
}

export interface AnthropicUser {
	id: string
	email: string
	name?: string | null
	role: string
	added_at: string
}

export interface AnthropicApiKey {
	id: string
	name: string
	workspace_id: string | null
	created_by: { id: string; type: string }
	status: string
	partial_key_hint?: string | null
	created_at: string
	expires_at?: string | null
}

export interface AnthropicWorkspace {
	id: string
	name: string
	archived_at?: string | null
	display_color?: string | null
	created_at: string
}

/** One bucket of /cost_report; results[] is per-(workspace,description). */
export interface CostReportBucket {
	starting_at: string // RFC 3339
	ending_at: string
	results: Array<{
		amount: string // cents as decimal string ("123.45" = $1.23)
		currency: string
		workspace_id?: string | null
		description?: string | null
		cost_type?: string | null
		model?: string | null
		service_tier?: string | null
		token_type?: string | null
		context_window?: string | null
		inference_geo?: string | null
	}>
}

/** One bucket of /usage_report/messages; results[] is per-grouped-row. */
export interface MessagesUsageBucket {
	starting_at: string
	ending_at: string
	results: Array<{
		api_key_id?: string | null
		workspace_id?: string | null
		account_id?: string | null
		service_account_id?: string | null
		model?: string | null
		service_tier?: string | null
		context_window?: string | null
		inference_geo?: string | null
		uncached_input_tokens?: number
		cache_read_input_tokens?: number
		cache_creation?: {
			ephemeral_5m_input_tokens?: number
			ephemeral_1h_input_tokens?: number
		}
		output_tokens?: number
		server_tool_use?: { web_search_requests?: number }
	}>
}

interface PageResponse<T> {
	data: T[]
	has_more: boolean
	next_page?: string | null
}

export class AnthropicAdminClient {
	constructor(private apiKey: string) {
		if (!apiKey) throw new Error("Anthropic admin API key required")
	}

	private async request<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
		const url = new URL(BASE_URL + path)
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v == null) continue
				if (Array.isArray(v)) for (const x of v) url.searchParams.append(`${k}[]`, x)
				else url.searchParams.set(k, v)
			}
		}

		/**
		 * Retry policy (distinct counters per failure class):
		 *   - 429 rate-limit: up to 5 retries. Honors Retry-After header if present
		 *     (delta-seconds int or HTTP-date), else exponential backoff 1s -> 60s cap.
		 *   - 5xx (500/502/503/504): up to 3 retries. Same backoff schedule.
		 *   - Network errors (fetch rejects): up to 3 retries. Same backoff schedule.
		 *   - Other 4xx: throw immediately (caller bug, not transient).
		 * Backoff schedule used when Retry-After is absent: 1s, 2s, 4s, 8s, 16s, capped at 60s.
		 */
		const MAX_RETRIES_429 = 5
		const MAX_RETRIES_5XX = 3
		const MAX_RETRIES_NETWORK = 3
		let attempt429 = 0
		let attempt5xx = 0
		let attemptNetwork = 0

		// eslint-disable-next-line no-constant-condition
		while (true) {
			let res: Response
			try {
				res = await fetch(url.toString(), {
					method: "GET",
					headers: {
						"x-api-key": this.apiKey,
						"anthropic-version": API_VERSION,
						accept: "application/json",
					},
				})
			} catch (err) {
				if (attemptNetwork >= MAX_RETRIES_NETWORK) throw err
				attemptNetwork++
				const waitMs = backoffMs(attemptNetwork)
				const msg = err instanceof Error ? err.message : String(err)
				console.warn(
					`[anthropic-admin] network error (${msg}) — backing off ${Math.round(
						waitMs / 1000,
					)}s (attempt ${attemptNetwork}/${MAX_RETRIES_NETWORK})`,
				)
				await sleep(waitMs)
				continue
			}

			if (res.ok) {
				return (await res.json()) as T
			}

			if (res.status === 429) {
				if (attempt429 >= MAX_RETRIES_429) {
					const body = await res.text()
					throw new Error(`Anthropic admin ${res.status} ${path}: ${body.slice(0, 500)}`)
				}
				attempt429++
				const retryAfter = parseRetryAfter(res.headers.get("retry-after"))
				const waitMs = retryAfter != null ? retryAfter : backoffMs(attempt429)
				// Drain body so the connection can be reused.
				await res.text().catch(() => {})
				console.warn(
					`[anthropic-admin] 429 — backing off ${Math.round(
						waitMs / 1000,
					)}s (attempt ${attempt429}/${MAX_RETRIES_429})`,
				)
				await sleep(waitMs)
				continue
			}

			if (res.status >= 500 && res.status <= 599) {
				if (attempt5xx >= MAX_RETRIES_5XX) {
					const body = await res.text()
					throw new Error(`Anthropic admin ${res.status} ${path}: ${body.slice(0, 500)}`)
				}
				attempt5xx++
				const waitMs = backoffMs(attempt5xx)
				await res.text().catch(() => {})
				console.warn(
					`[anthropic-admin] ${res.status} — backing off ${Math.round(
						waitMs / 1000,
					)}s (attempt ${attempt5xx}/${MAX_RETRIES_5XX})`,
				)
				await sleep(waitMs)
				continue
			}

			// Other 4xx (and any other non-2xx): throw immediately, not transient.
			const body = await res.text()
			throw new Error(`Anthropic admin ${res.status} ${path}: ${body.slice(0, 500)}`)
		}
	}

	private async *paged<T>(
		path: string,
		params?: Record<string, string | string[]>,
	): AsyncGenerator<T[]> {
		let next: string | undefined
		do {
			const merged = { ...(params ?? {}), ...(next ? { page: next } : {}) }
			const page = await this.request<PageResponse<T>>(path, merged)
			yield page.data ?? []
			next = page.has_more ? (page.next_page ?? undefined) : undefined
		} while (next)
	}

	async *listUsers(): AsyncGenerator<AnthropicUser[]> {
		yield* this.paged<AnthropicUser>("/v1/organizations/users", { limit: "1000" })
	}

	async *listApiKeys(): AsyncGenerator<AnthropicApiKey[]> {
		yield* this.paged<AnthropicApiKey>("/v1/organizations/api_keys", { limit: "1000" })
	}

	async *listWorkspaces(): AsyncGenerator<AnthropicWorkspace[]> {
		yield* this.paged<AnthropicWorkspace>("/v1/organizations/workspaces", { limit: "1000" })
	}

	/**
	 * Per-api-key Claude API usage between two RFC 3339 timestamps. Daily granularity.
	 * Hard cap of 5 group_by dimensions on this endpoint.
	 *
	 * `startISO` and `endISO` should be UTC midnights, e.g. "2026-04-28T00:00:00Z".
	 * Default group_by includes the 5 dimensions we need for bucket-level pro-rating
	 * against cost_report: (api_key_id, workspace_id, model, service_tier, context_window).
	 * `inference_geo` is intentionally omitted — its variation is small ("US Inference"
	 * vs "not_available") and dropping it lets us keep workspace_id, which we need
	 * for filtering since 70%+ of api_keys aren't pinned to a workspace.
	 */
	async *messagesUsage(
		startISO: string,
		endISO: string,
		groupBy: string[] = ["api_key_id", "workspace_id", "model", "service_tier", "context_window"],
	): AsyncGenerator<MessagesUsageBucket[]> {
		yield* this.paged<MessagesUsageBucket>("/v1/organizations/usage_report/messages", {
			starting_at: startISO,
			ending_at: endISO,
			bucket_width: "1d",
			group_by: groupBy,
			limit: "31",
		})
	}

	/**
	 * Cost report buckets between two RFC 3339 timestamps. Daily granularity.
	 * `startISO` and `endISO` should be UTC midnights, e.g. "2026-04-28T00:00:00Z".
	 */
	async *costReport(startISO: string, endISO: string): AsyncGenerator<CostReportBucket[]> {
		yield* this.paged<CostReportBucket>("/v1/organizations/cost_report", {
			starting_at: startISO,
			ending_at: endISO,
			bucket_width: "1d",
			group_by: ["workspace_id", "description"],
			limit: "31",
		})
	}
}

/** Parse the cost_report `amount` decimal string ("123.45" cents) to integer cents. */
export function decimalCentsToCents(s: string | number | null | undefined): number {
	if (s == null) return 0
	const n = typeof s === "string" ? parseFloat(s) : s
	if (!Number.isFinite(n)) return 0
	return Math.round(n)
}
