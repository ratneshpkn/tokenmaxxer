import { anthropicApiKeys, anthropicUsers, dailyClaudeCodeAttribution } from "@shared/schema"
import { sql } from "drizzle-orm"
import { db } from "../../db"
import { ensureModelAliases } from "../../lib/model-aliases"

/**
 * Pro-rate cost_report buckets across api_keys (by token share within each
 * bucket), resolve api_key → email via the snapshot tables, and upsert into
 * daily_claude_code_attribution for the given date range and workspace.
 *
 * This is a pure derivation: given the same raw inputs in daily_message_usage
 * and daily_anthropic_cost_totals, this produces the same attribution table
 * rows. Safe to re-run.
 *
 * Bucket dimensions for the join: (model, service_tier, context_window, token_type).
 * inference_geo is intentionally excluded — usage_report/messages has a 5
 * group_by dimension cap, and we spend that slot on workspace_id (which we
 * need to filter, since most api_keys aren't workspace-pinned). The remaining
 * dimensions cover ~91% of cost; the rest (geo variance, web_search costs,
 * etc.) falls into the unattributed remainder.
 *
 * Token-type mapping between the two endpoints (verified empirically against
 * the live API — see brainstorm notes):
 *   cost_report token_type                          | messages token field
 *   ────────────────────────────────────────────────|──────────────────────────────
 *   "uncached_input_tokens"                         | uncached_input_tokens
 *   "cache_read_input_tokens"                       | cache_read_input_tokens
 *   "cache_creation.ephemeral_5m_input_tokens"      | cache_creation_5m_tokens
 *   "cache_creation.ephemeral_1h_input_tokens"      | cache_creation_1h_tokens
 *   "output_tokens"                                 | output_tokens
 */
