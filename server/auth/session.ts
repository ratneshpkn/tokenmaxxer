import { type AppUser, appUsers } from "@shared/schema"
import { eq } from "drizzle-orm"
import type { Context, Env } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"
import { sign, verify } from "hono/jwt"
import { db } from "../db"

export interface AppEnv extends Env {
	Variables: {
		user?: AppUser
	}
}

let sessionSecret: string | null = null

export async function getSessionSecret(): Promise<string> {
	if (sessionSecret) return sessionSecret
	if (process.env.SESSION_SECRET) {
		sessionSecret = process.env.SESSION_SECRET
		return sessionSecret
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error(
			"CRITICAL: SESSION_SECRET must be set in production. " +
				"Provide a secure random string in your environment.",
		)
	}

	// Fallback for local development/testing only
	console.warn(
		"[auth] ⚠️  WARNING: SESSION_SECRET is unset. Using insecure development fallback secret.",
	)
	sessionSecret = "dev-session-secret-insecure-fallback-value"
	return sessionSecret
}

const COOKIE_NAME = "tm.sid"
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
	const secret = await getSessionSecret()
	const payload = {
		id: userId,
		exp: Math.floor(Date.now() / 1000) + ONE_WEEK_SECONDS,
	}
	const token = await sign(payload, secret)
	setCookie(c, COOKIE_NAME, token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "Lax",
		path: "/",
		maxAge: ONE_WEEK_SECONDS,
	})
}

export function destroySession(c: Context<AppEnv>): void {
	deleteCookie(c, COOKIE_NAME, {
		path: "/",
		secure: process.env.NODE_ENV === "production",
		sameSite: "Lax",
	})
}

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
	const token = getCookie(c, COOKIE_NAME)
	if (!token) {
		return await next()
	}
	try {
		const secret = await getSessionSecret()
		const payload = await verify(token, secret, "HS256")
		if (payload?.id) {
			const [user] = await db
				.select()
				.from(appUsers)
				.where(eq(appUsers.id, payload.id as string))
				.limit(1)
			if (user) {
				c.set("user", user)
			}
		}
	} catch (_err) {
		// Invalid/expired token — clear it
		destroySession(c)
	}
	await next()
})

export const isAuthenticated = createMiddleware<AppEnv>(async (c, next) => {
	const user = c.get("user")
	if (!user) {
		return c.json({ message: "Unauthorized" }, 401)
	}
	await next()
})

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
	const user = c.get("user")
	if (!user) {
		return c.json({ message: "Unauthorized" }, 401)
	}
	if (user.role !== "admin") {
		return c.json({ message: "Forbidden" }, 403)
	}
	await next()
})
