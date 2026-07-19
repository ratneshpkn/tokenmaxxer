import { sql } from "drizzle-orm"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { isAuthenticated } from "../auth/session"
import { db } from "../db"
import { coerceTrendArrays, resolveWindow, stripCostForViewer } from "../lib/route-helpers"
import { currentRole } from "./index"

const dateRangeBase = z.object({
	from: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	to: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	days: z.coerce.number().int().min(1).max(365).optional(),
})

const summaryQuery = dateRangeBase
	.extend({
		platform: z.enum(["claude_code", "cursor", "all"]).default("all"),
	})
	.refine((q) => (q.from && q.to) || (!q.from && !q.to), {
		message: "from and to must be provided together",
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be <= to" })

const topUsersQuery = dateRangeBase
	.extend({
		platform: z.enum(["claude_code", "cursor", "all"]).default("all"),
		limit: z.coerce.number().int().min(1).max(200).default(50),
		metric: z.enum(["cost", "tokens"]).default("cost"),
	})
	.refine((q) => (q.from && q.to) || (!q.from && !q.to), {
		message: "from and to must be provided together",
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be <= to" })

const trendQuery = dateRangeBase
	.extend({
		platform: z.enum(["claude_code", "cursor", "all"]).default("all"),
	})
	.refine((q) => (q.from && q.to) || (!q.from && !q.to), {
		message: "from and to must be provided together",
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be <= to" })

export function registerModelRoutes(app: Hono<AppEnv>): void {
	app.get("/api/models/:model", isAuthenticated, async (c) => {
		const parse = summaryQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const model = decodeURIComponent(c.req.param("model"))
		const { from, to, days, platform } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const role = currentRole(c)
		const isViewer = role !== "admin"

		const includeCC = platform === "all" || platform === "claude_code"
		const includeCU = platform === "all" || platform === "cursor"

		// Resolve input model to its base model if it's a raw model
		const aliasLookup = await db.execute(sql`
			select base_model from model_aliases where raw_model = ${model}
		`)
		const baseModelName = (aliasLookup.rows[0]?.base_model as string) || model

		const result = await db.execute(sql`
			with
			cc as (
				select
					coalesce(sum(d.attributed_cents), 0)::bigint as cents,
					coalesce(sum(d.uncached_input_tokens + d.cache_read_input_tokens + d.cache_creation_5m_tokens + d.cache_creation_1h_tokens + d.output_tokens), 0)::bigint as tokens
				from daily_claude_code_attribution d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) and d.date between ${effFrom} and ${effTo} and ${includeCC}
			),
			cu as (
				select
					coalesce(sum(d.charged_cents), 0)::bigint as cents,
					coalesce(sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens), 0)::bigint as tokens
				from daily_cursor_usage d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) and d.date between ${effFrom} and ${effTo} and ${includeCU}
			),
			plat_cc as (
				select 'claude_code'::text as platform 
				from daily_claude_code_attribution d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) limit 1
			),
			plat_cu as (
				select 'cursor'::text as platform 
				from daily_cursor_usage d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) limit 1
			),
			active_users as (
				select count(distinct email)::integer as active_users_count
				from (
					select d.email 
					from daily_claude_code_attribution d
					left join model_aliases ma on ma.raw_model = d.model
					where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) and d.date between ${effFrom} and ${effTo} and ${includeCC}
					union
					select d.email 
					from daily_cursor_usage d
					left join model_aliases ma on ma.raw_model = d.model
					where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) and d.date between ${effFrom} and ${effTo} and ${includeCU}
				) u
			)
			select
				(select coalesce(cents, 0) from cc) as cc_cents,
				(select coalesce(tokens, 0) from cc) as cc_tokens,
				(select coalesce(cents, 0) from cu) as cu_cents,
				(select coalesce(tokens, 0) from cu) as cu_tokens,
				(select array_agg(platform) from (select platform from plat_cc union all select platform from plat_cu) p) as platforms,
				(select active_users_count from active_users) as active_users
		`)

		const row = result.rows[0] as Record<string, unknown> | undefined
		if (!row?.platforms || (row.platforms as unknown[]).length === 0) {
			return c.json({ message: "Model not found" }, 404)
		}

		// Retrieve mapped raw models
		const rawModelsRes = await db.execute(sql`
			select raw_model
			from model_aliases
			where base_model = ${baseModelName}
		`)
		let rawModelsList = rawModelsRes.rows.map((r) => r.raw_model as string)
		if (rawModelsList.length === 0) {
			rawModelsList = [baseModelName]
		}

		const data = {
			model: baseModelName,
			base_model: baseModelName,
			raw_models: rawModelsList,
			platforms: row.platforms || [],
			cc_cents: Number(row.cc_cents),
			cu_cents: Number(row.cu_cents),
			cc_tokens: Number(row.cc_tokens),
			cu_tokens: Number(row.cu_tokens),
			total_cents: Number(row.cc_cents) + Number(row.cu_cents),
			total_tokens: Number(row.cc_tokens) + Number(row.cu_tokens),
			active_users: Number(row.active_users || 0),
		}

		if (platform === "claude_code") {
			data.cu_cents = 0
			data.cu_tokens = 0
			data.total_cents = data.cc_cents
			data.total_tokens = data.cc_tokens
		} else if (platform === "cursor") {
			data.cc_cents = 0
			data.cc_tokens = 0
			data.total_cents = data.cu_cents
			data.total_tokens = data.cu_tokens
		}

		if (isViewer) {
			data.cc_cents = null as unknown as number
			data.cu_cents = null as unknown as number
			data.total_cents = null as unknown as number
		}

		return c.json(data)
	})

	app.get("/api/models/:model/top-users", isAuthenticated, async (c) => {
		const parse = topUsersQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const model = decodeURIComponent(c.req.param("model"))
		const { from, to, days, limit, metric, platform } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const role = currentRole(c)
		const isViewer = role !== "admin"

		const sortBy = sql.raw(isViewer || metric === "tokens" ? "tokens" : "cents")

		const includeCC = platform === "all" || platform === "claude_code"
		const includeCU = platform === "all" || platform === "cursor"

		// Resolve input model to its base model if it's a raw model
		const aliasLookup = await db.execute(sql`
			select base_model from model_aliases where raw_model = ${model}
		`)
		const baseModelName = (aliasLookup.rows[0]?.base_model as string) || model

		const result = await db.execute(sql`
			with cc as (
				select d.email,
							 coalesce(sum(d.attributed_cents), 0)::bigint as cents,
							 coalesce(sum(d.uncached_input_tokens + d.cache_read_input_tokens + d.cache_creation_5m_tokens + d.cache_creation_1h_tokens + d.output_tokens), 0)::bigint as tokens
				from daily_claude_code_attribution d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) and d.date between ${effFrom} and ${effTo} and ${includeCC}
				group by d.email
			),
			cu as (
				select d.email,
							 coalesce(sum(d.charged_cents), 0)::bigint as cents,
							 coalesce(sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens), 0)::bigint as tokens
				from daily_cursor_usage d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) and d.date between ${effFrom} and ${effTo} and ${includeCU}
				group by d.email
			),
			totals as (
				select email, sum(cents) as cents, sum(tokens) as tokens
				from (
					select email, cents, tokens from cc
					union all
					select email, cents, tokens from cu
				) t
				group by email
			),
			ranked as (
				select t.email, tu.name, coalesce(t.cents, 0) as cents, coalesce(t.tokens, 0) as tokens
				from totals t
				left join tracked_users tu on tu.email = t.email
				order by ${sortBy} desc
				limit ${limit}
			),
			model_total as (
				select sum(cents) as total_cents, sum(tokens) as total_tokens
				from totals
			),
			days as (
				select generate_series(${effFrom}::date, ${effTo}::date, '1 day')::date as d
			),
			daily_cc as (
				select d.email, d.date,
							 coalesce(sum(d.attributed_cents), 0)::bigint as cents,
							 coalesce(sum(d.uncached_input_tokens + d.cache_read_input_tokens + d.cache_creation_5m_tokens + d.cache_creation_1h_tokens + d.output_tokens), 0)::bigint as tokens
				from daily_claude_code_attribution d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) and d.date between ${effFrom} and ${effTo} and ${includeCC}
				  and d.email in (select email from ranked)
				group by d.email, d.date
			),
			daily_cu as (
				select d.email, d.date,
							 coalesce(sum(d.charged_cents), 0)::bigint as cents,
							 coalesce(sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens), 0)::bigint as tokens
				from daily_cursor_usage d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model}) and d.date between ${effFrom} and ${effTo} and ${includeCU}
				  and d.email in (select email from ranked)
				group by d.email, d.date
			),
			trends as (
				select r.email, d.d as date,
							 coalesce(dcc.cents, 0)::bigint + coalesce(dcu.cents, 0)::bigint as cents,
							 coalesce(dcc.tokens, 0)::bigint + coalesce(dcu.tokens, 0)::bigint as tokens
				from ranked r
				cross join days d
				left join daily_cc dcc on dcc.email = r.email and dcc.date = d.d
				left join daily_cu dcu on dcu.email = r.email and dcu.date = d.d
			)
			select r.email,
						 r.name,
						 r.cents,
						 r.tokens,
						 case 
						 	when (select total_cents from model_total) > 0 then (r.cents::float / (select total_cents from model_total)) * 100 
						 	else 0 
						 end as share_pct_cost,
						 case 
						 	when (select total_tokens from model_total) > 0 then (r.tokens::float / (select total_tokens from model_total)) * 100 
						 	else 0 
						 end as share_pct_tokens,
						 (select array_agg(cents order by date) from trends where email = r.email) as trend_cents,
						 (select array_agg(tokens order by date) from trends where email = r.email) as trend_tokens
			from ranked r
			order by ${sortBy} desc
		`)

		const typed = (result.rows ?? []) as Record<string, unknown>[]
		typed.forEach((row) => {
			coerceTrendArrays(row, ["trend_cents", "trend_tokens"])
			row.cents = Number(row.cents)
			row.tokens = Number(row.tokens)
			row.share_pct = isViewer || metric === "tokens" ? row.share_pct_tokens : row.share_pct_cost
			delete row.share_pct_tokens
			delete row.share_pct_cost
		})
		stripCostForViewer(typed, c, ["cents", "trend_cents"])
		return c.json(typed)
	})

	app.get("/api/models/:model/trend", isAuthenticated, async (c) => {
		const parse = trendQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const model = decodeURIComponent(c.req.param("model"))
		const { from, to, days, platform } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const role = currentRole(c)
		const isViewer = role !== "admin"

		const includeCC = platform === "all" || platform === "claude_code"
		const includeCU = platform === "all" || platform === "cursor"

		// Resolve input model to its base model if it's a raw model
		const aliasLookup = await db.execute(sql`
			select base_model from model_aliases where raw_model = ${model}
		`)
		const baseModelName = (aliasLookup.rows[0]?.base_model as string) || model

		const result = await db.execute(sql`
			with days as (
				select generate_series(${effFrom}::date, ${effTo}::date, '1 day')::date as d
			)
			select to_char(d.d, 'YYYY-MM-DD') as date,
						 coalesce((
							 select sum(dcc.attributed_cents)::bigint
							 from daily_claude_code_attribution dcc
							 left join model_aliases ma on ma.raw_model = dcc.model
							 where (coalesce(ma.base_model, dcc.model) = ${baseModelName} or coalesce(ma.base_model, dcc.model) = ${model}) and dcc.date = d.d and ${includeCC}
						 ), 0)::bigint as cc_cents,
						 coalesce((
							 select sum(dcu.charged_cents)::bigint
							 from daily_cursor_usage dcu
							 left join model_aliases ma on ma.raw_model = dcu.model
							 where (coalesce(ma.base_model, dcu.model) = ${baseModelName} or coalesce(ma.base_model, dcu.model) = ${model}) and dcu.date = d.d and ${includeCU}
						 ), 0)::bigint as cu_cents,
						 coalesce((
							 select sum(dcc.uncached_input_tokens + dcc.cache_read_input_tokens + dcc.cache_creation_5m_tokens + dcc.cache_creation_1h_tokens + dcc.output_tokens)::bigint
							 from daily_claude_code_attribution dcc
							 left join model_aliases ma on ma.raw_model = dcc.model
							 where (coalesce(ma.base_model, dcc.model) = ${baseModelName} or coalesce(ma.base_model, dcc.model) = ${model}) and dcc.date = d.d and ${includeCC}
						 ), 0)::bigint as cc_tokens,
						 coalesce((
							 select sum(dcu.input_tokens + dcu.output_tokens + dcu.cache_read_tokens + dcu.cache_write_tokens)::bigint
							 from daily_cursor_usage dcu
							 left join model_aliases ma on ma.raw_model = dcu.model
							 where (coalesce(ma.base_model, dcu.model) = ${baseModelName} or coalesce(ma.base_model, dcu.model) = ${model}) and dcu.date = d.d and ${includeCU}
						 ), 0)::bigint as cu_tokens
			from days d
			order by d.d asc
		`)

		const rows = (result.rows ?? []).map((r: Record<string, unknown>) => ({
			date: r.date,
			cc_cents: isViewer ? null : Number(r.cc_cents),
			cu_cents: isViewer ? null : Number(r.cu_cents),
			cc_tokens: Number(r.cc_tokens),
			cu_tokens: Number(r.cu_tokens),
		}))

		return c.json(rows)
	})

	app.get("/api/models/:model/raw-models", isAuthenticated, async (c) => {
		const parse = summaryQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const model = decodeURIComponent(c.req.param("model"))
		const { from, to, days, platform } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const role = currentRole(c)
		const isViewer = role !== "admin"

		const includeCC = platform === "all" || platform === "claude_code"
		const includeCU = platform === "all" || platform === "cursor"

		// Resolve input model to its base model if it's a raw model
		const aliasLookup = await db.execute(sql`
			select base_model from model_aliases where raw_model = ${model}
		`)
		const baseModelName = (aliasLookup.rows[0]?.base_model as string) || model

		// Existence check
		const existCheck = await db.execute(sql`
			select 1
			from (
				select 1
				from daily_claude_code_attribution d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model})
				union all
				select 1
				from daily_cursor_usage d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model})
			) limit 1
		`)
		if (existCheck.rows.length === 0) {
			return c.json({ message: "Model not found" }, 404)
		}

		const result = await db.execute(sql`
			with
			days as (
				select generate_series(${effFrom}::date, ${effTo}::date, '1 day')::date as d
			),
			cc_raw as (
				select
					d.model as raw_model,
					coalesce(sum(d.attributed_cents), 0)::bigint as cents,
					coalesce(sum(d.uncached_input_tokens + d.cache_read_input_tokens + d.cache_creation_5m_tokens + d.cache_creation_1h_tokens + d.output_tokens), 0)::bigint as tokens
				from daily_claude_code_attribution d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model})
				  and d.date between ${effFrom} and ${effTo}
				  and ${includeCC}
				group by d.model
			),
			cu_raw as (
				select
					d.model as raw_model,
					coalesce(sum(d.charged_cents), 0)::bigint as cents,
					coalesce(sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens), 0)::bigint as tokens
				from daily_cursor_usage d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model})
				  and d.date between ${effFrom} and ${effTo}
				  and ${includeCU}
				group by d.model
			),
			combined_raw as (
				select raw_model, cents, tokens from cc_raw
				union all
				select raw_model, cents, tokens from cu_raw
			),
			active_raw as (
				select
					raw_model,
					sum(cents)::bigint as cents,
					sum(tokens)::bigint as tokens
				from combined_raw
				group by raw_model
			),
			model_total as (
				select
					sum(cents)::bigint as total_cents,
					sum(tokens)::bigint as total_tokens
				from active_raw
			),
			daily_cc as (
				select
					d.model as raw_model,
					d.date,
					coalesce(sum(d.attributed_cents), 0)::bigint as cents,
					coalesce(sum(d.uncached_input_tokens + d.cache_read_input_tokens + d.cache_creation_5m_tokens + d.cache_creation_1h_tokens + d.output_tokens), 0)::bigint as tokens
				from daily_claude_code_attribution d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model})
				  and d.date between ${effFrom} and ${effTo}
				  and ${includeCC}
				group by d.model, d.date
			),
			daily_cu as (
				select
					d.model as raw_model,
					d.date,
					coalesce(sum(d.charged_cents), 0)::bigint as cents,
					coalesce(sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens), 0)::bigint as tokens
				from daily_cursor_usage d
				left join model_aliases ma on ma.raw_model = d.model
				where (coalesce(ma.base_model, d.model) = ${baseModelName} or coalesce(ma.base_model, d.model) = ${model})
				  and d.date between ${effFrom} and ${effTo}
				  and ${includeCU}
				group by d.model, d.date
			),
			trends as (
				select
					ar.raw_model,
					d.d as date,
					coalesce(dcc.cents, 0)::bigint + coalesce(dcu.cents, 0)::bigint as cents,
					coalesce(dcc.tokens, 0)::bigint + coalesce(dcu.tokens, 0)::bigint as tokens
				from active_raw ar
				cross join days d
				left join daily_cc dcc on dcc.raw_model = ar.raw_model and dcc.date = d.d
				left join daily_cu dcu on dcu.raw_model = ar.raw_model and dcu.date = d.d
			)
			select
				ar.raw_model,
				ar.cents,
				ar.tokens,
				case
					when (select total_cents from model_total) > 0 then (ar.cents::float / (select total_cents from model_total)) * 100
					else 0
				end as share_pct_cost,
				case
					when (select total_tokens from model_total) > 0 then (ar.tokens::float / (select total_tokens from model_total)) * 100
					else 0
				end as share_pct_tokens,
				(select array_agg(cents order by date) from trends where raw_model = ar.raw_model) as trend_cents,
				(select array_agg(tokens order by date) from trends where raw_model = ar.raw_model) as trend_tokens
			from active_raw ar
			order by ar.raw_model asc
		`)

		const typed = (result.rows ?? []) as Record<string, unknown>[]
		const data = typed.map((row) => {
			coerceTrendArrays(row, ["trend_cents", "trend_tokens"])
			const cents = isViewer ? null : Number(row.cents)
			const trend_cents = isViewer ? null : (row.trend_cents as number[])
			return {
				raw_model: String(row.raw_model),
				cents,
				tokens: Number(row.tokens),
				share_pct: isViewer ? Number(row.share_pct_tokens || 0) : Number(row.share_pct_cost || 0),
				trend_cents,
				trend_tokens: row.trend_tokens as number[],
			}
		})

		return c.json(data)
	})
}
