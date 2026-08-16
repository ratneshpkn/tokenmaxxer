import { type AppUser, appUsers } from "@shared/schema"
import { eq } from "drizzle-orm"
import type { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { z } from "zod"
import { consumeInvite, findValidInvite } from "../auth/invitations"
import {
	createUserAndMaybeClaimAdmin,
	findUserByEmail,
	hashPassword,
	verifyPassword,
} from "../auth/password"
import type { AppEnv } from "../auth/session"
import { createSession } from "../auth/session"
import { db } from "../db"
import { isEmailDomainAllowed, loadConfig, parseAllowedDomains } from "../lib/config"

// Burned on the no-user path so the login endpoint takes ~the same wall-clock
// time whether the email exists or not. Without this, attackers can enumerate
// valid accounts by timing bcrypt.compare.
const DUMMY_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0u8XwwjOQzs2BiUbVtcOC6sP5Mw7g3ai6"

// Reusable in-memory rate limiter helper for Hono
function createRateLimiter(limit: number, windowMs: number, message: string) {
	const tracker = new Map<string, { count: number; resetAt: number }>()
	return createMiddleware(async (c, next) => {
		const ip = c.req.header("x-forwarded-for") || "anonymous"
		const now = Date.now()
		const record = tracker.get(ip) || { count: 0, resetAt: now + windowMs }

		if (now > record.resetAt) {
			record.count = 0
			record.resetAt = now + windowMs
		}

		record.count++
		tracker.set(ip, record)

		if (record.count > limit) {
			return c.json({ message }, 429)
		}

		await next()
	})
}

// Tight bucket for login — 10 attempts per 15 min per IP.
const loginLimiter = createRateLimiter(
	10,
	15 * 60 * 1000,
	"Too many login attempts. Try again in 15 minutes.",
)

// Looser bucket for signup since legit traffic is rare here, but still
// rate-limited to make invite-token guessing impractical.
const signupLimiter = createRateLimiter(
	20,
	60 * 60 * 1000,
	"Too many signup attempts. Try again in an hour.",
)

const signupSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8).max(200),
	token: z.string().optional(), // invite token
})

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1).max(200),
})

export function registerAuthPasswordRoutes(app: Hono<AppEnv>): void {
	app.post("/api/auth/signup", signupLimiter, async (c) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ message: "Invalid JSON body" }, 400)
		}
		const parse = signupSchema.safeParse(body)
		if (!parse.success) {
			return c.json({ message: "Invalid input", issues: parse.error.issues }, 400)
		}
		const { email, password, token } = parse.data
		const cfg = await loadConfig()

		// Determine eligibility
		const noUsersYet = cfg.bootstrapAdminUserId == null
		let role: "viewer" | "admin" = "viewer"
		let inviteRow = null as Awaited<ReturnType<typeof findValidInvite>> | null

		const allowedDomains = parseAllowedDomains(cfg.allowedEmailDomain)

		if (noUsersYet) {
			// First user ever — bootstrap admin path
			role = "admin"
		} else if (token) {
			inviteRow = await findValidInvite(token)
			if (!inviteRow || inviteRow.email.toLowerCase() !== email.toLowerCase()) {
				return c.json({ message: "Invalid or expired invite" }, 403)
			}
			role = inviteRow.role
		} else if (cfg.openSignupEnabled && allowedDomains.length > 0) {
			if (!isEmailDomainAllowed(email, allowedDomains)) {
				return c.json(
					{
						message: `Self-signup restricted to @${allowedDomains.join(", @")} addresses`,
					},
					403,
				)
			}
			role = "viewer"
		} else {
			return c.json({ message: "Signups are invite-only" }, 403)
		}

		// Reject duplicate email
		const existing = await findUserByEmail(email)
		if (existing) {
			return c.json({ message: "Email already registered" }, 409)
		}

		const hash = await hashPassword(password)

		let user: AppUser
		if (role === "admin" && noUsersYet) {
			// Atomic claim path
			user = await createUserAndMaybeClaimAdmin(email, hash)
		} else {
			const [created] = await db
				.insert(appUsers)
				.values({
					email: email.toLowerCase(),
					role,
					passwordHash: hash,
					lastLoginAt: new Date(),
				})
				.returning()
			if (!created) return c.json({ message: "Insert failed" }, 500)
			user = created
			if (inviteRow && token) await consumeInvite(token, user.id)
		}

		await createSession(c, user.id)
		return c.json({ id: user.id, email: user.email, role: user.role })
	})

	app.post("/api/auth/login", loginLimiter, async (c) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ message: "Invalid JSON body" }, 400)
		}
		const parse = loginSchema.safeParse(body)
		if (!parse.success) {
			return c.json({ message: "Invalid input" }, 400)
		}
		const { email, password } = parse.data
		const user = await findUserByEmail(email)
		if (!user) {
			// Burn equivalent bcrypt cycles so timing doesn't reveal user existence.
			await Bun.password.verify(password, DUMMY_HASH)
			return c.json({ message: "Invalid credentials" }, 401)
		}
		const ok = await verifyPassword(user, password)
		if (!ok) return c.json({ message: "Invalid credentials" }, 401)
		await db.update(appUsers).set({ lastLoginAt: new Date() }).where(eq(appUsers.id, user.id))
		await createSession(c, user.id)
		return c.json({ id: user.id, email: user.email, role: user.role })
	})
}
