import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { requireAdmin } from "../auth/session"
import {
	loadConfig,
	normalizeAdminConfigPatch,
	saveConfig,
	toAdminConfigResponse,
	validateAuthLockout,
} from "../lib/config"

const updateAdminConfigSchema = z.object({
	orgName: z.string().min(1).max(100).optional(),
	allowedEmailDomain: z.string().nullable().optional(),
	openSignupEnabled: z.boolean().optional(),
	googleOauthEnabled: z.boolean().optional(),
	passwordAuthDisabled: z.boolean().optional(),
	googleClientId: z.string().nullable().optional(),
	googleClientSecret: z.string().nullable().optional(),
	googleOauthRedirectUri: z.string().nullable().optional(),
	anthropicAdminApiKey: z.string().nullable().optional(),
	cursorAdminApiKey: z.string().nullable().optional(),
	slackBotToken: z.string().nullable().optional(),
	slackChannelId: z.string().nullable().optional(),
	githubAccessToken: z.string().nullable().optional(),
	githubOrg: z.string().nullable().optional(),
	spendVisibility: z.enum(["admin_only", "viewer_own", "viewer_all"]).optional(),
	enrichmentProvider: z.enum(["anthropic", "openai", "openai_compatible"]).nullable().optional(),
	enrichmentApiKey: z.string().nullable().optional(),
	enrichmentModelName: z.string().nullable().optional(),
	enrichmentBaseUrl: z.string().nullable().optional(),
})

export function registerAdminConfigRoutes(app: Hono<AppEnv>): void {
	app.get("/api/admin/config", requireAdmin, async (c) => {
		const cfg = await loadConfig()
		return c.json(toAdminConfigResponse(cfg))
	})

	app.put("/api/admin/config", requireAdmin, async (c) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ message: "Invalid JSON body" }, 400)
		}

		const parse = updateAdminConfigSchema.safeParse(body)
		if (!parse.success) {
			return c.json({ issues: parse.error.issues }, 400)
		}

		const cfg = await loadConfig()
		const patch = normalizeAdminConfigPatch(parse.data)
		const lockoutError = validateAuthLockout(cfg, patch)
		if (lockoutError) {
			return c.json({ message: lockoutError }, 400)
		}

		await saveConfig(patch)
		return c.json({ ok: true })
	})
}
