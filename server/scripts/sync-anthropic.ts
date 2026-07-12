import {
	anthropicApiKeys,
	anthropicUsers,
	appConfig,
	dailyAnthropicCostTotals,
	dailyMessageUsage,
	trackedUsers,
} from "@shared/schema"
import { eq, sql } from "drizzle-orm"
import { db, pool } from "../db"
import { AnthropicAdminClient, decimalCentsToCents } from "../lib/anthropic-admin"
import { invalidateConfigCache, loadConfig } from "../lib/config"
import { deriveAttribution } from "./lib/derive-attribution"
import { bumpSyncRunRows, parseDateRangeArgs, today, withSyncRun, yesterday } from "./lib/shared"

export interface SyncRange {
	from: string // YYYY-MM-DD inclusive
	to: string // YYYY-MM-DD inclusive
}

/**
 * Try to auto-detect the Claude Code workspace_id by name. Saves to app_config
 * on success so we don't repeat the lookup each sync. Returns null if we
 * can't find a "Claude Code" workspace (e.g., org renamed it).
 */
async function detectClaudeCodeWorkspaceId(client: AnthropicAdminClient): Promise<string | null> {
	for await (const batch of client.listWorkspaces()) {
		for (const ws of batch) {
			if (ws.archived_at) continue
			if (ws.name?.toLowerCase().includes("claude code")) {
				await db
					.update(appConfig)
					.set({ claudeCodeWorkspaceId: ws.id, updatedAt: new Date() })
					.where(eq(appConfig.id, 1))
				invalidateConfigCache()
				console.log(`[sync-anthropic] detected Claude Code workspace: ${ws.id} (${ws.name})`)
				return ws.id
			}
		}
	}
	return null
}

