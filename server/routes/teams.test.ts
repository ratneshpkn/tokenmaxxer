import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import type { TeamItem } from "@shared/api-types"
import { trackedUsers } from "@shared/schema"
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv, AppUserSession } from "../auth/session"
import { db } from "../db"
import { registerTeamRoutes } from "./teams"

const app = new Hono<AppEnv>()
let mockUser: { id: string; email: string; role: "admin" | "viewer" } | null = null

app.use("*", async (c, next) => {
	if (mockUser) {
		c.set("user", mockUser as unknown as AppUserSession)
	}
	await next()
})

registerTeamRoutes(app)

describe("teams routes", () => {
	beforeAll(async () => {
		// Clean up previous test records and ensure clean app_config
		await db.execute(sql`insert into app_config (id) values (1) on conflict (id) do nothing`)
		await db.execute(sql`
			update app_config set 
				google_client_secret_enc = null,
				anthropic_admin_api_key_enc = null,
				cursor_admin_api_key_enc = null,
				slack_bot_token_enc = null,
				github_access_token_enc = null,
				enrichment_api_key_enc = null
			where id = 1
		`)
		await db.execute(sql`delete from team_memberships`)
		await db.execute(sql`delete from teams where name like 'Test %'`)
		await db.execute(sql`delete from tracked_users where email like '%@test-team.com'`)

		// Seed tracked users for test team assignments
		await db.insert(trackedUsers).values([
			{
				email: "alice@test-team.com",
				name: "Alice Tester",
			},
			{
				email: "bob@test-team.com",
				name: "Bob Tester",
			},
		])
	})

	afterAll(async () => {
		await db.execute(sql`delete from team_memberships`)
		await db.execute(sql`delete from teams where name like 'Test %'`)
		await db.execute(sql`delete from tracked_users where email like '%@test-team.com'`)
	})

	it("POST /api/teams > allows admin to create a team", async () => {
		mockUser = { id: "admin-1", email: "admin@test-team.com", role: "admin" }

		const res = await app.request("/api/teams", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Test Frontend Team",
				description: "Frontend team",
				memberEmails: ["alice@test-team.com"],
			}),
		})

		expect(res.status).toBe(201)
		const data = await res.json()
		expect(data.team).toBeDefined()
		expect(data.team.name).toBe("Test Frontend Team")
		expect(data.team.memberCount).toBe(1)
	})

	it("POST /api/teams > rejects creation with duplicate name", async () => {
		mockUser = { id: "admin-1", email: "admin@test-team.com", role: "admin" }

		const res = await app.request("/api/teams", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Test Frontend Team",
			}),
		})

		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.message).toContain("already exists")
	})

	it("POST /api/teams > rejects creation with whitespace-only name", async () => {
		mockUser = { id: "admin-1", email: "admin@test-team.com", role: "admin" }

		const res = await app.request("/api/teams", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "   ",
			}),
		})

		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data.message).toBe("Invalid payload")
	})

	it("POST /api/teams > ignores non-existent tracked users in memberCount", async () => {
		mockUser = { id: "admin-1", email: "admin@test-team.com", role: "admin" }

		const res = await app.request("/api/teams", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Test Mixed Members Team",
				memberEmails: ["alice@test-team.com", "nonexistent@test-team.com"],
			}),
		})

		expect(res.status).toBe(201)
		const data = await res.json()
		expect(data.team.memberCount).toBe(1)
	})

	it("POST /api/teams > blocks viewer role from creating teams", async () => {
		mockUser = { id: "viewer-1", email: "viewer@test-team.com", role: "viewer" }

		const res = await app.request("/api/teams", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Test Unauthorized Team",
			}),
		})

		expect(res.status).toBe(403)
	})

	it("GET /api/teams > lists teams with role-based cost stripping", async () => {
		// Viewer request
		mockUser = { id: "viewer-1", email: "viewer@test-team.com", role: "viewer" }
		const viewerRes = await app.request("/api/teams?days=30")
		expect(viewerRes.status).toBe(200)
		const viewerData = (await viewerRes.json()) as { teams: TeamItem[] }
		expect(viewerData.teams).toBeDefined()
		const viewerTeam = viewerData.teams.find((t) => t.name === "Test Frontend Team")
		expect(viewerTeam).toBeDefined()
		expect(viewerTeam?.totalCostCents).toBeUndefined()

		// Admin request
		mockUser = { id: "admin-1", email: "admin@test-team.com", role: "admin" }
		const adminRes = await app.request("/api/teams?days=30")
		expect(adminRes.status).toBe(200)
		const adminData = (await adminRes.json()) as { teams: TeamItem[] }
		const adminTeam = adminData.teams.find((t) => t.name === "Test Frontend Team")
		expect(adminTeam).toBeDefined()
		expect(adminTeam?.totalCostCents).toBeDefined()
	})

	it("GET /api/teams/:id > fetches team detail and roster", async () => {
		mockUser = { id: "admin-1", email: "admin@test-team.com", role: "admin" }
		const listRes = await app.request("/api/teams")
		const listData = (await listRes.json()) as { teams: TeamItem[] }
		const targetTeam = listData.teams.find((t) => t.name === "Test Frontend Team")

		const res = await app.request(`/api/teams/${targetTeam?.id}?days=30`)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.team.name).toBe("Test Frontend Team")
		expect(data.members.length).toBe(1)
		expect(data.members[0].email).toBe("alice@test-team.com")
	})

	it("PATCH /api/teams/:id > updates team metadata and members", async () => {
		mockUser = { id: "admin-1", email: "admin@test-team.com", role: "admin" }
		const listRes = await app.request("/api/teams")
		const listData = (await listRes.json()) as { teams: TeamItem[] }
		const targetTeam = listData.teams.find((t) => t.name === "Test Frontend Team")

		const res = await app.request(`/api/teams/${targetTeam?.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				description: "Updated description",
				memberEmails: ["alice@test-team.com", "bob@test-team.com"],
			}),
		})

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.team.description).toBe("Updated description")
		expect(data.team.memberCount).toBe(2)
	})

	it("DELETE /api/teams/:id > allows admin to delete a team", async () => {
		mockUser = { id: "admin-1", email: "admin@test-team.com", role: "admin" }
		const listRes = await app.request("/api/teams")
		const listData = (await listRes.json()) as { teams: TeamItem[] }
		const targetTeam = listData.teams.find((t) => t.name === "Test Frontend Team")

		const res = await app.request(`/api/teams/${targetTeam?.id}`, {
			method: "DELETE",
		})
		expect(res.status).toBe(200)

		const verifyRes = await app.request(`/api/teams/${targetTeam?.id}`)
		expect(verifyRes.status).toBe(404)
	})
})
