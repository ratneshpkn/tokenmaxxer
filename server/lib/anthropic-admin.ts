/**
 * Thin client for the Anthropic Admin API.
 * Docs: https://platform.claude.com/docs/en/api/admin
 *       https://platform.claude.com/docs/en/build-with-claude/claude-code-analytics-api
 *       https://platform.claude.com/docs/en/api/admin/cost_report
 *
 * Auth: x-api-key (sk-ant-admin...) + anthropic-version: 2023-06-01
 */

import { fetchWithRetry, type TransportDeps } from "./http-transport"

const BASE_URL = "https://api.anthropic.com"
const API_VERSION = "2023-06-01"

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
	constructor(
		private apiKey: string,
		private deps?: TransportDeps,
	) {
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

		const res = await fetchWithRetry(
			url.toString(),
			{
				method: "GET",
				headers: {
					"x-api-key": this.apiKey,
					"anthropic-version": API_VERSION,
					accept: "application/json",
				},
			},
			{
				label: "anthropic-admin",
				maxRetries429: 5,
				maxRetries5xx: 3,
				maxRetriesNetwork: 3,
				...this.deps,
			},
		)

		if (!res.ok) {
			const body = await res.text()
			throw new Error(`Anthropic admin ${res.status} ${path}: ${body.slice(0, 500)}`)
		}
		return (await res.json()) as T
	}

	async validateCredentials(): Promise<void> {
		await this.request<PageResponse<AnthropicUser>>("/v1/organizations/users", { limit: "1" })
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