export async function runAnthropicSync(
	range?: SyncRange,
	opts?: { existingRunId?: string; triggeredBy?: string },
): Promise<{ rowsUpserted: number; runId: string }> {
	return withSyncRun(
		"anthropic",
		async (runId) => {
			const cfg = await loadConfig()
			const apiKey = cfg.anthropicAdminApiKey ?? process.env.ANTHROPIC_ADMIN_API_KEY
			if (!apiKey) {
				throw new Error(
					"Anthropic admin API key not configured — visit /setup or /settings to add one.",
				)
			}
			const client = new AnthropicAdminClient(apiKey)
			let rowsUpserted = 0
			const fromDay = range?.from ?? yesterday()
			const toDay = range?.to ?? today()

			// ── 1. Users snapshot ────────────────────────────────────────────────
			for await (const batch of client.listUsers()) {
				if (batch.length === 0) continue
				await db
					.insert(anthropicUsers)
					.values(
						batch.map((u) => ({
							id: u.id,
							email: u.email.toLowerCase(),
							name: u.name ?? null,
							role: u.role,
							addedAt: u.added_at ? new Date(u.added_at) : null,
							syncedAt: new Date(),
						})),
					)
					.onConflictDoUpdate({
						target: anthropicUsers.id,
						set: {
							email: sql`excluded.email`,
							name: sql`excluded.name`,
							role: sql`excluded.role`,
							syncedAt: new Date(),
						},
					})
				rowsUpserted += batch.length
				await db
					.insert(trackedUsers)
					.values(
						batch.map((u) => ({
							email: u.email.toLowerCase(),
							name: u.name ?? null,
							anthropicUserId: u.id,
						})),
					)
					.onConflictDoUpdate({
						target: trackedUsers.email,
						set: { anthropicUserId: sql`excluded.anthropic_user_id`, updatedAt: new Date() },
					})
			}

			// ── 1.5. API keys snapshot ───────────────────────────────────────────
			// Needed for attribution: derive-attribution.ts resolves api_key_id →
			// created_by → user.email via these rows.
			for await (const batch of client.listApiKeys()) {
				if (batch.length === 0) continue
				await db
					.insert(anthropicApiKeys)
					.values(
						batch.map((k) => ({
							id: k.id,
							name: k.name,
							status: k.status,
							workspaceId: k.workspace_id ?? null,
							createdByUserId: k.created_by?.id ?? null,
							createdAt: k.created_at ? new Date(k.created_at) : null,
							syncedAt: new Date(),
						})),
					)
					.onConflictDoUpdate({
						target: anthropicApiKeys.id,
						set: {
							name: sql`excluded.name`,
							status: sql`excluded.status`,
							workspaceId: sql`excluded.workspace_id`,
							createdByUserId: sql`excluded.created_by_user_id`,
							syncedAt: new Date(),
						},
					})
				rowsUpserted += batch.length
			}

			// ── 1.75. Auto-detect Claude Code workspace_id (first sync only) ─────
			let workspaceId = cfg.claudeCodeWorkspaceId
			if (!workspaceId) {
				workspaceId = await detectClaudeCodeWorkspaceId(client)
				if (!workspaceId) {
					throw new Error(
						"Could not auto-detect Claude Code workspace by name. Set claudeCodeWorkspaceId in app_config manually.",
					)
				}
			}

			// ── 2. Messages endpoint: per-api-key tokens, all workspaces ────────
			// Anthropic caps date range at ~30 days per call. Walk the requested
			// range in chunks; persist each chunk inline so partial failure doesn't
			// lose earlier days.
			const MESSAGES_WINDOW_DAYS = 30
			const dayMs = 24 * 60 * 60 * 1000
			const rangeStart = new Date(`${fromDay}T00:00:00Z`).getTime() - dayMs
			const rangeEnd = new Date(`${toDay}T00:00:00Z`).getTime() + 2 * dayMs // exclusive
			// Wrapped non-fatal: if messages pull fails mid-stream, phases 3+4 still
			// run against whatever was committed, and the next sync will refresh.
			try {
				for (let cur = rangeStart; cur < rangeEnd; cur += MESSAGES_WINDOW_DAYS * dayMs) {
					const chunkEnd = Math.min(cur + MESSAGES_WINDOW_DAYS * dayMs, rangeEnd)
					const startISO = new Date(cur).toISOString().replace(/\.\d{3}Z$/, "Z")
					const endISO = new Date(chunkEnd).toISOString().replace(/\.\d{3}Z$/, "Z")
					let chunkRows = 0
					for await (const buckets of client.messagesUsage(startISO, endISO)) {
						const rows: (typeof dailyMessageUsage.$inferInsert)[] = []
						for (const b of buckets) {
							const date = b.starting_at.slice(0, 10)
							for (const r of b.results ?? []) {
								if (!r.api_key_id) continue // skip service-account rows; we attribute by api_key
								const ws = r.workspace_id ?? ""
								const cc = r.cache_creation ?? {}
								rows.push({
									date,
									workspaceId: ws,
									apiKeyId: r.api_key_id,
									model: r.model ?? "",
									serviceTier: r.service_tier ?? "",
									contextWindow: r.context_window ?? "",
									uncachedInputTokens: Number(r.uncached_input_tokens ?? 0),
									cacheReadInputTokens: Number(r.cache_read_input_tokens ?? 0),
									cacheCreation5mTokens: Number(cc.ephemeral_5m_input_tokens ?? 0),
									cacheCreation1hTokens: Number(cc.ephemeral_1h_input_tokens ?? 0),
									outputTokens: Number(r.output_tokens ?? 0),
									webSearchRequests: Number(r.server_tool_use?.web_search_requests ?? 0),
								})
							}
						}
						if (rows.length === 0) continue
						// Chunk inserts to stay under pg param limits.
						const CHUNK = 500
						for (let i = 0; i < rows.length; i += CHUNK) {
							const slice = rows.slice(i, i + CHUNK)
							await db
								.insert(dailyMessageUsage)
								.values(slice)
								.onConflictDoUpdate({
									target: [
										dailyMessageUsage.date,
										dailyMessageUsage.workspaceId,
										dailyMessageUsage.apiKeyId,
										dailyMessageUsage.model,
										dailyMessageUsage.serviceTier,
										dailyMessageUsage.contextWindow,
									],
									set: {
										uncachedInputTokens: sql`excluded.uncached_input_tokens`,
										cacheReadInputTokens: sql`excluded.cache_read_input_tokens`,
										cacheCreation5mTokens: sql`excluded.cache_creation_5m_tokens`,
										cacheCreation1hTokens: sql`excluded.cache_creation_1h_tokens`,
										outputTokens: sql`excluded.output_tokens`,
										webSearchRequests: sql`excluded.web_search_requests`,
										syncedAt: new Date(),
									},
								})
						}
						chunkRows += rows.length
					}
					rowsUpserted += chunkRows
					await bumpSyncRunRows(runId, chunkRows)
					console.log(
						`[sync-anthropic] messages ${startISO.slice(0, 10)}..${endISO.slice(0, 10)}: ${chunkRows} rows`,
					)
				}
			} catch (err) {
				console.warn(
					`[sync-anthropic] messages phase failed (non-fatal — phases 3+4 still run against committed data):`,
					err instanceof Error ? err.message : err,
				)
			}

			// ── 3. Cost report: per-bucket $ totals ─────────────────────────────
			// Same 30-day chunking. Wrapped in try/catch — this endpoint occasionally
			// 500s (Anthropic-side), and phases 1+2 are already committed by now.
			// The attribution derive in phase 4 will skip days that have no cost data.
			try {
				for (let cur = rangeStart; cur < rangeEnd; cur += MESSAGES_WINDOW_DAYS * dayMs) {
					const chunkEnd = Math.min(cur + MESSAGES_WINDOW_DAYS * dayMs, rangeEnd)
					const startISO = new Date(cur).toISOString().replace(/\.\d{3}Z$/, "Z")
					const endISO = new Date(chunkEnd).toISOString().replace(/\.\d{3}Z$/, "Z")
					let chunkRows = 0
					for await (const buckets of client.costReport(startISO, endISO)) {
						const rows: (typeof dailyAnthropicCostTotals.$inferInsert)[] = []
						for (const b of buckets) {
							const date = b.starting_at.slice(0, 10)
							for (const r of b.results ?? []) {
								rows.push({
									date,
									workspaceId: r.workspace_id ?? "",
									model: r.model ?? "",
									serviceTier: r.service_tier ?? "",
									contextWindow: r.context_window ?? "",
									inferenceGeo: r.inference_geo ?? "",
									tokenType: r.token_type ?? "",
									description: r.description ?? "",
									costCents: decimalCentsToCents(r.amount),
								})
							}
						}
						if (rows.length === 0) continue
						const CHUNK = 500
						for (let i = 0; i < rows.length; i += CHUNK) {
							const slice = rows.slice(i, i + CHUNK)
							await db
								.insert(dailyAnthropicCostTotals)
								.values(slice)
								.onConflictDoUpdate({
									target: [
										dailyAnthropicCostTotals.date,
										dailyAnthropicCostTotals.workspaceId,
										dailyAnthropicCostTotals.model,
										dailyAnthropicCostTotals.serviceTier,
										dailyAnthropicCostTotals.contextWindow,
										dailyAnthropicCostTotals.inferenceGeo,
										dailyAnthropicCostTotals.tokenType,
									],
									set: {
										description: sql`excluded.description`,
										costCents: sql`excluded.cost_cents`,
										syncedAt: new Date(),
									},
								})
						}
						chunkRows += rows.length
					}
					rowsUpserted += chunkRows
					await bumpSyncRunRows(runId, chunkRows)
				}
			} catch (err) {
				console.warn(
					`[sync-anthropic] cost_report phase failed (non-fatal — messages data is committed):`,
					err instanceof Error ? err.message : err,
				)
			}

			// ── 4. Derive attribution from the raw tables we just wrote ─────────
			const derived = await deriveAttribution(fromDay, toDay, workspaceId)
			console.log(
				`[sync-anthropic] derived ${derived.rowsUpserted} attribution rows; $${(derived.unmatchedCents / 100).toFixed(2)} unmatched`,
			)
			await bumpSyncRunRows(runId, derived.rowsUpserted)
			rowsUpserted += derived.rowsUpserted

			console.log(`[sync-anthropic] done ${fromDay}..${toDay} — ${rowsUpserted} total rows`)
			return { rowsUpserted }
		},
		opts,
	)
}

if (import.meta.main) {
	const range = parseDateRangeArgs(process.argv)
	runAnthropicSync(range ?? undefined)
		.then(() => pool.end())
		.catch((err) => {
			console.error("[sync-anthropic] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
