import { type AppUser, appUsers } from "@shared/schema"
import { sql } from "drizzle-orm"
import type { Context, Hono } from "hono"
import type { AppEnv } from "../auth/session"
import { isAuthenticated } from "../auth/session"
import { db } from "../db"
import { loadConfig, parseAllowedDomains } from "../lib/config"
import { registerAdminConfigRoutes } from "./admin-config"
import { registerAlertRoutes } from "./alerts"
import { registerAppUserRoutes } from "./app-users"
import { registerAuthPasswordRoutes } from "./auth-password"
import { registerDashboardRoutes } from "./dashboard"
import { registerInvitationRoutes } from "./invitations"
import { registerModelRoutes } from "./models"
import { registerSetupRoutes } from "./setup"
import { registerSyncRoutes } from "./sync"
import { registerTeamRoutes } from "./teams"
import { registerThresholdRoutes } from "./thresholds"
import { registerUserRoutes } from "./users"

export function currentUser(c: Context<AppEnv>): AppUser | null {
	return c.get("user") ?? null
}

export function currentRole(c: Context<AppEnv>): "admin" | "viewer" | null {
	const u = currentUser(c)
	return u?.role ?? null
}

export async function registerRoutes(app: Hono<AppEnv>): Promise<void> {
	// Public config — readable without auth so the login page can show the
	// expected email domain instead of a hardcoded one.
	app.get("/api/config", async (c) => {
		const cfg = await loadConfig()
		const [userCountRow] = await db.select({ count: sql<number>`count(*)::int` }).from(appUsers)
		const bootstrapNeeded = (userCountRow?.count ?? 0) === 0

		return c.json({
			allowedEmailDomain: cfg.allowedEmailDomain ?? "",
			allowedEmailDomains: parseAllowedDomains(cfg.allowedEmailDomain),
			orgName: cfg.orgName,
			googleOauthEnabled: cfg.googleOauthEnabled,
			passwordAuthDisabled: cfg.passwordAuthDisabled,
			openSignupEnabled: cfg.openSignupEnabled,
			setupCompleted: cfg.setupCompletedAt != null,
			bootstrapNeeded,
			spendVisibility: cfg.spendVisibility,
		})
	})

	// Current user
	app.get("/api/auth/me", isAuthenticated, (c) => {
		const user = currentUser(c)
		if (!user) return c.json({ message: "Unauthorized" }, 401)
		return c.json({
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
		})
	})

	registerAuthPasswordRoutes(app)
	registerUserRoutes(app)
	registerDashboardRoutes(app)
	registerTeamRoutes(app)
	registerAlertRoutes(app)
	registerThresholdRoutes(app)
	registerSyncRoutes(app)
	registerInvitationRoutes(app)
	registerSetupRoutes(app)
	registerAdminConfigRoutes(app)
	registerModelRoutes(app)
	registerAppUserRoutes(app)
}
