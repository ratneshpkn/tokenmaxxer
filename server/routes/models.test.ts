import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import {
	type AppUser,
	dailyClaudeCodeAttribution,
	dailyCursorUsage,
	modelAliases,
	trackedUsers,
} from "../../shared/schema"
import type { AppEnv } from "../auth/session"
import { db } from "../db"
import { registerModelRoutes } from "./models"

const app = new Hono<AppEnv>()
let mockUser: { id: string; email: string; role: "admin" | "viewer" } | null = null

app.use("*", async (c, next) => {
	if (mockUser) {
		c.set("user", mockUser as unknown as AppUser)
	}
	await next()
})

registerModelRoutes(app)

describe("models routes", () => {
	beforeAll(async () => {
		// Ensure singleton app_config row exists
		await db.execute(sql`
			insert into app_config (id) values (1)
			on conflict (id) do nothing
		`)

		// Clean up any test records
		await db.execute(sql`delete from daily_claude_code_attribution where model like 'test-%'`)
		await db.execute(sql`delete from daily_cursor_usage where model like 'test-%'`)
		await db.execute(sql`delete from tracked_users where email like '%@test.com'`)

		// Seed some test data
		// User 1 is tracked
		await db.insert(trackedUsers).values({
			email: "user1@test.com",
			name: "User One",
		})
		// User 2 is not tracked (left join check)

		// Daily Claude Code Attribution (platform: claude_code)
		await db.insert(dailyClaudeCodeAttribution).values({
			date: "2026-07-01",
			email: "user1@test.com",
			model: "test-claude-model",
			uncachedInputTokens: 100,
			cacheReadInputTokens: 50,
			cacheCreation5mTokens: 0,
			cacheCreation1hTokens: 0,
			outputTokens: 50,
			attributedCents: 500, // $5.00
		})

		// Daily Cursor Usage (platform: cursor)
		await db.insert(dailyCursorUsage).values({
			date: "2026-07-02",
			email: "user2@test.com", // Untracked user
			model: "test-cursor-model",
			inputTokens: 200,
			outputTokens: 100,
			cacheReadTokens: 100,
			cacheWriteTokens: 0,
			chargedCents: 1000, // $10.00
			requestCount: 5,
		})

		// A model that has both
		await db.insert(dailyClaudeCodeAttribution).values({
			date: "2026-07-03",
			email: "user1@test.com",
			model: "test-hybrid-model",
			uncachedInputTokens: 100,
			outputTokens: 50,
			attributedCents: 300,
		})
		await db.insert(dailyCursorUsage).values({
			date: "2026-07-03",
			email: "user2@test.com",
			model: "test-hybrid-model",
			inputTokens: 150,
			outputTokens: 50,
			chargedCents: 400,
		})
	})

	afterAll(async () => {
		// Clean up
		await db.execute(sql`delete from daily_claude_code_attribution where model like 'test-%'`)
		await db.execute(sql`delete from daily_cursor_usage where model like 'test-%'`)
		await db.execute(sql`delete from tracked_users where email like '%@test.com'`)
	})

	describe("GET /api/models/:model", () => {
		it("returns 404 for a non-existent model", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request("/api/models/test-non-existent?from=2026-07-01&to=2026-07-05")
			expect(res.status).toBe(404)
			const body = await res.json()
			expect(body.message).toBe("Model not found")
		})

		it("returns profile for admin role with cost and active users count", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request("/api/models/test-hybrid-model?from=2026-07-01&to=2026-07-05")
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.model).toBe("test-hybrid-model")
			expect(body.platforms).toContain("claude_code")
			expect(body.platforms).toContain("cursor")
			expect(body.cc_cents).toBe(300)
			expect(body.cu_cents).toBe(400)
			expect(body.total_cents).toBe(700)
			expect(body.active_users).toBe(2) // user1@test.com and user2@test.com
		})

		it("strips cost for viewer role", async () => {
			mockUser = { id: "2", email: "viewer@test.com", role: "viewer" }
			const res = await app.request("/api/models/test-hybrid-model?from=2026-07-01&to=2026-07-05")
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.cc_cents).toBeNull()
			expect(body.cu_cents).toBeNull()
			expect(body.total_cents).toBeNull()
			expect(body.total_tokens).toBe(350) // 150 (cc) + 200 (cu)
			expect(body.active_users).toBe(2)
		})

		it("filters by platform parameter", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request(
				"/api/models/test-hybrid-model?from=2026-07-01&to=2026-07-05&platform=claude_code",
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.cc_cents).toBe(300)
			expect(body.cu_cents).toBe(0)
			expect(body.total_cents).toBe(300)
			expect(body.active_users).toBe(1) // only user1@test.com
		})

		it("correctly aggregates multiple raw models mapped to a single base model", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			// 1. Seed two raw models into the daily attribution/usage tables
			await db.insert(dailyClaudeCodeAttribution).values({
				date: "2026-07-04",
				email: "user1@test.com",
				model: "test-raw-model-a",
				uncachedInputTokens: 100,
				outputTokens: 50,
				attributedCents: 200,
			})
			await db.insert(dailyClaudeCodeAttribution).values({
				date: "2026-07-04",
				email: "user1@test.com",
				model: "test-raw-model-b",
				uncachedInputTokens: 200,
				outputTokens: 100,
				attributedCents: 300,
			})

			// 2. Insert mappings in model_aliases
			await db
				.insert(modelAliases)
				.values([
					{ rawModel: "test-raw-model-a", baseModel: "Test Base Model" },
					{ rawModel: "test-raw-model-b", baseModel: "Test Base Model" },
				])
				.onConflictDoNothing()

			// 3. Request the profile for the base model
			const res = await app.request("/api/models/Test%20Base%20Model?from=2026-07-01&to=2026-07-05")
			expect(res.status).toBe(200)
			const body = await res.json()

			// 4. Verify aggregated results
			expect(body.model).toBe("Test Base Model")
			expect(body.cc_cents).toBe(500) // 200 + 300
			expect(body.cc_tokens).toBe(450) // (100+50) + (200+100)
			expect(body.raw_models).toContain("test-raw-model-a")
			expect(body.raw_models).toContain("test-raw-model-b")

			// Clean up
			await db.execute(sql`delete from model_aliases where base_model = 'Test Base Model'`)
			await db.execute(
				sql`delete from daily_claude_code_attribution where model in ('test-raw-model-a', 'test-raw-model-b')`,
			)
		})
	})

	describe("GET /api/models/:model/top-users", () => {
		it("returns users and preserves untracked user using left join", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request(
				"/api/models/test-hybrid-model/top-users?from=2026-07-01&to=2026-07-05",
			)
			expect(res.status).toBe(200)
			const body = (await res.json()) as Record<string, unknown>[]
			expect(body.length).toBe(2)

			const user1 = body.find((u) => u.email === "user1@test.com")
			const user2 = body.find((u) => u.email === "user2@test.com")

			expect(user1).toBeDefined()
			expect(user1.name).toBe("User One") // tracked
			expect(user1.cents).toBe(300)

			expect(user2).toBeDefined()
			expect(user2.name).toBeNull() // untracked but present!
			expect(user2.cents).toBe(400)
		})

		it("strips cost for viewer role", async () => {
			mockUser = { id: "2", email: "viewer@test.com", role: "viewer" }
			const res = await app.request(
				"/api/models/test-hybrid-model/top-users?from=2026-07-01&to=2026-07-05",
			)
			expect(res.status).toBe(200)
			const body = (await res.json()) as Record<string, unknown>[]
			expect(body.every((u) => u.cents === undefined)).toBe(true)
			expect(body.every((u) => u.tokens > 0)).toBe(true)
		})
	})

	describe("GET /api/models/:model/trend", () => {
		it("returns date range trend data", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request(
				"/api/models/test-hybrid-model/trend?from=2026-07-01&to=2026-07-03",
			)
			expect(res.status).toBe(200)
			const body = (await res.json()) as Record<string, unknown>[]
			expect(body.length).toBe(3) // 2026-07-01, 2026-07-02, 2026-07-03

			const day3 = body.find((d) => d.date === "2026-07-03")
			expect(day3).toBeDefined()
			expect(day3.cc_cents).toBe(300)
			expect(day3.cu_cents).toBe(400)
		})
	})

	describe("GET /api/models/:model/raw-models", () => {
		it("returns 404 for a non-existent model", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request(
				"/api/models/test-non-existent/raw-models?from=2026-07-01&to=2026-07-05",
			)
			expect(res.status).toBe(404)
			const body = await res.json()
			expect(body.message).toBe("Model not found")
		})

		it("returns raw models for admin role with cents, tokens, share_pct, and trend arrays", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request(
				"/api/models/test-hybrid-model/raw-models?from=2026-07-01&to=2026-07-03",
			)
			expect(res.status).toBe(200)
			const body = (await res.json()) as {
				raw_model: string
				cents: number | null
				tokens: number
				share_pct: number
				trend_cents: number[] | null
				trend_tokens: number[]
			}[]
			expect(body.length).toBe(1)
			const item = body[0]
			expect(item.raw_model).toBe("test-hybrid-model")
			expect(item.cents).toBe(700) // 300 (cc) + 400 (cu)
			expect(item.tokens).toBe(350) // 150 (cc) + 200 (cu)
			expect(item.share_pct).toBe(100) // only one raw model, so 100%
			expect(item.trend_cents).toBeDefined()
			expect(item.trend_tokens).toBeDefined()
			expect(item.trend_cents?.length).toBe(3) // 3 days
			expect(item.trend_tokens.length).toBe(3) // 3 days
		})

		it("strips cost fields and uses token-based share_pct for viewer role", async () => {
			mockUser = { id: "2", email: "viewer@test.com", role: "viewer" }
			const res = await app.request(
				"/api/models/test-hybrid-model/raw-models?from=2026-07-01&to=2026-07-03",
			)
			expect(res.status).toBe(200)
			const body = (await res.json()) as {
				raw_model: string
				cents: number | null
				tokens: number
				share_pct: number
				trend_cents: number[] | null
				trend_tokens: number[]
			}[]
			expect(body.length).toBe(1)
			const item = body[0]
			expect(item.raw_model).toBe("test-hybrid-model")
			expect(item.cents).toBeNull()
			expect(item.trend_cents).toBeNull()
			expect(item.tokens).toBe(350)
			expect(item.share_pct).toBe(100)
		})

		it("filters by platform parameter", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request(
				"/api/models/test-hybrid-model/raw-models?from=2026-07-01&to=2026-07-03&platform=claude_code",
			)
			expect(res.status).toBe(200)
			const body = (await res.json()) as {
				raw_model: string
				cents: number | null
				tokens: number
				share_pct: number
				trend_cents: number[] | null
				trend_tokens: number[]
			}[]
			expect(body.length).toBe(1)
			const item = body[0]
			expect(item.cents).toBe(300)
			expect(item.tokens).toBe(150)
		})

		it("returns empty array for zero usage in date window but exists in database", async () => {
			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request(
				"/api/models/test-hybrid-model/raw-models?from=2026-07-04&to=2026-07-05",
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body).toEqual([])
		})

		it("handles division by zero safety when total is zero", async () => {
			// Seed a test model with zero cost and zero tokens
			await db.insert(dailyClaudeCodeAttribution).values({
				date: "2026-07-01",
				email: "user1@test.com",
				model: "test-zero-model",
				uncachedInputTokens: 0,
				cacheReadInputTokens: 0,
				cacheCreation5mTokens: 0,
				cacheCreation1hTokens: 0,
				outputTokens: 0,
				attributedCents: 0,
			})

			mockUser = { id: "1", email: "admin@test.com", role: "admin" }
			const res = await app.request(
				"/api/models/test-zero-model/raw-models?from=2026-07-01&to=2026-07-03",
			)
			expect(res.status).toBe(200)
			const body = (await res.json()) as {
				raw_model: string
				cents: number | null
				tokens: number
				share_pct: number
				trend_cents: number[] | null
				trend_tokens: number[]
			}[]
			expect(body.length).toBe(1)
			expect(body[0].share_pct).toBe(0)

			// Clean up
			await db.execute(
				sql`delete from daily_claude_code_attribution where model = 'test-zero-model'`,
			)
		})
	})
})
