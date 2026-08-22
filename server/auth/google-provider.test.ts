import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { sql } from "drizzle-orm"
import { Hono } from "hono"
import { db } from "../db"
import { saveConfig } from "../lib/config"
import { setupGoogleAuth } from "./google-provider"
import type { AppEnv } from "./session"

process.env.CONFIG_ENCRYPTION_KEY = "00".repeat(32)

const app = new Hono<AppEnv>()

describe("google oauth provider", () => {
	beforeAll(async () => {
		await db.execute(sql`insert into app_config (id) values (1) on conflict (id) do nothing`)
		await setupGoogleAuth(app)
	})

	afterAll(async () => {
		await saveConfig({
			googleOauthEnabled: false,
			googleClientId: null,
			googleClientSecret: null,
		})
	})

	it("returns 404 when Google OAuth is disabled in config", async () => {
		await saveConfig({
			googleOauthEnabled: false,
			googleClientId: null,
			googleClientSecret: null,
		})

		const res = await app.request("/api/auth/google")
		expect(res.status).toBe(404)
	})

	it("dynamically enables and sets oauth state + PKCE cookies on redirect", async () => {
		await saveConfig({
			googleOauthEnabled: true,
			googleClientId: "test-client-id.apps.googleusercontent.com",
			googleClientSecret: "test-client-secret",
			allowedEmailDomain: "example.com",
		})

		const res = await app.request("/api/auth/google")
		expect(res.status).toBe(302)

		const location = res.headers.get("location") || ""
		expect(location).toContain("accounts.google.com")
		expect(location).toContain("client_id=test-client-id.apps.googleusercontent.com")
		expect(location).toContain("state=")
		expect(location).toContain("code_challenge=")
		expect(location).toContain("code_challenge_method=S256")

		const setCookie = res.headers.get("set-cookie") || ""
		expect(setCookie).toContain("tm.oauth_state=")
		expect(setCookie).toContain("tm.oauth_verifier=")
	})

	it("rejects callback without state matching the cookie", async () => {
		await saveConfig({
			googleOauthEnabled: true,
			googleClientId: "test-client-id.apps.googleusercontent.com",
			googleClientSecret: "test-client-secret",
		})

		// Missing state
		const resMissing = await app.request("/api/auth/google/callback?code=somecode")
		expect(resMissing.status).toBe(302)
		expect(resMissing.headers.get("location")).toBe("/login?error=unauthorized")

		// Mismatched state
		const resMismatch = await app.request(
			"/api/auth/google/callback?code=somecode&state=attackervalue",
			{
				headers: {
					Cookie: "tm.oauth_state=legitvalue; tm.oauth_verifier=legitverifier",
				},
			},
		)
		expect(resMismatch.status).toBe(302)
		expect(resMismatch.headers.get("location")).toBe("/login?error=unauthorized")
	})

	it("dynamically disables without restarting when config updated", async () => {
		await saveConfig({
			googleOauthEnabled: false,
		})

		const res = await app.request("/api/auth/google")
		expect(res.status).toBe(404)
	})
})
