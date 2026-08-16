import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { appUsers, invitations } from "@shared/schema"
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import { hashPassword } from "../auth/password"
import type { AppEnv, AppUserSession } from "../auth/session"
import { db } from "../db"
import { saveConfig } from "../lib/config"
import { registerAdminConfigRoutes } from "./admin-config"
import { registerAuthPasswordRoutes } from "./auth-password"

process.env.CONFIG_ENCRYPTION_KEY = "00".repeat(32)

const app = new Hono<AppEnv>()
let mockUser: { id: string; email: string; role: "admin" | "viewer" } | null = null

app.use("*", async (c, next) => {
	if (mockUser) {
		c.set("user", mockUser as unknown as AppUserSession)
	}
	await next()
})

registerAuthPasswordRoutes(app)
registerAdminConfigRoutes(app)

let testUserId: string

describe("auth password routes and admin config validation", () => {
	beforeAll(async () => {
		await db.execute(sql`insert into app_config (id) values (1) on conflict (id) do nothing`)
		await db.execute(sql`delete from invitations where email like '%@auth-test.com'`)
		await db.execute(sql`delete from app_users where email like '%@auth-test.com'`)

		// Seed a test user with a known password
		const pwHash = await hashPassword("password123")
		const [user] = await db
			.insert(appUsers)
			.values({
				email: "user@auth-test.com",
				role: "admin",
				passwordHash: pwHash,
			})
			.returning()
		testUserId = user.id

		// Mark bootstrap complete
		await db.execute(
			sql`update app_config set bootstrap_admin_user_id = ${testUserId} where id = 1`,
		)
		await saveConfig({
			passwordAuthDisabled: false,
			googleOauthEnabled: false,
			googleClientId: null,
			googleClientSecret: null,
		})
	})

	afterAll(async () => {
		await db.execute(sql`delete from invitations where email like '%@auth-test.com'`)
		await db.execute(sql`delete from app_users where email like '%@auth-test.com'`)
		await saveConfig({ passwordAuthDisabled: false })
	})

	it("POST /api/auth/login > succeeds with valid credentials when password auth is enabled", async () => {
		await saveConfig({ passwordAuthDisabled: false })

		const res = await app.request("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "user@auth-test.com",
				password: "password123",
			}),
		})

		expect(res.status).toBe(200)
		const body = (await res.json()) as { email: string; role: string }
		expect(body.email).toBe("user@auth-test.com")
	})

	it("POST /api/auth/login > returns 403 when password auth is disabled", async () => {
		await saveConfig({ passwordAuthDisabled: true })

		const res = await app.request("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "user@auth-test.com",
				password: "password123",
			}),
		})

		expect(res.status).toBe(403)
		const body = (await res.json()) as { message: string }
		expect(body.message).toContain("disabled")
	})

	it("POST /api/auth/signup > returns 403 for self-signup when password auth is disabled", async () => {
		await saveConfig({
			passwordAuthDisabled: true,
			openSignupEnabled: true,
			allowedEmailDomain: "auth-test.com",
		})

		const res = await app.request("/api/auth/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "newuser@auth-test.com",
				password: "password123",
			}),
		})

		expect(res.status).toBe(403)
		const body = (await res.json()) as { message: string }
		expect(body.message).toContain("disabled")
	})

	it("POST /api/auth/signup > allows invited user signup even when password auth is disabled", async () => {
		await saveConfig({ passwordAuthDisabled: true })

		const token = "test-invite-token-123"
		await db.insert(invitations).values({
			token,
			email: "invited@auth-test.com",
			role: "viewer",
			createdBy: testUserId,
			expiresAt: new Date(Date.now() + 86400000),
		})

		const res = await app.request("/api/auth/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "invited@auth-test.com",
				password: "newpassword123",
				token,
			}),
		})

		expect(res.status).toBe(200)
		const body = (await res.json()) as { email: string; role: string }
		expect(body.email).toBe("invited@auth-test.com")
	})

	it("PUT /api/admin/config > rejects disabling password auth without Google OAuth configured", async () => {
		mockUser = { id: testUserId, email: "user@auth-test.com", role: "admin" }

		await saveConfig({
			passwordAuthDisabled: false,
			googleOauthEnabled: false,
			googleClientId: null,
			googleClientSecret: null,
		})

		const res = await app.request("/api/admin/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				passwordAuthDisabled: true,
				googleOauthEnabled: false,
			}),
		})

		expect(res.status).toBe(400)
		const body = (await res.json()) as { message: string }
		expect(body.message).toContain("Cannot disable password authentication without enabling")
	})

	it("PUT /api/admin/config > allows disabling password auth when Google OAuth is fully configured", async () => {
		mockUser = { id: testUserId, email: "user@auth-test.com", role: "admin" }

		const res = await app.request("/api/admin/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				googleOauthEnabled: true,
				googleClientId: "test-client-id.apps.googleusercontent.com",
				googleClientSecret: "test-client-secret",
				passwordAuthDisabled: true,
			}),
		})

		expect(res.status).toBe(200)
		const body = (await res.json()) as { ok: boolean }
		expect(body.ok).toBe(true)
	})

	it("POST /api/auth/signup > rejects uninvited signup even if bootstrapAdminUserId is null when users already exist", async () => {
		// Simulate null bootstrapAdminUserId (e.g. from Google-only signup or partial restore)
		await db.execute(sql`update app_config set bootstrap_admin_user_id = null where id = 1`)
		await saveConfig({
			passwordAuthDisabled: false,
			openSignupEnabled: false,
			allowedEmailDomain: "auth-test.com",
		})

		const res = await app.request("/api/auth/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "uninvited@auth-test.com",
				password: "password12345",
			}),
		})

		expect(res.status).toBe(403)
		const body = (await res.json()) as { message: string }
		expect(body.message).toContain("invite-only")
	})
})
