import type {
	TeamDetailResponse,
	TeamItem,
	TeamListResponse,
	TeamMemberItem,
} from "@shared/api-types"
import { teamMemberships, teams, trackedUsers } from "@shared/schema"
import { eq, inArray, sql } from "drizzle-orm"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { isAuthenticated, requireAdmin } from "../auth/session"
import { db } from "../db"
import { resolveWindow, stripCostForViewer } from "../lib/route-helpers"

// ── Zod Query & Payload Schemas ─────────────────────────────────────────────

const teamIdParamSchema = z.string().uuid()

const teamListQuery = z.object({
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

const createTeamSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(100),
	description: z.string().trim().max(500).optional(),
	memberEmails: z.array(z.string().email()).default([]),
})

const updateTeamSchema = z.object({
	name: z.string().trim().min(1).max(100).optional(),
	description: z.string().trim().max(500).optional(),
	memberEmails: z.array(z.string().email()).optional(),
})

// Database raw query row interfaces
interface TeamSummaryRow extends Record<string, unknown> {
	id: string
	name: string
	description: string | null
	member_count: string | number
	claude_code_tokens: string | number
	claude_code_cost_cents: string | number
	cursor_tokens: string | number
	cursor_cost_cents: string | number
	total_tokens: string | number
	total_cost_cents: string | number
}

interface TeamMemberRow extends Record<string, unknown> {
	email: string
	name: string | null
	anthropic_user_id: string | null
	cursor_user_id: string | null
	github_username: string | null
	is_active: boolean
	claude_code_tokens: string | number
	claude_code_cost_cents: string | number
	cursor_tokens: string | number
	cursor_cost_cents: string | number
	total_tokens: string | number
	total_cost_cents: string | number
}

