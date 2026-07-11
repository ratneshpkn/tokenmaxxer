import { trackedUsers } from "@shared/schema"
import { eq, sql } from "drizzle-orm"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { isAuthenticated, requireAdmin } from "../auth/session"
import { db } from "../db"
import { coerceTrendArrays, stripCostForViewer } from "../lib/route-helpers"
import { startSyncRun } from "../scripts/lib/shared"
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
      gh as (
        select email,

               coalesce(sum(prs_merged),0)::bigint as prs_merged,
               coalesce(sum(additions),0)::bigint as additions,
               coalesce(sum(deletions),0)::bigint as deletions
          from daily_github_activity
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
             tu.github_username,
             tu.name,
             coalesce(cc.cents,0)  as cc_cents,
             coalesce(cu.cents,0)  as cu_cents,
             coalesce(cc.tokens,0) as cc_tokens,
             coalesce(cu.tokens,0) as cu_tokens,

             coalesce(gh.prs_merged,0) as gh_prs_merged,
             coalesce(gh.additions,0) as gh_additions,
             coalesce(gh.deletions,0) as gh_deletions,
             (select array_agg(cents order by date) from trends tr where tr.email = tu.email) as trend_cents,
             (select array_agg(tokens order by date) from trends tr where tr.email = tu.email) as trend_tokens
        from tracked_users tu
        left join cc on cc.email = tu.email
        left join cu on cu.email = tu.email
        left join gh on gh.email = tu.email
       where tu.is_active = true
       order by ${orderExpr}
     `)

		const typed = (result.rows ?? []) as Record<string, unknown>[]
		typed.forEach((row) => {
			coerceTrendArrays(row, ["trend_cents", "trend_tokens"])

			row.gh_prs_merged = Number(row.gh_prs_merged ?? 0)
			row.gh_additions = Number(row.gh_additions ?? 0)
			row.gh_deletions = Number(row.gh_deletions ?? 0)
			row.github_username = (row.github_username as string) ?? null
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

	// Per-user code output (commits, PRs)
	app.get("/api/users/:email/code-output", isAuthenticated, async (c) => {
		const parse = heatmapQuery.safeParse(c.req.query())
		if (!parse.success) {
			return c.json({ message: "Invalid query", issues: parse.error.issues }, 400)
		}
		const { from, to } = parse.data
		const email = String(c.req.param("email")).toLowerCase()

		const result = await db.execute<{
			date: string
			prs_opened: number
			prs_merged: number
			additions: number
			deletions: number
		}>(sql`
      select to_char(date, 'YYYY-MM-DD') as date,
             coalesce(prs_opened, 0)::int as prs_opened,
             coalesce(prs_merged, 0)::int as prs_merged,
             coalesce(additions, 0)::int as additions,
             coalesce(deletions, 0)::int as deletions
        from daily_github_activity
       where email = ${email} and date between ${from} and ${to}
       order by date asc
    `)
		return c.json(result.rows ?? [])
	})

	app.get("/api/users/:email/github-heatmap", isAuthenticated, async (c) => {
		const parse = heatmapQuery.safeParse(c.req.query())
		if (!parse.success) {
			return c.json({ message: "Invalid query", issues: parse.error.issues }, 400)
		}
		const { from, to } = parse.data
		const email = String(c.req.param("email")).toLowerCase()

		const result = await db.execute<{
			date: string
			prs_opened: number
			prs_merged: number
			additions: number
			deletions: number
		}>(sql`
      with dates as (
        select generate_series(${from}::date, ${to}::date, '1 day')::date as d
      )
      select to_char(d.d, 'YYYY-MM-DD') as date,
             coalesce(g.prs_opened, 0)::int as prs_opened,
             coalesce(g.prs_merged, 0)::int as prs_merged,
             coalesce(g.additions, 0)::int as additions,
             coalesce(g.deletions, 0)::int as deletions
        from dates d
        left join daily_github_activity g on g.date = d.d and g.email = ${email}
       order by d.d asc
    `)
		return c.json(result.rows ?? [])
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

	// Admin-only: update tracked user fields (githubUsername, name)
	const updateUserBody = z.object({
		githubUsername: z.string().trim().min(1).max(39).nullable().optional(),
		name: z.string().trim().min(1).max(200).nullable().optional(),
	})

	app.patch("/api/users/:email", requireAdmin, async (c) => {
		const email = String(c.req.param("email")).toLowerCase()
		const body = await c.req.json()
		const parse = updateUserBody.safeParse(body)
		if (!parse.success) {
			return c.json({ message: "Invalid body", issues: parse.error.issues }, 400)
		}
		const updates = parse.data
		if (Object.keys(updates).length === 0) {
			return c.json({ message: "No fields to update" }, 400)
		}

		// Check user exists
		const [existing] = await db
			.select({ email: trackedUsers.email, githubUsername: trackedUsers.githubUsername })
			.from(trackedUsers)
			.where(eq(trackedUsers.email, email))
		if (!existing) {
			return c.json({ message: "User not found" }, 404)
		}

		// Resolve/Merge uniqueness conflict for githubUsername
		if (updates.githubUsername) {
			updates.githubUsername = updates.githubUsername.toLowerCase()

			const [conflict] = await db
				.select({
					email: trackedUsers.email,
					anthropicUserId: trackedUsers.anthropicUserId,
					cursorUserId: trackedUsers.cursorUserId,
				})
				.from(trackedUsers)
				.where(eq(trackedUsers.githubUsername, updates.githubUsername))

			if (conflict && conflict.email !== email) {
				await db.transaction(async (tx) => {
					// 1. Remove githubUsername from conflict record
					await tx
						.update(trackedUsers)
						.set({ githubUsername: null, updatedAt: new Date() })
						.where(eq(trackedUsers.email, conflict.email))

					// 2. If conflict user record has no other platform mapping, mark it inactive
					if (!conflict.anthropicUserId && !conflict.cursorUserId) {
						await tx
							.update(trackedUsers)
							.set({ isActive: false, updatedAt: new Date() })
							.where(eq(trackedUsers.email, conflict.email))
					}

					// 3. Merge conflict user's daily_github_activity into this user
					await tx.execute(sql`
						insert into daily_github_activity (date, email, prs_opened, prs_merged, additions, deletions, synced_at)
						select date, ${email}, prs_opened, prs_merged, additions, deletions, synced_at
						from daily_github_activity
						where email = ${conflict.email}
						on conflict (date, email) do update set
							prs_opened = daily_github_activity.prs_opened + excluded.prs_opened,
							prs_merged = daily_github_activity.prs_merged + excluded.prs_merged,
							additions = daily_github_activity.additions + excluded.additions,
							deletions = daily_github_activity.deletions + excluded.deletions,
							synced_at = excluded.synced_at
					`)

					// 4. Delete old activity under conflict email
					await tx.execute(sql`
						delete from daily_github_activity where email = ${conflict.email}
					`)

					// 5. Update pull requests from the conflict user to point to this user's email
					await tx.execute(sql`
						update github_pull_requests
						set email = ${email}, synced_at = now()
						where email = ${conflict.email}
					`)
				})
			}
		}

		// Build the set clause
		const set: Record<string, unknown> = { updatedAt: new Date() }
		if (updates.githubUsername !== undefined) set.githubUsername = updates.githubUsername
		if (updates.name !== undefined) set.name = updates.name

		await db.update(trackedUsers).set(set).where(eq(trackedUsers.email, email))

		// If githubUsername was set to a new non-null value, trigger a backfill
		let backfillRunId: string | undefined
		const githubUsername = updates.githubUsername
		const ghChanged =
			githubUsername !== undefined &&
			githubUsername !== null &&
			githubUsername !== existing.githubUsername
		if (ghChanged && githubUsername) {
			try {
				const { backfillUserGithub } = await import("../scripts/backfill-user-github")
				const hasData = await db.execute<{ c: number }>(sql`
					select count(*)::int as c from daily_github_activity where email = ${email} limit 1
				`)
				const lookback = (hasData.rows?.[0]?.c ?? 0) > 0 ? 30 : 365
				backfillRunId = await startSyncRun("github", `user-mapping:${email}`)
				backfillUserGithub(email, githubUsername, lookback, {
					existingRunId: backfillRunId,
				}).catch((err) => console.error(`[users] backfill for ${email} failed`, err))
			} catch (err) {
				console.warn(`[users] failed to trigger backfill for ${email}:`, err)
			}
		}

		// Return updated user
		const r = await db.execute(sql`
			select tu.email, tu.name, tu.anthropic_user_id, tu.cursor_user_id, tu.github_username
			from tracked_users tu
			where tu.email = ${email}
		`)
		return c.json({ user: r.rows?.[0], backfillRunId })
	})

	// Single user summary — identity only. Window-aware totals come from
	// /api/users/:email/usage (consumed by user-detail.tsx which sums client-side).
	app.get("/api/users/:email", isAuthenticated, async (c) => {
		const email = String(c.req.param("email")).toLowerCase()
		const r = await db.execute(sql`
      select tu.email, tu.name, tu.anthropic_user_id, tu.cursor_user_id, tu.github_username
        from tracked_users tu
       where tu.email = ${email}
    `)
		const row = r.rows?.[0]
		if (!row) return c.json({ message: "User not found" }, 404)
		return c.json(row)
	})
}