export async function deriveAttribution(
	fromDay: string,
	toDay: string,
	workspaceId: string,
): Promise<{ rowsUpserted: number; unmatchedCents: number }> {
	// Resolve api_key_id → email via the snapshot tables. Built once in-memory
	// since we'll reference it for every row.
	const apiKeys = await db.select().from(anthropicApiKeys)
	const users = await db.select().from(anthropicUsers)
	const userIdToEmail = new Map<string, string>()
	for (const u of users) userIdToEmail.set(u.id, u.email)
	const apiKeyToEmail = new Map<string, string>()
	for (const k of apiKeys) {
		const email = k.createdByUserId ? userIdToEmail.get(k.createdByUserId) : null
		// Fall back to a synthetic bucket if the api_key has no resolvable creator
		// (deleted user, system-generated key). These show up alongside real
		// engineers in the dashboard with an `apikey:` prefix.
		apiKeyToEmail.set(k.id, email ?? `apikey::${k.id}`.toLowerCase().slice(0, 320))
	}

	// Pull the raw window in one shot per table. Both are small (~100s rows/day).
	const costRows = await db.execute<{
		date: string
		model: string
		service_tier: string
		context_window: string
		token_type: string
		cost_cents: number
	}>(sql`
    select date::text, model, service_tier, context_window, token_type,
           sum(cost_cents)::int as cost_cents
    from daily_anthropic_cost_totals
    where date >= ${fromDay}::date and date <= ${toDay}::date
      and workspace_id = ${workspaceId}
    group by 1, 2, 3, 4, 5
  `)
	const messageRows = await db.execute<{
		date: string
		api_key_id: string
		model: string
		service_tier: string
		context_window: string
		uncached_input_tokens: number
		cache_read_input_tokens: number
		cache_creation_5m_tokens: number
		cache_creation_1h_tokens: number
		output_tokens: number
	}>(sql`
    select date::text, api_key_id, model, service_tier, context_window,
           uncached_input_tokens, cache_read_input_tokens,
           cache_creation_5m_tokens, cache_creation_1h_tokens, output_tokens
    from daily_message_usage
    where date >= ${fromDay}::date and date <= ${toDay}::date
      and workspace_id = ${workspaceId}
  `)

	// Map cost_report token_type strings to messages token-field names so we can
	// match buckets across the two endpoints. Exact match only — anything else
	// (e.g., a new token_type Anthropic adds) falls through to unmatchedCents
	// where it's observable in the sync log.
	function messageFieldForTokenType(tt: string): keyof TokensByType | null {
		if (tt === "cache_creation.ephemeral_5m_input_tokens") return "cache_creation_5m_tokens"
		if (tt === "cache_creation.ephemeral_1h_input_tokens") return "cache_creation_1h_tokens"
		if (tt === "cache_read_input_tokens") return "cache_read_input_tokens"
		if (tt === "output_tokens") return "output_tokens"
		if (tt === "uncached_input_tokens") return "uncached_input_tokens"
		return null
	}

	type TokensByType = {
		uncached_input_tokens: number
		cache_read_input_tokens: number
		cache_creation_5m_tokens: number
		cache_creation_1h_tokens: number
		output_tokens: number
	}
	// Per (date, model, tier, ctx, token_type, api_key_id) tokens.
	type BucketKey = string
	const bucketKey = (d: string, m: string, t: string, c: string, tt: string) =>
		`${d}|${m}|${t}|${c}|${tt}`
	const bucketTokens = new Map<BucketKey, Map<string, number>>()
	function addBucketToken(
		date: string,
		model: string,
		tier: string,
		ctx: string,
		tt: keyof TokensByType,
		apiKeyId: string,
		tokens: number,
	): void {
		if (!tokens) return
		const k = bucketKey(date, model, tier, ctx, tt)
		let m = bucketTokens.get(k)
		if (!m) {
			m = new Map()
			bucketTokens.set(k, m)
		}
		m.set(apiKeyId, (m.get(apiKeyId) ?? 0) + tokens)
	}
	for (const r of messageRows.rows ?? []) {
		addBucketToken(
			r.date,
			r.model,
			r.service_tier,
			r.context_window,
			"uncached_input_tokens",
			r.api_key_id,
			Number(r.uncached_input_tokens),
		)
		addBucketToken(
			r.date,
			r.model,
			r.service_tier,
			r.context_window,
			"cache_read_input_tokens",
			r.api_key_id,
			Number(r.cache_read_input_tokens),
		)
		addBucketToken(
			r.date,
			r.model,
			r.service_tier,
			r.context_window,
			"cache_creation_5m_tokens",
			r.api_key_id,
			Number(r.cache_creation_5m_tokens),
		)
		addBucketToken(
			r.date,
			r.model,
			r.service_tier,
			r.context_window,
			"cache_creation_1h_tokens",
			r.api_key_id,
			Number(r.cache_creation_1h_tokens),
		)
		addBucketToken(
			r.date,
			r.model,
			r.service_tier,
			r.context_window,
			"output_tokens",
			r.api_key_id,
			Number(r.output_tokens),
		)
	}

	// Pro-rate. For each cost bucket, distribute cost_cents to api_keys by
	// their share of the matching token bucket. Accumulate per (date, email, model).
	type EmailModelKey = string
	interface Attr {
		uncached_input_tokens: number
		cache_read_input_tokens: number
		cache_creation_5m_tokens: number
		cache_creation_1h_tokens: number
		output_tokens: number
		attributed_cents: number
	}
	const attributions = new Map<EmailModelKey, Attr>()
	function attrKey(date: string, email: string, model: string): EmailModelKey {
		return `${date}|${email}|${model}`
	}
	function bumpAttr(date: string, email: string, model: string, mut: (a: Attr) => void): void {
		const k = attrKey(date, email, model)
		let a = attributions.get(k)
		if (!a) {
			a = {
				uncached_input_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation_5m_tokens: 0,
				cache_creation_1h_tokens: 0,
				output_tokens: 0,
				attributed_cents: 0,
			}
			attributions.set(k, a)
		}
		mut(a)
	}

	// First pass: distribute tokens per api_key into the attribution table.
	// (These get attributed regardless of whether the corresponding cost row
	// exists — we want to surface engineers' token activity even if cost data
	// for that day hasn't landed yet.)
	for (const r of messageRows.rows ?? []) {
		const email = apiKeyToEmail.get(r.api_key_id) ?? `apikey::${r.api_key_id}`
		bumpAttr(r.date, email, r.model, (a) => {
			a.uncached_input_tokens += Number(r.uncached_input_tokens)
			a.cache_read_input_tokens += Number(r.cache_read_input_tokens)
			a.cache_creation_5m_tokens += Number(r.cache_creation_5m_tokens)
			a.cache_creation_1h_tokens += Number(r.cache_creation_1h_tokens)
			a.output_tokens += Number(r.output_tokens)
		})
	}

	// Second pass: pro-rate cost_cents within each (date, model, tier, ctx, token_type) bucket.
	let unmatchedCents = 0
	for (const c of costRows.rows ?? []) {
		const tt = messageFieldForTokenType(c.token_type)
		if (!tt) {
			unmatchedCents += Number(c.cost_cents)
			continue
		}
		const bk = bucketKey(c.date, c.model, c.service_tier, c.context_window, tt)
		const keyTokens = bucketTokens.get(bk)
		if (!keyTokens) {
			unmatchedCents += Number(c.cost_cents)
			continue
		}
		let total = 0
		for (const t of keyTokens.values()) total += t
		if (total === 0) {
			unmatchedCents += Number(c.cost_cents)
			continue
		}
		const costCents = Number(c.cost_cents)
		for (const [apiKeyId, tokens] of keyTokens) {
			const attrib = Math.round((tokens / total) * costCents)
			if (attrib === 0) continue
			const email = apiKeyToEmail.get(apiKeyId) ?? `apikey::${apiKeyId}`
			bumpAttr(c.date, email, c.model, (a) => {
				a.attributed_cents += attrib
			})
		}
	}

	// Bulk insert. Chunk to stay under postgres param limits (~32k).
	const rows: Array<typeof dailyClaudeCodeAttribution.$inferInsert> = []
	for (const [k, v] of attributions) {
		const [date, email, model] = k.split("|")
		rows.push({
			date,
			email,
			model,
			uncachedInputTokens: v.uncached_input_tokens,
			cacheReadInputTokens: v.cache_read_input_tokens,
			cacheCreation5mTokens: v.cache_creation_5m_tokens,
			cacheCreation1hTokens: v.cache_creation_1h_tokens,
			outputTokens: v.output_tokens,
			attributedCents: v.attributed_cents,
		})
	}
	// Wipe + bulk insert in a single transaction so a mid-chunk failure rolls
	// back the delete (no half-populated window). The (date, email, model) PK
	// might shift if api_keys move between owners, so we delete-then-insert
	// rather than upsert.
	const CHUNK = 500

	await ensureModelAliases(rows.map((r) => r.model))

	await db.transaction(async (tx) => {
		await tx.execute(sql`
      delete from daily_claude_code_attribution
      where date >= ${fromDay}::date and date <= ${toDay}::date
    `)
		for (let i = 0; i < rows.length; i += CHUNK) {
			const slice = rows.slice(i, i + CHUNK)
			if (slice.length === 0) continue
			await tx.insert(dailyClaudeCodeAttribution).values(slice)
		}
	})

	return { rowsUpserted: rows.length, unmatchedCents }
}