export function registerTeamRoutes(app: Hono<AppEnv>): void {
	// ── GET /api/teams ────────────────────────────────────────────────────────
	// Returns a list of all teams with member counts, token breakdown, and cost.
	// Cost fields are stripped server-side for viewer roles.
	app.get("/api/teams", isAuthenticated, async (c) => {
		const parse = teamListQuery.safeParse(c.req.query())
		if (!parse.success) {
			return c.json({ message: "Invalid query parameters", issues: parse.error.issues }, 400)
		}

		const { effFrom: from, effTo: to } = resolveWindow(parse.data, 30)

		const query = sql`
			with team_members as (
				select team_id, count(distinct user_email)::int as member_count
				from team_memberships
				group by team_id
			),
			cc_usage as (
				select tm.team_id,
					coalesce(sum(ca.attributed_cents), 0)::bigint as cc_cents,
					coalesce(sum(ca.uncached_input_tokens + ca.cache_read_input_tokens + ca.cache_creation_5m_tokens + ca.cache_creation_1h_tokens + ca.output_tokens), 0)::bigint as cc_tokens
				from team_memberships tm
				join daily_claude_code_attribution ca on ca.email = tm.user_email
				where ca.date between ${from} and ${to}
				group by tm.team_id
			),
			cu_usage as (
				select tm.team_id,
					coalesce(sum(cu.charged_cents), 0)::bigint as cu_cents,
					coalesce(sum(cu.input_tokens + cu.output_tokens + cu.cache_read_tokens + cu.cache_write_tokens), 0)::bigint as cu_tokens
				from team_memberships tm
				join daily_cursor_usage cu on cu.email = tm.user_email
				where cu.date between ${from} and ${to}
				group by tm.team_id
			)
			select
				t.id,
				t.name,
				t.description,
				coalesce(tm.member_count, 0) as member_count,
				coalesce(cc.cc_tokens, 0) as claude_code_tokens,
				coalesce(cc.cc_cents, 0) as claude_code_cost_cents,
				coalesce(cu.cu_tokens, 0) as cursor_tokens,
				coalesce(cu.cu_cents, 0) as cursor_cost_cents,
				(coalesce(cc.cc_tokens, 0) + coalesce(cu.cu_tokens, 0)) as total_tokens,
				(coalesce(cc.cc_cents, 0) + coalesce(cu.cu_cents, 0)) as total_cost_cents
			from teams t
			left join team_members tm on tm.team_id = t.id
			left join cc_usage cc on cc.team_id = t.id
			left join cu_usage cu on cu.team_id = t.id
			order by total_tokens desc, t.name asc
		`

		const res = await db.execute<TeamSummaryRow>(query)
		const formatted: TeamItem[] = res.rows.map((r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			memberCount: Number(r.member_count || 0),
			totalTokens: Number(r.total_tokens || 0),
			claudeCodeTokens: Number(r.claude_code_tokens || 0),
			cursorTokens: Number(r.cursor_tokens || 0),
			totalCostCents: Number(r.total_cost_cents || 0),
			claudeCodeCostCents: Number(r.claude_code_cost_cents || 0),
			cursorCostCents: Number(r.cursor_cost_cents || 0),
		}))

		// Server-side RBAC cost stripping
		await stripCostForViewer(formatted as unknown as Record<string, unknown>[], c, [
			"totalCostCents",
			"claudeCodeCostCents",
			"cursorCostCents",
		])

		const response: TeamListResponse = {
			from,
			to,
			teams: formatted,
		}

		return c.json(response)
	})

	// ── POST /api/teams ───────────────────────────────────────────────────────
	// Admin-only: creates a new team and assigns members in a transaction.
	app.post("/api/teams", isAuthenticated, requireAdmin, async (c) => {
		const body = await c.req.json().catch(() => ({}))
		const parse = createTeamSchema.safeParse(body)
		if (!parse.success) {
			return c.json({ message: "Invalid payload", issues: parse.error.issues }, 400)
		}

		const { name, description, memberEmails } = parse.data

		// Check name uniqueness
		const existing = await db.select().from(teams).where(eq(teams.name, name)).limit(1)
		if (existing.length > 0) {
			return c.json({ message: "A team with this name already exists" }, 400)
		}

		let insertedMemberCount = 0
		const newTeam = await db.transaction(async (tx) => {
			const [created] = await tx
				.insert(teams)
				.values({
					name,
					description,
				})
				.returning()

			if (memberEmails && memberEmails.length > 0) {
				const uniqueEmails = Array.from(new Set(memberEmails))
				const validUsers = await tx
					.select({ email: trackedUsers.email })
					.from(trackedUsers)
					.where(inArray(trackedUsers.email, uniqueEmails))

				if (validUsers.length > 0) {
					await tx.insert(teamMemberships).values(
						validUsers.map((u) => ({
							teamId: created.id,
							userEmail: u.email,
						})),
					)
					insertedMemberCount = validUsers.length
				}
			}
			return created
		})

		return c.json(
			{
				team: {
					id: newTeam.id,
					name: newTeam.name,
					description: newTeam.description,
					memberCount: insertedMemberCount,
					totalTokens: 0,
					claudeCodeTokens: 0,
					cursorTokens: 0,
					totalCostCents: 0,
					claudeCodeCostCents: 0,
					cursorCostCents: 0,
				},
			},
			201,
		)
	})

	// ── GET /api/teams/:id ────────────────────────────────────────────────────
	// Team detail: returns team info and assigned member roster with individual totals.
	app.get("/api/teams/:id", isAuthenticated, async (c) => {
		const paramCheck = teamIdParamSchema.safeParse(c.req.param("id"))
		if (!paramCheck.success) {
			return c.json({ message: "Invalid team ID format" }, 400)
		}
		const teamId = paramCheck.data

		const parse = teamListQuery.safeParse(c.req.query())
		if (!parse.success) {
			return c.json({ message: "Invalid query parameters", issues: parse.error.issues }, 400)
		}

		const { effFrom: from, effTo: to } = resolveWindow(parse.data, 30)

		const [teamRecord] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
		if (!teamRecord) {
			return c.json({ message: "Team not found" }, 404)
		}

		// Roster query with usage attribution
		const rosterQuery = sql`
			with cc_user as (
				select ca.email,
					coalesce(sum(ca.attributed_cents), 0)::bigint as cc_cents,
					coalesce(sum(ca.uncached_input_tokens + ca.cache_read_input_tokens + ca.cache_creation_5m_tokens + ca.cache_creation_1h_tokens + ca.output_tokens), 0)::bigint as cc_tokens
				from daily_claude_code_attribution ca
				where ca.date between ${from} and ${to}
				group by ca.email
			),
			cu_user as (
				select cu.email,
					coalesce(sum(cu.charged_cents), 0)::bigint as cu_cents,
					coalesce(sum(cu.input_tokens + cu.output_tokens + cu.cache_read_tokens + cu.cache_write_tokens), 0)::bigint as cu_tokens
				from daily_cursor_usage cu
				where cu.date between ${from} and ${to}
				group by cu.email
			)
			select
				tu.email,
				tu.name,
				tu.anthropic_user_id,
				tu.cursor_user_id,
				tu.github_username,
				tu.is_active,
				coalesce(cc.cc_tokens, 0) as claude_code_tokens,
				coalesce(cc.cc_cents, 0) as claude_code_cost_cents,
				coalesce(cu.cu_tokens, 0) as cursor_tokens,
				coalesce(cu.cu_cents, 0) as cursor_cost_cents,
				(coalesce(cc.cc_tokens, 0) + coalesce(cu.cu_tokens, 0)) as total_tokens,
				(coalesce(cc.cc_cents, 0) + coalesce(cu.cu_cents, 0)) as total_cost_cents
			from team_memberships tm
			join tracked_users tu on tu.email = tm.user_email
			left join cc_user cc on cc.email = tu.email
			left join cu_user cu on cu.email = tu.email
			where tm.team_id = ${teamId}
			order by total_tokens desc, tu.email asc
		`

		const rosterRes = await db.execute<TeamMemberRow>(rosterQuery)

		const members: TeamMemberItem[] = rosterRes.rows.map((r) => ({
			email: r.email,
			name: r.name,
			anthropicUserId: r.anthropic_user_id,
			cursorUserId: r.cursor_user_id,
			githubUsername: r.github_username,
			isActive: r.is_active,
			totalTokens: Number(r.total_tokens || 0),
			totalCostCents: Number(r.total_cost_cents || 0),
		}))

		const totalTokens = members.reduce((acc, m) => acc + m.totalTokens, 0)
		const totalCostCents = members.reduce((acc, m) => acc + (m.totalCostCents ?? 0), 0)
		const claudeCodeTokens = rosterRes.rows.reduce(
			(acc, r) => acc + Number(r.claude_code_tokens || 0),
			0,
		)
		const cursorTokens = rosterRes.rows.reduce((acc, r) => acc + Number(r.cursor_tokens || 0), 0)
		const claudeCodeCostCents = rosterRes.rows.reduce(
			(acc, r) => acc + Number(r.claude_code_cost_cents || 0),
			0,
		)
		const cursorCostCents = rosterRes.rows.reduce(
			(acc, r) => acc + Number(r.cursor_cost_cents || 0),
			0,
		)

		const teamItem: TeamItem = {
			id: teamRecord.id,
			name: teamRecord.name,
			description: teamRecord.description,
			memberCount: members.length,
			totalTokens,
			claudeCodeTokens,
			cursorTokens,
			totalCostCents,
			claudeCodeCostCents,
			cursorCostCents,
		}

		// Server-side RBAC cost stripping
		await stripCostForViewer([teamItem] as unknown as Record<string, unknown>[], c, [
			"totalCostCents",
			"claudeCodeCostCents",
			"cursorCostCents",
		])
		await stripCostForViewer(members as unknown as Record<string, unknown>[], c, ["totalCostCents"])

		const response: TeamDetailResponse = {
			team: teamItem,
			members,
		}

		return c.json(response)
	})

	// ── PATCH /api/teams/:id ──────────────────────────────────────────────────
	// Admin-only: updates team metadata and/or replaces team members in a transaction.
	app.patch("/api/teams/:id", isAuthenticated, requireAdmin, async (c) => {
		const paramCheck = teamIdParamSchema.safeParse(c.req.param("id"))
		if (!paramCheck.success) {
			return c.json({ message: "Invalid team ID format" }, 400)
		}
		const teamId = paramCheck.data

		const body = await c.req.json().catch(() => ({}))
		const parse = updateTeamSchema.safeParse(body)
		if (!parse.success) {
			return c.json({ message: "Invalid payload", issues: parse.error.issues }, 400)
		}

		const [existingTeam] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
		if (!existingTeam) {
			return c.json({ message: "Team not found" }, 404)
		}

		const { name, description, memberEmails } = parse.data

		if (name && name !== existingTeam.name) {
			const nameCheck = await db.select().from(teams).where(eq(teams.name, name)).limit(1)
			if (nameCheck.length > 0) {
				return c.json({ message: "A team with this name already exists" }, 400)
			}
		}

		const updatePayload: Partial<typeof teams.$inferInsert> = {
			updatedAt: new Date(),
		}
		if (name !== undefined) updatePayload.name = name
		if (description !== undefined) updatePayload.description = description

		const updatedTeam = await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(teams)
				.set(updatePayload)
				.where(eq(teams.id, teamId))
				.returning()

			if (memberEmails !== undefined) {
				await tx.delete(teamMemberships).where(eq(teamMemberships.teamId, teamId))

				if (memberEmails.length > 0) {
					const uniqueEmails = Array.from(new Set(memberEmails))
					const validUsers = await tx
						.select({ email: trackedUsers.email })
						.from(trackedUsers)
						.where(inArray(trackedUsers.email, uniqueEmails))

					if (validUsers.length > 0) {
						await tx.insert(teamMemberships).values(
							validUsers.map((u) => ({
								teamId: updated.id,
								userEmail: u.email,
							})),
						)
					}
				}
			}
			return updated
		})

		const currentMembers = await db
			.select()
			.from(teamMemberships)
			.where(eq(teamMemberships.teamId, teamId))

		return c.json({
			team: {
				id: updatedTeam.id,
				name: updatedTeam.name,
				description: updatedTeam.description,
				memberCount: currentMembers.length,
			},
		})
	})

	// ── DELETE /api/teams/:id ─────────────────────────────────────────────────
	// Admin-only: deletes team and cascading memberships.
	app.delete("/api/teams/:id", isAuthenticated, requireAdmin, async (c) => {
		const paramCheck = teamIdParamSchema.safeParse(c.req.param("id"))
		if (!paramCheck.success) {
			return c.json({ message: "Invalid team ID format" }, 400)
		}
		const teamId = paramCheck.data

		const [existingTeam] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
		if (!existingTeam) {
			return c.json({ message: "Team not found" }, 404)
		}

		await db.delete(teams).where(eq(teams.id, teamId))
		return c.json({ message: "Team deleted successfully", id: teamId })
	})
}
