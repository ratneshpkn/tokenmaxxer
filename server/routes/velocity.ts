import { PR_COMPLEXITY_WEIGHTS } from "@shared/constants"
import { sql } from "drizzle-orm"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { isAuthenticated } from "../auth/session"
import { db } from "../db"
import { resolveWindow, stripCostForViewer } from "../lib/route-helpers"

const W1 = sql.raw(String(PR_COMPLEXITY_WEIGHTS[1]))
const W2 = sql.raw(String(PR_COMPLEXITY_WEIGHTS[2]))
const W3 = sql.raw(String(PR_COMPLEXITY_WEIGHTS[3]))
const W4 = sql.raw(String(PR_COMPLEXITY_WEIGHTS[4]))
const W5 = sql.raw(String(PR_COMPLEXITY_WEIGHTS[5]))

const querySchema = z
	.object({
		from: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/)
			.optional(),
		to: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/)
			.optional(),
		days: z.coerce.number().int().min(1).max(365).optional(),
		teamId: z.string().uuid().optional(),
	})
	.refine((q) => (q.from && q.to) || (!q.from && !q.to), {
		message: "from and to must be provided together",
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be <= to" })

export function registerVelocityRoutes(app: Hono<AppEnv>): void {
	// ── 1. Summary & Time-series Trend ──────────────────────────────────────
	app.get("/api/velocity/summary", isAuthenticated, async (c) => {
		const parse = querySchema.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)

		const { from, to, days, teamId } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const teamFilterCc = teamId
			? sql`join team_memberships tm_cc on tm_cc.user_email = daily_claude_code_attribution.email and tm_cc.team_id = ${teamId}`
			: sql``
		const teamFilterCu = teamId
			? sql`join team_memberships tm_cu on tm_cu.user_email = daily_cursor_usage.email and tm_cu.team_id = ${teamId}`
			: sql``
		const teamFilterGh = teamId
			? sql`join team_memberships tm_gh on tm_gh.user_email = daily_github_activity.email and tm_gh.team_id = ${teamId}`
			: sql``
		const teamFilterPr = teamId
			? sql`join team_memberships tm_pr on tm_pr.user_email = gpr.email and tm_pr.team_id = ${teamId}`
			: sql``

		// Aggregate overall totals
		const totalsQuery = await db.execute<{
			cc_cents: number
			cu_cents: number
			cc_tokens: number
			cu_tokens: number
			prs_opened: number
			prs_merged: number
			active_engineers: number
		}>(sql`
			select
				(select coalesce(sum(attributed_cents), 0)::bigint
				   from daily_claude_code_attribution
				   ${teamFilterCc}
				  where date between ${effFrom} and ${effTo}) as cc_cents,
				(select coalesce(sum(charged_cents), 0)::bigint
				   from daily_cursor_usage
				   ${teamFilterCu}
				  where date between ${effFrom} and ${effTo}) as cu_cents,
				(select coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens), 0)::bigint
				   from daily_claude_code_attribution
				   ${teamFilterCc}
				  where date between ${effFrom} and ${effTo}) as cc_tokens,
				(select coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::bigint
				   from daily_cursor_usage
				   ${teamFilterCu}
				  where date between ${effFrom} and ${effTo}) as cu_tokens,
				(select coalesce(sum(prs_opened), 0)::bigint
				   from daily_github_activity
				   ${teamFilterGh}
				  where date between ${effFrom} and ${effTo}) as prs_opened,
				(select coalesce(sum(prs_merged), 0)::bigint
				   from daily_github_activity
				   ${teamFilterGh}
				  where date between ${effFrom} and ${effTo}) as prs_merged,
				(select count(distinct email)::int
				   from (
					 select email from daily_claude_code_attribution ${teamFilterCc} where date between ${effFrom} and ${effTo}
					 union
					 select email from daily_cursor_usage ${teamFilterCu} where date between ${effFrom} and ${effTo}
					 union
					 select email from daily_github_activity ${teamFilterGh} where date between ${effFrom} and ${effTo}
				   ) active_u) as active_engineers
		`)

		const t = totalsQuery.rows?.[0] ?? {
			cc_cents: 0,
			cu_cents: 0,
			cc_tokens: 0,
			cu_tokens: 0,
			prs_opened: 0,
			prs_merged: 0,
			active_engineers: 0,
		}

		// Impact points & PR enrichment aggregates
		const prAggs = await db.execute<{
			total_impact_points: number
			substantive_prs: number
			total_enriched: number
			avg_complexity: number | null
		}>(sql`
			select
				coalesce(sum(
					case gpe.complexity_score
						when 1 then ${W1}
						when 2 then ${W2}
						when 3 then ${W3}
						when 4 then ${W4}
						when 5 then ${W5}
						else 0.0
					end
				), 0)::float as total_impact_points,
				coalesce(count(*) filter (where gpe.complexity_score >= 4), 0)::int as substantive_prs,
				count(gpe.repo)::int as total_enriched,
				case when count(gpe.repo) > 0 then round(avg(gpe.complexity_score)::numeric, 1)::float else null end as avg_complexity
			from github_pull_requests gpr
			left join github_pr_enrichments gpe
				on gpe.repo = gpr.repo and gpe.number = gpr.number
			${teamFilterPr}
			where gpr.merged_at >= ${effFrom}::date
			  and gpr.merged_at < (${effTo}::date + interval '1 day')
		`)

		const p = prAggs.rows?.[0] ?? {
			total_impact_points: 0,
			substantive_prs: 0,
			total_enriched: 0,
			avg_complexity: null,
		}

		// Time-series trend (daily for <= 90 days, weekly for > 90 days)
		const windowDays =
			Math.round(
				(new Date(effTo).getTime() - new Date(effFrom).getTime()) / (1000 * 60 * 60 * 24),
			) + 1
		const isWeekly = windowDays > 90

		const trendQuery = await db.execute<{
			bucket: string
			cost_cents: number
			tokens: number
			prs_merged: number
			prs_opened: number
			impact_points: number
			substantive_prs: number
		}>(sql`
			with date_buckets as (
				select ${
					isWeekly
						? sql`to_char(date_trunc('week', d), 'YYYY-MM-DD')`
						: sql`to_char(d, 'YYYY-MM-DD')`
				} as bucket,
				min(d) as start_date,
				max(d) as end_date
				from generate_series(${effFrom}::date, ${effTo}::date, '1 day'::interval) d
				group by 1
			),
			spend as (
				select ${
					isWeekly
						? sql`to_char(date_trunc('week', date), 'YYYY-MM-DD')`
						: sql`to_char(date, 'YYYY-MM-DD')`
				} as bucket,
				coalesce(sum(attributed_cents), 0) as cc_cents,
				coalesce(sum(uncached_input_tokens + cache_read_input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens + output_tokens), 0) as cc_tokens
				from daily_claude_code_attribution
				${teamFilterCc}
				where date between ${effFrom} and ${effTo}
				group by 1
			),
			cursor_s as (
				select ${
					isWeekly
						? sql`to_char(date_trunc('week', date), 'YYYY-MM-DD')`
						: sql`to_char(date, 'YYYY-MM-DD')`
				} as bucket,
				coalesce(sum(charged_cents), 0) as cu_cents,
				coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) as cu_tokens
				from daily_cursor_usage
				${teamFilterCu}
				where date between ${effFrom} and ${effTo}
				group by 1
			),
			git_act as (
				select ${
					isWeekly
						? sql`to_char(date_trunc('week', date), 'YYYY-MM-DD')`
						: sql`to_char(date, 'YYYY-MM-DD')`
				} as bucket,
				coalesce(sum(prs_opened), 0) as prs_opened,
				coalesce(sum(prs_merged), 0) as prs_merged
				from daily_github_activity
				${teamFilterGh}
				where date between ${effFrom} and ${effTo}
				group by 1
			),
			pr_impact as (
				select ${
					isWeekly
						? sql`to_char(date_trunc('week', gpr.merged_at at time zone 'UTC'), 'YYYY-MM-DD')`
						: sql`to_char(gpr.merged_at at time zone 'UTC', 'YYYY-MM-DD')`
				} as bucket,
				coalesce(sum(
					case gpe.complexity_score
						when 1 then ${W1}
						when 2 then ${W2}
						when 3 then ${W3}
						when 4 then ${W4}
						when 5 then ${W5}
						else 0.0
					end
				), 0)::float as impact_points,
				count(*) filter (where gpe.complexity_score >= 4)::int as substantive_prs
				from github_pull_requests gpr
				inner join github_pr_enrichments gpe
					on gpe.repo = gpr.repo and gpe.number = gpr.number
				${teamFilterPr}
				where gpr.merged_at >= ${effFrom}::date
				  and gpr.merged_at < (${effTo}::date + interval '1 day')
				group by 1
			)
			select
				db.bucket,
				(coalesce(s.cc_cents, 0) + coalesce(cs.cu_cents, 0))::bigint as cost_cents,
				(coalesce(s.cc_tokens, 0) + coalesce(cs.cu_tokens, 0))::bigint as tokens,
				coalesce(ga.prs_merged, 0)::int as prs_merged,
				coalesce(ga.prs_opened, 0)::int as prs_opened,
				coalesce(pi.impact_points, 0)::float as impact_points,
				coalesce(pi.substantive_prs, 0)::int as substantive_prs
			from date_buckets db
			left join spend s on s.bucket = db.bucket
			left join cursor_s cs on cs.bucket = db.bucket
			left join git_act ga on ga.bucket = db.bucket
			left join pr_impact pi on pi.bucket = db.bucket
			order by db.start_date asc
		`)

		const totalCostCents = Number(t.cc_cents) + Number(t.cu_cents)
		const totalTokens = Number(t.cc_tokens) + Number(t.cu_tokens)
		const totalPrsMerged = Number(t.prs_merged)
		const totalPrsOpened = Number(t.prs_opened)
		const totalImpactPoints = Number(Number(p.total_impact_points).toFixed(1))
		const substantivePrCount = Number(p.substantive_prs)
		const totalEnrichedPrs = Number(p.total_enriched)

		const costPerPrCents = totalPrsMerged > 0 ? Math.round(totalCostCents / totalPrsMerged) : null
		const costPerImpactPointCents =
			totalImpactPoints > 0 ? Math.round(totalCostCents / totalImpactPoints) : null
		const tokensPerPr = totalPrsMerged > 0 ? Math.round(totalTokens / totalPrsMerged) : null
		const tokensPerImpactPoint =
			totalImpactPoints > 0 ? Math.round(totalTokens / totalImpactPoints) : null

		const trend = (trendQuery.rows ?? []).map((row) => ({
			date: row.bucket,
			costCents: Number(row.cost_cents),
			tokens: Number(row.tokens),
			prsMerged: Number(row.prs_merged),
			prsOpened: Number(row.prs_opened),
			impactPoints: Number(Number(row.impact_points).toFixed(1)),
			substantivePrs: Number(row.substantive_prs),
		}))

		const responseData: Record<string, unknown> = {
			from: effFrom,
			to: effTo,
			totalCostCents,
			totalTokens,
			totalPrsMerged,
			totalPrsOpened,
			totalImpactPoints,
			substantivePrCount,
			totalEnrichedPrs,
			averageComplexity: p.avg_complexity,
			costPerPrCents,
			costPerImpactPointCents,
			tokensPerPr,
			tokensPerImpactPoint,
			activeEngineersCount: Number(t.active_engineers),
			trend,
		}

		await stripCostForViewer([responseData], c, [
			"totalCostCents",
			"costPerPrCents",
			"costPerImpactPointCents",
		])

		// If cost was stripped from responseData, also strip costCents from each trend point
		if (responseData.totalCostCents === undefined) {
			for (const pt of trend) {
				delete (pt as Record<string, unknown>).costCents
			}
		}

		return c.json(responseData)
	})

	// ── 2. PR Work-Type & Category Breakdown ────────────────────────────────
	app.get("/api/velocity/categories", isAuthenticated, async (c) => {
		const parse = querySchema.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)

		const { from, to, days, teamId } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const teamFilterPr = teamId
			? sql`join team_memberships tm_pr on tm_pr.user_email = gpr.email and tm_pr.team_id = ${teamId}`
			: sql``

		const categoriesQuery = await db.execute<{
			category: string
			pr_count: number
			impact_points: number
			avg_complexity: number
			substantive_count: number
		}>(sql`
			select
				coalesce(nullif(gpe.category, ''), 'other') as category,
				count(*)::int as pr_count,
				coalesce(sum(
					case gpe.complexity_score
						when 1 then ${W1}
						when 2 then ${W2}
						when 3 then ${W3}
						when 4 then ${W4}
						when 5 then ${W5}
						else 0.0
					end
				), 0)::float as impact_points,
				round(avg(gpe.complexity_score)::numeric, 1)::float as avg_complexity,
				count(*) filter (where gpe.complexity_score >= 4)::int as substantive_count
			from github_pull_requests gpr
			inner join github_pr_enrichments gpe
				on gpe.repo = gpr.repo and gpe.number = gpr.number
			${teamFilterPr}
			where gpr.merged_at >= ${effFrom}::date
			  and gpr.merged_at < (${effTo}::date + interval '1 day')
			group by coalesce(nullif(gpe.category, ''), 'other')
			order by impact_points desc
		`)

		const rows = categoriesQuery.rows ?? []
		const totalImpactPoints = rows.reduce((s, r) => s + Number(r.impact_points), 0)
		const totalPrs = rows.reduce((s, r) => s + Number(r.pr_count), 0)

		const categories = rows.map((r) => {
			const impactPoints = Number(Number(r.impact_points).toFixed(1))
			const sharePct =
				totalImpactPoints > 0 ? Math.round((impactPoints / totalImpactPoints) * 100) : 0
			return {
				category: r.category,
				prCount: Number(r.pr_count),
				impactPoints,
				avgComplexity: Number(r.avg_complexity),
				substantiveCount: Number(r.substantive_count),
				sharePct,
			}
		})

		return c.json({
			from: effFrom,
			to: effTo,
			totalPrs,
			totalImpactPoints: Number(totalImpactPoints.toFixed(1)),
			categories,
		})
	})

	// ── 4. Team-Level Velocity & ROI Rollups ─────────────────────────────────
	app.get("/api/velocity/teams", isAuthenticated, async (c) => {
		const parse = querySchema.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)

		const { from, to, days } = parse.data
		const { effFrom, effTo } = resolveWindow({ from, to, days }, 30)

		const teamsQuery = await db.execute<{
			team_id: string
			team_name: string
			member_count: number
			total_cents: number
			total_tokens: number
			prs_merged: number
			impact_points: number
			substantive_prs: number
			avg_complexity: number | null
		}>(sql`
			with team_spend as (
				select tm.team_id,
					   coalesce(sum(cc.attributed_cents), 0)::bigint as cc_cents,
					   coalesce(sum(cc.uncached_input_tokens + cc.cache_read_input_tokens + cc.cache_creation_5m_tokens + cc.cache_creation_1h_tokens + cc.output_tokens), 0)::bigint as cc_tokens
				from team_memberships tm
				left join daily_claude_code_attribution cc
					on cc.email = tm.user_email and cc.date between ${effFrom} and ${effTo}
				group by tm.team_id
			),
			team_cursor as (
				select tm.team_id,
					   coalesce(sum(cu.charged_cents), 0)::bigint as cu_cents,
					   coalesce(sum(cu.input_tokens + cu.output_tokens + cu.cache_read_tokens + cu.cache_write_tokens), 0)::bigint as cu_tokens
				from team_memberships tm
				left join daily_cursor_usage cu
					on cu.email = tm.user_email and cu.date between ${effFrom} and ${effTo}
				group by tm.team_id
			),
			team_git as (
				select tm.team_id,
					   coalesce(sum(ga.prs_merged), 0)::int as prs_merged
				from team_memberships tm
				left join daily_github_activity ga
					on ga.email = tm.user_email and ga.date between ${effFrom} and ${effTo}
				group by tm.team_id
			),
			team_pr_impact as (
				select tm.team_id,
					   coalesce(sum(
					   case gpe.complexity_score
						   when 1 then ${W1}
						   when 2 then ${W2}
						   when 3 then ${W3}
						   when 4 then ${W4}
						   when 5 then ${W5}
						   else 0.0
					   end
					   ), 0)::float as impact_points,
					   count(*) filter (where gpe.complexity_score >= 4)::int as substantive_prs,
					   case when count(*) > 0 then round(avg(gpe.complexity_score)::numeric, 1)::float else null end as avg_complexity
				from team_memberships tm
				join github_pull_requests gpr on gpr.email = tm.user_email
				left join github_pr_enrichments gpe on gpe.repo = gpr.repo and gpe.number = gpr.number
				where gpr.merged_at >= ${effFrom}::date
				  and gpr.merged_at < (${effTo}::date + interval '1 day')
				group by tm.team_id
			)
			select
				t.id as team_id,
				t.name as team_name,
				count(distinct tm.user_email)::int as member_count,
				(coalesce(ts.cc_cents, 0) + coalesce(tc.cu_cents, 0))::bigint as total_cents,
				(coalesce(ts.cc_tokens, 0) + coalesce(tc.cu_tokens, 0))::bigint as total_tokens,
				coalesce(tg.prs_merged, 0)::int as prs_merged,
				coalesce(tpi.impact_points, 0)::float as impact_points,
				coalesce(tpi.substantive_prs, 0)::int as substantive_prs,
				tpi.avg_complexity
			from teams t
			left join team_memberships tm on tm.team_id = t.id
			left join team_spend ts on ts.team_id = t.id
			left join team_cursor tc on tc.team_id = t.id
			left join team_git tg on tg.team_id = t.id
			left join team_pr_impact tpi on tpi.team_id = t.id
			group by t.id, t.name, ts.cc_cents, ts.cc_tokens, tc.cu_cents, tc.cu_tokens, tg.prs_merged, tpi.impact_points, tpi.substantive_prs, tpi.avg_complexity
			order by total_tokens desc
		`)

		const rows = teamsQuery.rows ?? []
		const teamItems = rows.map((r) => {
			const totalTokens = Number(r.total_tokens)
			const totalCostCents = Number(r.total_cents)
			const impactPoints = Number(Number(r.impact_points).toFixed(1))
			const prsMerged = Number(r.prs_merged)
			const substantivePrCount = Number(r.substantive_prs)

			const tokensPerImpactPoint = impactPoints > 0 ? Math.round(totalTokens / impactPoints) : null
			const costPerImpactPointCents =
				impactPoints > 0 ? Math.round(totalCostCents / impactPoints) : null

			return {
				teamId: r.team_id,
				teamName: r.team_name,
				memberCount: Number(r.member_count),
				totalTokens,
				totalCostCents,
				prsMerged,
				impactPoints,
				substantivePrCount,
				avgComplexity: r.avg_complexity,
				tokensPerImpactPoint,
				costPerImpactPointCents,
			}
		})

		await stripCostForViewer(teamItems, c, ["totalCostCents", "costPerImpactPointCents"])

		return c.json({
			from: effFrom,
			to: effTo,
			teams: teamItems,
		})
	})
}
