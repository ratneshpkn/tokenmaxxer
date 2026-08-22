import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { appUsers } from "@shared/schema"
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv, AppUserSession } from "../auth/session"
import { db } from "../db"
import { registerAppUserRoutes } from "./app-users"

process.env.CONFIG_ENCRYPTION_KEY = "00".repeat(32)

const app = new Hono<AppEnv>()
let mockUser: { id: string; email: string; role: "admin" | "viewer" } | null = null

app.use("*", async (c, next) => {
	if (mockUser) {
		c.set("user", mockUser as unknown as AppUserSession)
	}
	await next()
})

registerAppUserRoutes(app)

describe("app users routes", () => {
	beforeAll(async () => {
		await db.execute(sql`insert into app_config (id) values (1) on conflict (id) do nothing`)
		await db.execute(sql`delete from app_users where email like '%@app-user-test.com'`)

		await db.insert(appUsers).values({
			email: "admin@app-user-test.com",
			role: "admin",
			name: "Admin Tester",
		})
	})

	afterAll(async () => {
		await db.execute(sql`delete from app_users where email like '%@app-user-test.com'`)
	})

	it("GET /api/app-users > rejects unauthenticated requests with 401", async () => {
		mockUser = null
		const res = await app.request("/api/app-users")
		expect(res.status).toBe(401)
	})

	it("GET /api/app-users > rejects viewer role with 403", async () => {
		mockUser = { id: "viewer-123", email: "viewer@app-user-test.com", role: "viewer" }
		const res = await app.request("/api/app-users")
		expect(res.status).toBe(403)
	})

	it("GET /api/app-users > allows admin role and returns user list", async () => {
		mockUser = { id: "admin-123", email: "admin@app-user-test.com", role: "admin" }
		const res = await app.request("/api/app-users")
		expect(res.status).toBe(200)

		const users = (await res.json()) as Array<{ email: string; role: string }>
		expect(Array.isArray(users)).toBe(true)
		expect(users.some((u) => u.email === "admin@app-user-test.com")).toBe(true)
	})
})
