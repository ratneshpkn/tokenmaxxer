import { type AppUser, appUsers } from "@shared/schema"
import { eq } from "drizzle-orm"
import type { Context, Hono, Next } from "hono"
import { db } from "../db"
import { isEmailDomainAllowed, loadConfig, parseAllowedDomains } from "../lib/config"
import type { AppEnv } from "./session"
import { createSession, destroySession } from "./session"

const DEFAULT_CALLBACK_PATH = "/api/auth/google/callback"

function resolveBaseUrl(c: Context<AppEnv>): string {
	if (process.env.BASE_URL) return process.env.BASE_URL
	const urlObj = new URL(c.req.url)
	const proto = c.req.header("x-forwarded-proto") || urlObj.protocol.replace(":", "")
	const host = c.req.header("x-forwarded-host") || c.req.header("host") || urlObj.host
	return `${proto}://${host}`
}

function resolveCallbackUrl(c: Context<AppEnv>): string {
	if (process.env.GOOGLE_OAUTH_REDIRECT_URI) return process.env.GOOGLE_OAUTH_REDIRECT_URI
	return `${resolveBaseUrl(c)}${DEFAULT_CALLBACK_PATH}`
}

function callbackRoutePath(): string {
	if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
		try {
			return new URL(process.env.GOOGLE_OAUTH_REDIRECT_URI).pathname || DEFAULT_CALLBACK_PATH
		} catch {
			throw new Error(
				`GOOGLE_OAUTH_REDIRECT_URI must be a full URL (got: ${process.env.GOOGLE_OAUTH_REDIRECT_URI})`,
			)
		}
	}
	return DEFAULT_CALLBACK_PATH
}

async function allowedDomainsFromConfig(): Promise<string[]> {
	const cfg = await loadConfig()
	const domainStr = cfg.allowedEmailDomain ?? process.env.ALLOWED_EMAIL_DOMAIN ?? null
	return parseAllowedDomains(domainStr)
}

// Custom in-memory rate limiter middleware for Google OAuth
const tracker = new Map<string, { count: number; resetAt: number }>()
async function oauthLimiter(c: Context<AppEnv>, next: Next) {
	const ip = c.req.header("x-forwarded-for") || "anonymous"
	const now = Date.now()
	const windowMs = 15 * 60 * 1000
	const record = tracker.get(ip) || { count: 0, resetAt: now + windowMs }

	if (now > record.resetAt) {
		record.count = 0
		record.resetAt = now + windowMs
	}

	record.count++
	tracker.set(ip, record)

	if (record.count > 30) {
		return c.json({ message: "Too many requests, please try again later." }, 429)
	}

	await next()
}

export async function setupGoogleAuth(app: Hono<AppEnv>): Promise<void> {
	const cfg = await loadConfig()
	const googleClientId = cfg.googleClientId ?? process.env.GOOGLE_CLIENT_ID
	const googleClientSecret = cfg.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET
	const googleEnabled = cfg.googleOauthEnabled && !!googleClientId && !!googleClientSecret

	const cbPath = callbackRoutePath()

	if (!googleEnabled) {
		app.get("/api/auth/google", (c) => c.json({ message: "Google OAuth disabled" }, 404))
		app.get(cbPath, (c) => c.json({ message: "Google OAuth disabled" }, 404))
		app.post("/api/auth/logout", (c) => {
			destroySession(c)
			return c.json({ ok: true })
		})
		console.log("[auth] Google OAuth disabled (no client credentials in app_config or env)")
		return
	}

	console.log(`[auth] Google callback registered at ${cbPath}`)

	app.get("/api/auth/google", oauthLimiter, async (c) => {
		const domains = await allowedDomainsFromConfig()
		const callbackUrl = resolveCallbackUrl(c)
		let googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=profile%20email`
		if (domains.length === 1) {
			googleAuthUrl += `&hd=${domains[0]}`
		}
		return c.redirect(googleAuthUrl)
	})

	app.get(cbPath, oauthLimiter, async (c) => {
		const code = c.req.query("code")
		if (!code || !googleClientId || !googleClientSecret) {
			return c.redirect("/login?error=unauthorized")
		}

		try {
			const callbackUrl = resolveCallbackUrl(c)
			const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					code,
					client_id: googleClientId,
					client_secret: googleClientSecret,
					redirect_uri: callbackUrl,
					grant_type: "authorization_code",
				}).toString(),
			})

			if (!tokenRes.ok) {
				console.error("[auth] Google token exchange failed", await tokenRes.text())
				return c.redirect("/login?error=unauthorized")
			}

			const tokens = (await tokenRes.json()) as { access_token: string }
			const accessToken = tokens.access_token

			const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
				headers: { Authorization: `Bearer ${accessToken}` },
			})

			if (!userInfoRes.ok) {
				console.error("[auth] Google userinfo fetch failed", await userInfoRes.text())
				return c.redirect("/login?error=unauthorized")
			}

			const profile = (await userInfoRes.json()) as { sub?: string; email?: string; name?: string }
			const email = profile.email?.toLowerCase()
			if (!email) {
				return c.redirect("/login?error=unauthorized")
			}

			const domains = await allowedDomainsFromConfig()
			if (domains.length > 0 && !isEmailDomainAllowed(email, domains)) {
				return c.redirect("/login?error=unauthorized")
			}

			// Look up existing user by email
			const existing = await db.select().from(appUsers).where(eq(appUsers.email, email)).limit(1)

			let user: AppUser

			if (existing.length > 0) {
				const u = existing[0]
				const updates: Partial<AppUser> = {
					lastLoginAt: new Date(),
					name: profile.name ?? u.name,
				}
				if (!u.googleId && profile.sub) {
					updates.googleId = profile.sub // lazy-link on first Google sign-in
				}
				const [updated] = await db
					.update(appUsers)
					.set(updates)
					.where(eq(appUsers.id, u.id))
					.returning()
				user = updated
			} else {
				// No existing user — Google never auto-creates without explicit permit.
				// Open self-signup with domain match is the only path here.
				const cfg2 = await loadConfig()
				const domains2 = parseAllowedDomains(
					cfg2.allowedEmailDomain ?? process.env.ALLOWED_EMAIL_DOMAIN ?? null,
				)
				if (
					cfg2.openSignupEnabled &&
					domains2.length > 0 &&
					isEmailDomainAllowed(email, domains2)
				) {
					const [created] = await db
						.insert(appUsers)
						.values({
							email,
							name: profile.name ?? null,
							role: "viewer",
							googleId: profile.sub,
							lastLoginAt: new Date(),
						})
						.returning()
					if (!created) {
						return c.redirect("/login?error=unauthorized")
					}
					user = created
				} else {
					return c.redirect("/login?error=unauthorized")
				}
			}

			// Create session and set cookie
			await createSession(c, user.id)

			// Safari ITP compatibility redirection
			return c.html(`<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=/"></head>
<body><script>location.replace("/")</script>Signing in&hellip;</body></html>`)
		} catch (err) {
			console.error("[auth] Google authentication error:", err)
			return c.redirect("/login?error=unauthorized")
		}
	})

	app.post("/api/auth/logout", (c) => {
		destroySession(c)
		return c.json({ ok: true })
	})
}
