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
	.refine((q) => (q.from && q.to) || (!q.from && !q.to), {
		message: "from and to must be provided together",
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be <= to" })

const topQuery = dateRangeBase
	.extend({
		platform: z.enum(["claude_code", "cursor", "all"]).default("all"),
		limit: z.coerce.number().int().min(1).max(50).default(10),
		metric: z.enum(["cost", "tokens"]).default("cost"),
	})
	.refine((q) => (q.from && q.to) || (!q.from && !q.to), {
		message: "from and to must be provided together",
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be <= to" })

const modelMixQuery = dateRangeBase
	.extend({
		limit: z.coerce.number().int().min(1).max(500).default(20),
		metric: z.enum(["cost", "tokens"]).default("cost"),
	})
	.refine((q) => (q.from && q.to) || (!q.from && !q.to), {
		message: "from and to must be provided together",
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be <= to" })

export function registerDashboardRoutes(app: Hono<AppEnv>): void {
	app.get("/api/dashboard/summary", isAuthenticated, async (c) => {
		const parse = summaryQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)

		const { from, to, days } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const totals = await db.execute<{
			cc_cents: number
			cu_cents: number
			cc_tokens: number
			cu_tokens: number
			cc_users: number
			cu_users: number
			gh_prs_opened: number
			gh_prs_merged: number
			gh_additions: number
			gh_deletions: number
			gh_users: number
			open_alerts: number
		}>(sql`
      select
        (select coalesce(sum(attributed_cents),0)::bigint from daily_claude_code_attribution
          where date between ${effFrom} and ${effTo}) as cc_cents,
        (select coalesce(sum(charged_cents),0)::bigint from daily_cursor_usage
          where date between ${effFrom} and ${effTo}) as cu_cents,
        (select coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens),0)::bigint
           from daily_claude_code_attribution
          where date between ${effFrom} and ${effTo}) as cc_tokens,
        (select coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens),0)::bigint
           from daily_cursor_usage
          where date between ${effFrom} and ${effTo}) as cu_tokens,
        (select count(distinct email)::int from daily_claude_code_attribution
          where date between ${effFrom} and ${effTo}) as cc_users,
        (select count(distinct email)::int from daily_cursor_usage
          where date between ${effFrom} and ${effTo}) as cu_users,
        (select coalesce(sum(prs_opened),0)::bigint from daily_github_activity
          where date between ${effFrom} and ${effTo}) as gh_prs_opened,
        (select coalesce(sum(prs_merged),0)::bigint from daily_github_activity
          where date between ${effFrom} and ${effTo}) as gh_prs_merged,
        (select coalesce(sum(additions),0)::bigint from daily_github_activity
          where date between ${effFrom} and ${effTo}) as gh_additions,
        (select coalesce(sum(deletions),0)::bigint from daily_github_activity
          where date between ${effFrom} and ${effTo}) as gh_deletions,
        (select count(distinct email)::int from daily_github_activity
          where date between ${effFrom} and ${effTo}) as gh_users,
        (select count(*)::int from alerts where status = 'open') as open_alerts
    `)

		// Trend: daily for ranges <= 90 days, weekly otherwise
		const dayCount =
			Math.round(
				(new Date(`${effTo}T00:00:00Z`).getTime() - new Date(`${effFrom}T00:00:00Z`).getTime()) /
					(24 * 60 * 60 * 1000),
			) + 1

		let trendRows: Record<string, unknown>[]
		if (dayCount <= 90) {
			const r = await db.execute(sql`
        with dates as (
          select generate_series(${effFrom}::date, ${effTo}::date, '1 day')::date as d
        )
        select dates.d as date,
               coalesce((select sum(attributed_cents) from daily_claude_code_attribution where date = dates.d),0)::bigint as claude_code_cents,
               coalesce((select sum(charged_cents) from daily_cursor_usage where date = dates.d),0)::bigint as cursor_cents,
               coalesce((select sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens)
                           from daily_claude_code_attribution where date = dates.d),0)::bigint as claude_code_tokens,
               coalesce((select sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)
                           from daily_cursor_usage where date = dates.d),0)::bigint as cursor_tokens,
               coalesce((select sum(prs_merged) from daily_github_activity where date = dates.d),0)::bigint as gh_prs_merged,
               coalesce((select sum(additions) from daily_github_activity where date = dates.d),0)::bigint as gh_additions,
               coalesce((select sum(deletions) from daily_github_activity where date = dates.d),0)::bigint as gh_deletions
          from dates
         order by date asc
      `)

			trendRows = r.rows ?? []
		} else {
			const r = await db.execute(sql`
        with weeks as (
          select generate_series(
                   date_trunc('week', ${effFrom}::date)::date,
                   date_trunc('week', ${effTo}::date)::date,
                   '7 days'
                 )::date as wk
        )
        select weeks.wk as date,
               coalesce((select sum(attributed_cents) from daily_claude_code_attribution
                          where date between weeks.wk and weeks.wk + 6
                            and date between ${effFrom} and ${effTo}),0)::bigint as claude_code_cents,
               coalesce((select sum(charged_cents) from daily_cursor_usage
                          where date between weeks.wk and weeks.wk + 6
                            and date between ${effFrom} and ${effTo}),0)::bigint as cursor_cents,
               coalesce((select sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens)
                           from daily_claude_code_attribution
                          where date between weeks.wk and weeks.wk + 6
                            and date between ${effFrom} and ${effTo}),0)::bigint as claude_code_tokens,
               coalesce((select sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)
                           from daily_cursor_usage
                          where date between weeks.wk and weeks.wk + 6
                            and date between ${effFrom} and ${effTo}),0)::bigint as cursor_tokens,
               coalesce((select sum(prs_merged) from daily_github_activity
                          where date between weeks.wk and weeks.wk + 6
                            and date between ${effFrom} and ${effTo}),0)::bigint as gh_prs_merged,
               coalesce((select sum(additions) from daily_github_activity
                          where date between weeks.wk and weeks.wk + 6
                            and date between ${effFrom} and ${effTo}),0)::bigint as gh_additions,
               coalesce((select sum(deletions) from daily_github_activity
                          where date between weeks.wk and weeks.wk + 6
                            and date between ${effFrom} and ${effTo}),0)::bigint as gh_deletions
          from weeks
         order by date asc
      `)
			trendRows = r.rows ?? []
		}

		const totalsRow: Record<string, unknown> | null =
			(totals.rows?.[0] as Record<string, unknown>) ?? null
		if (totalsRow) {

			totalsRow.gh_prs_opened = Number(totalsRow.gh_prs_opened ?? 0)
			totalsRow.gh_prs_merged = Number(totalsRow.gh_prs_merged ?? 0)
			totalsRow.gh_additions = Number(totalsRow.gh_additions ?? 0)
			totalsRow.gh_deletions = Number(totalsRow.gh_deletions ?? 0)
			totalsRow.gh_users = Number(totalsRow.gh_users ?? 0)
		}

		for (const row of trendRows) {
			const r = row as Record<string, unknown>

			r.gh_prs_merged = Number(r.gh_prs_merged ?? 0)
			r.gh_additions = Number(r.gh_additions ?? 0)
			r.gh_deletions = Number(r.gh_deletions ?? 0)
			if (currentRole(c) !== "admin") {
				r.claude_code_cents = null
				r.cursor_cents = null
			}
		}

		return c.json({ totals: totalsRow, trend: trendRows })
	})

	app.get("/api/dashboard/top-spenders", isAuthenticated, async (c) => {
		const parse = topQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)

		const { from, to, days, platform, limit, metric } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 7)

		const role = currentRole(c)
		const isViewer = role !== "admin"
		const sortByTokens = isViewer || metric === "tokens"

		// orderBy for the inner `top` CTE (alias c from combined c)
		const orderByInner = sortByTokens
			? platform === "claude_code"
				? sql`c.cc_tokens`
				: platform === "cursor"
					? sql`c.cu_tokens`
					: sql`c.total_tokens`
			: platform === "claude_code"
				? sql`c.cc_cents`
				: platform === "cursor"
					? sql`c.cu_cents`
					: sql`c.total_cents`

		// orderBy for the outer select (alias t from top t)
		const orderByOuter = sortByTokens
			? platform === "claude_code"
				? sql`t.cc_tokens`
				: platform === "cursor"
					? sql`t.cu_tokens`
					: sql`t.total_tokens`
			: platform === "claude_code"
				? sql`t.cc_cents`
				: platform === "cursor"
					? sql`t.cu_cents`
					: sql`t.total_cents`

		const result = await db.execute(sql`
      with
      cc as (
        select email,
               coalesce(sum(attributed_cents),0)::bigint as cents,
               coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens),0)::bigint as tokens
          from daily_claude_code_attribution
         where date between ${effFrom} and ${effTo}
         group by email
      ),
      cu as (
        select email,
               coalesce(sum(charged_cents),0)::bigint as cents,
               coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens),0)::bigint as tokens
          from daily_cursor_usage
         where date between ${effFrom} and ${effTo}
         group by email
      ),
      gh as (
        select email,

               coalesce(sum(prs_merged),0)::bigint as prs_merged,
               coalesce(sum(additions),0)::bigint as additions,
               coalesce(sum(deletions),0)::bigint as deletions
          from daily_github_activity
         where date between ${effFrom} and ${effTo}
         group by email
      ),
      combined as (
        select coalesce(cc.email, cu.email) as email,
               coalesce(cc.cents,0) as cc_cents,
               coalesce(cu.cents,0) as cu_cents,
               coalesce(cc.cents,0) + coalesce(cu.cents,0) as total_cents,
               coalesce(cc.tokens,0) as cc_tokens,
               coalesce(cu.tokens,0) as cu_tokens,
               coalesce(cc.tokens,0) + coalesce(cu.tokens,0) as total_tokens
          from cc full outer join cu on cc.email = cu.email
      ),
      top as (
        select c.email, tu.name,
               c.cc_cents, c.cu_cents, c.total_cents,
               c.cc_tokens, c.cu_tokens, c.total_tokens,

               coalesce(gh.prs_merged, 0)::bigint as gh_prs_merged,
               coalesce(gh.additions, 0)::bigint as gh_additions,
               coalesce(gh.deletions, 0)::bigint as gh_deletions
          from combined c
          left join tracked_users tu on tu.email = c.email
          left join gh on gh.email = c.email
         order by ${orderByInner} desc
         limit ${limit}
      ),
      days as (
        select generate_series(${effFrom}::date, ${effTo}::date, '1 day')::date as d
      ),
      daily_cc as (
        select email, date,
               coalesce(sum(attributed_cents),0)::bigint as cents,
               coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens),0)::bigint as tokens
          from daily_claude_code_attribution
         where date between ${effFrom} and ${effTo}
           and email in (select email from top)
         group by email, date
      ),
      daily_cu as (
        select email, date,
               coalesce(sum(charged_cents),0)::bigint as cents,
               coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens),0)::bigint as tokens
          from daily_cursor_usage
         where date between ${effFrom} and ${effTo}
           and email in (select email from top)
         group by email, date
      ),
      trends as (
        select t.email, d.d as date,
               coalesce(dcc.cents, 0)::bigint + coalesce(dcu.cents, 0)::bigint as cents,
               coalesce(dcc.tokens, 0)::bigint + coalesce(dcu.tokens, 0)::bigint as tokens
          from top t
          cross join days d
          left join daily_cc dcc on dcc.email = t.email and dcc.date = d.d
          left join daily_cu dcu on dcu.email = t.email and dcu.date = d.d
      )
      select t.email, t.name,
             t.cc_cents, t.cu_cents, t.total_cents,
             t.cc_tokens, t.cu_tokens, t.total_tokens,
             t.gh_prs_merged, t.gh_additions, t.gh_deletions,
             (select array_agg(cents order by date) from trends tr where tr.email = t.email) as trend_cents,
             (select array_agg(tokens order by date) from trends tr where tr.email = t.email) as trend_tokens
        from top t
       order by ${orderByOuter} desc
    `)

		const typed = (result.rows ?? []) as Record<string, unknown>[]
		typed.forEach((row) => {
			coerceTrendArrays(row, ["trend_cents", "trend_tokens"])

			row.gh_prs_merged = Number(row.gh_prs_merged ?? 0)
			row.gh_additions = Number(row.gh_additions ?? 0)
			row.gh_deletions = Number(row.gh_deletions ?? 0)
		})
		stripCostForViewer(typed, c, ["cc_cents", "cu_cents", "total_cents", "trend_cents"])
		return c.json(typed)
	})

	app.get("/api/dashboard/model-mix", isAuthenticated, async (c) => {
		const parse = modelMixQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)

		const { from, to, days, limit, metric } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const role = currentRole(c)
		const isViewer = role !== "admin"

		// Sort metric column branches on role.
		const sortBy = sql.raw(isViewer || metric === "tokens" ? "tokens" : "cents")

		const result = await db.execute(sql`
      with
      cc as (
        select model,
               coalesce(sum(attributed_cents),0)::bigint as cents,
               coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens),0)::bigint as tokens
          from daily_claude_code_attribution
         where date between ${effFrom} and ${effTo}
         group by model
      ),
      cu as (
        select model,
               coalesce(sum(charged_cents),0)::bigint as cents,
               coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens),0)::bigint as tokens
          from daily_cursor_usage
         where date between ${effFrom} and ${effTo}
         group by model
      ),
      totals as (
        select 'claude_code'::text as platform, model, cents, tokens from cc
        union all
        select 'cursor'::text as platform, model, cents, tokens from cu
      ),
      ranked as (
        select platform, model, cents, tokens
          from totals
         order by ${sortBy} desc
         limit ${limit}
      ),
      days as (
        select generate_series(${effFrom}::date, ${effTo}::date, '1 day')::date as d
      ),
      daily_cc as (
        select model, date,
               coalesce(sum(attributed_cents),0)::bigint as cents,
               coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens),0)::bigint as tokens
          from daily_claude_code_attribution
         where date between ${effFrom} and ${effTo}
           and model in (select model from ranked where platform = 'claude_code')
         group by model, date
      ),
      daily_cu as (
        select model, date,
               coalesce(sum(charged_cents),0)::bigint as cents,
               coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens),0)::bigint as tokens
          from daily_cursor_usage
         where date between ${effFrom} and ${effTo}
           and model in (select model from ranked where platform = 'cursor')
         group by model, date
      ),
      trends_cc as (
        select r.model, d.d as date,
               coalesce(dcc.cents, 0)::bigint as cents,
               coalesce(dcc.tokens, 0)::bigint as tokens
          from ranked r
          cross join days d
          left join daily_cc dcc on dcc.model = r.model and dcc.date = d.d
         where r.platform = 'claude_code'
      ),
      trends_cu as (
        select r.model, d.d as date,
               coalesce(dcu.cents, 0)::bigint as cents,
               coalesce(dcu.tokens, 0)::bigint as tokens
          from ranked r
          cross join days d
          left join daily_cu dcu on dcu.model = r.model and dcu.date = d.d
         where r.platform = 'cursor'
      )
      select r.platform,
             r.model,
             r.cents,
             r.tokens,
             case when r.platform = 'claude_code'
                  then (select array_agg(cents order by date) from trends_cc where model = r.model)
                  else (select array_agg(cents order by date) from trends_cu where model = r.model)
             end as trend_cents,
             case when r.platform = 'claude_code'
                  then (select array_agg(tokens order by date) from trends_cc where model = r.model)
                  else (select array_agg(tokens order by date) from trends_cu where model = r.model)
             end as trend_tokens
        from ranked r
       order by ${sortBy} desc
    `)

		const typed = (result.rows ?? []) as Record<string, unknown>[]
		typed.forEach((row) => {
			coerceTrendArrays(row, ["trend_cents", "trend_tokens"])
		})
		stripCostForViewer(typed, c, ["cents", "trend_cents"])
		return c.json(typed)
	})
}
