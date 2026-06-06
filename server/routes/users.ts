import { sql } from "drizzle-orm"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { isAuthenticated, requireAdmin } from "../auth/session"
import { db } from "../db"
import { coerceTrendArrays, stripCostForViewer } from "../lib/route-helpers"
import { currentRole } from "./index"

const usageQuery = z.object({
	from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	platform: z.enum(["claude_code", "cursor", "all"]).default("all"),
})

const listQuery = z
	.object({
		from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	})
	.refine((q) => q.from <= q.to, { message: "from must be <= to" })

const heatmapQuery = z
	.object({
		from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	})
	.refine((q) => q.from <= q.to, { message: "from must be <= to" })

const userAlertsQuery = z.object({
	days: z.coerce.number().int().min(7).max(365).default(30),
	limit: z.coerce.number().int().min(1).max(500).default(50),
})

interface UserListRow extends Record<string, unknown> {
	email: string
	name: string | null
	cc_cents: number
	cu_cents: number
	cc_tokens: number
	cu_tokens: number
}

export function registerUserRoutes(app: Hono<AppEnv>): void {
	// Roster with single-window costs
	app.get("/api/users", isAuthenticated, async (c) => {
		const parse = listQuery.safeParse(c.req.query())
		if (!parse.success) {
			return c.json({ message: "Invalid query", issues: parse.error.issues }, 400)
		}
		const { from, to } = parse.data

		const isViewer = currentRole(c) !== "admin"
		const orderExpr = isViewer
			? sql`(coalesce(cc.tokens,0) + coalesce(cu.tokens,0)) desc`
			: sql`(coalesce(cc.cents,0) + coalesce(cu.cents,0)) desc`

		const result = await db.execute<UserListRow>(sql`
      with cc as (
        select email,
               coalesce(sum(attributed_cents),0)::bigint as cents,
               coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens),0)::bigint as tokens
          from daily_claude_code_attribution
         where date between ${from} and ${to}
         group by email
      ),
      cu as (
        select email,
               coalesce(sum(charged_cents),0)::bigint as cents,
               coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens),0)::bigint as tokens
          from daily_cursor_usage
         where date between ${from} and ${to}
         group by email
      ),
      days as (
        select generate_series(${from}::date, ${to}::date, '1 day')::date as d
      ),
      daily_cc as (
        select email, date,
               coalesce(sum(attributed_cents),0)::bigint as cents,
               coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens),0)::bigint as tokens
          from daily_claude_code_attribution
         where date between ${from} and ${to}
         group by email, date
      ),
      daily_cu as (
        select email, date,
               coalesce(sum(charged_cents),0)::bigint as cents,
               coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens),0)::bigint as tokens
          from daily_cursor_usage
         where date between ${from} and ${to}
         group by email, date
      ),
      trends as (
        select tu.email, d.d as date,
               coalesce(dcc.cents, 0)::bigint + coalesce(dcu.cents, 0)::bigint as cents,
               coalesce(dcc.tokens, 0)::bigint + coalesce(dcu.tokens, 0)::bigint as tokens
          from tracked_users tu
          cross join days d
          left join daily_cc dcc on dcc.email = tu.email and dcc.date = d.d
          left join daily_cu dcu on dcu.email = tu.email and dcu.date = d.d
         where tu.is_active = true
      )
      select tu.email,
             tu.name,
             coalesce(cc.cents,0)  as cc_cents,
             coalesce(cu.cents,0)  as cu_cents,
             coalesce(cc.tokens,0) as cc_tokens,
             coalesce(cu.tokens,0) as cu_tokens,
             (select array_agg(cents order by date) from trends tr where tr.email = tu.email) as trend_cents,
             (select array_agg(tokens order by date) from trends tr where tr.email = tu.email) as trend_tokens
        from tracked_users tu
        left join cc on cc.email = tu.email
        left join cu on cu.email = tu.email
       where tu.is_active = true
       order by ${orderExpr}
     `)

		const typed = (result.rows ?? []) as Record<string, unknown>[]
		typed.forEach((row) => {
			coerceTrendArrays(row, ["trend_cents", "trend_tokens"])
		})
		stripCostForViewer(typed, c, ["cc_cents", "cu_cents", "trend_cents"])
		return c.json(typed)
	})

	// Per-user time-series usage
	app.get("/api/users/:email/usage", isAuthenticated, async (c) => {
		const parse = usageQuery.safeParse(c.req.query())
		if (!parse.success) {
			return c.json({ message: "Invalid query", issues: parse.error.issues }, 400)
		}
		const { from, to, platform } = parse.data
		const email = String(c.req.param("email")).toLowerCase()

		const ccQuery =
			platform === "claude_code" || platform === "all"
				? db.execute(sql`
          select date, model,
                 sum(uncached_input_tokens)::bigint as input_tokens,
                 sum(output_tokens)::bigint as output_tokens,
                 sum(cache_read_input_tokens)::bigint as cache_read_tokens,
                 sum(cache_creation_5m_tokens + cache_creation_1h_tokens)::bigint as cache_creation_tokens,
                 sum(attributed_cents)::int as estimated_cost_cents
            from daily_claude_code_attribution
           where email = ${email} and date between ${from} and ${to}
           group by date, model
           order by date asc, model asc
        `)
				: null
		const cuQuery =
			platform === "cursor" || platform === "all"
				? db.execute(sql`
          select date, model,
                 sum(input_tokens)::bigint as input_tokens,
                 sum(output_tokens)::bigint as output_tokens,
                 sum(cache_read_tokens)::bigint as cache_read_tokens,
                 sum(cache_write_tokens)::bigint as cache_write_tokens,
                 sum(charged_cents)::int as charged_cents,
                 sum(request_count)::int as request_count
            from daily_cursor_usage
           where email = ${email} and date between ${from} and ${to}
           group by date, model
           order by date asc, model asc
        `)
				: null

		const [cc, cu] = await Promise.all([ccQuery, cuQuery])
		const isViewer = currentRole(c) !== "admin"

		const out: { claude_code?: unknown[]; cursor?: unknown[] } = {}
		if (cc) {
			out.claude_code = isViewer
				? (cc.rows ?? []).map((row) => {
						const r = { ...(row as Record<string, unknown>) }
						delete r.estimated_cost_cents
						return r
					})
				: (cc.rows ?? [])
		}
		if (cu) {
			out.cursor = isViewer
				? (cu.rows ?? []).map((row) => {
						const r = { ...(row as Record<string, unknown>) }
						delete r.charged_cents
						return r
					})
				: (cu.rows ?? [])
		}
		return c.json(out)
	})

	// Per-day spend + tokens for the activity heatmap on the user-detail page.
	// Returns one row per day in the window (~91 by default). Cost fields are
	// null for viewers; token fields are always present.
	app.get("/api/users/:email/heatmap", isAuthenticated, async (c) => {
		const parse = heatmapQuery.safeParse(c.req.query())
		if (!parse.success) {
			return c.json({ message: "Invalid query", issues: parse.error.issues }, 400)
		}
		const { from, to } = parse.data
		const email = String(c.req.param("email")).toLowerCase()
		const isViewer = currentRole(c) !== "admin"

		const result = await db.execute<{
			date: string
			cc_cents: number
			cu_cents: number
			cc_tokens: number
			cu_tokens: number
		}>(sql`
      with dates as (
        select generate_series(${from}::date, ${to}::date, '1 day')::date as d
      )
      select to_char(d.d, 'YYYY-MM-DD') as date,
             coalesce((
               select sum(attributed_cents)::bigint
                 from daily_claude_code_attribution
                where email = ${email} and date = d.d
             ), 0)::bigint as cc_cents,
             coalesce((
               select sum(charged_cents)::bigint
                 from daily_cursor_usage
                where email = ${email} and date = d.d
             ), 0)::bigint as cu_cents,
             coalesce((
               select sum(uncached_input_tokens + cache_read_input_tokens
                          + cache_creation_5m_tokens + cache_creation_1h_tokens
                          + output_tokens)::bigint
                 from daily_claude_code_attribution
                where email = ${email} and date = d.d
             ), 0)::bigint as cc_tokens,
             coalesce((
               select sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)::bigint
                 from daily_cursor_usage
                where email = ${email} and date = d.d
             ), 0)::bigint as cu_tokens
        from dates d
       order by d.d asc
    `)

		// Cast bigints from pg (returned as strings) back to numbers. Values are
		// bounded by per-day spend × tokens which always fit in a JS number.
		const rows = (result.rows ?? []).map((r) => ({
			date: r.date,
			cc_cents: isViewer ? null : Number(r.cc_cents),
			cu_cents: isViewer ? null : Number(r.cu_cents),
			cc_tokens: Number(r.cc_tokens),
			cu_tokens: Number(r.cu_tokens),
		}))
		return c.json(rows)
	})

	// Alert history for a specific user. Admin-only — mirrors /api/alerts shape
	// so the frontend can share row-rendering with the dedicated alerts page.
	app.get("/api/users/:email/alerts", requireAdmin, async (c) => {
		const parse = userAlertsQuery.safeParse(c.req.query())
		if (!parse.success) {
			return c.json({ message: "Invalid query", issues: parse.error.issues }, 400)
		}
		const { days, limit } = parse.data
		const email = String(c.req.param("email")).toLowerCase()

		const result = await db.execute(sql`
      select a.id, a.date, a.email, a.platform,
             a.amount_cents as "amountCents",
             a.threshold_cents as "thresholdCents",
             a.status,
             a.channels_sent as "channelsSent",
             a.created_at as "createdAt",
             a.acknowledged_at as "acknowledgedAt",
             a.resolved_at as "resolvedAt",
             tu.name as name
        from alerts a
        left join tracked_users tu on tu.email = a.email
       where a.email = ${email}
         and a.date >= (current_date at time zone 'America/Los_Angeles')::date - (${days}::int - 1)
       order by a.created_at desc
       limit ${limit}
    `)
		return c.json(result.rows ?? [])
	})

	// Single user summary — identity only. Window-aware totals come from
	// /api/users/:email/usage (consumed by user-detail.tsx which sums client-side).
	app.get("/api/users/:email", isAuthenticated, async (c) => {
		const email = String(c.req.param("email")).toLowerCase()
		const r = await db.execute(sql`
      select tu.email, tu.name, tu.anthropic_user_id, tu.cursor_user_id
        from tracked_users tu
       where tu.email = ${email}
    `)
		const row = r.rows?.[0]
		if (!row) return c.json({ message: "User not found" }, 404)
		return c.json(row)
	})
}
