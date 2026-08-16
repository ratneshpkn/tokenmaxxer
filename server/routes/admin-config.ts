import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { requireAdmin } from "../auth/session"
import { loadConfig, parseAllowedDomains, saveConfig } from "../lib/config"

const updateAdminConfigSchema = z.object({
	orgName: z.string().min(1).max(100).optional(),
	allowedEmailDomain: z.string().nullable().optional(),
	openSignupEnabled: z.boolean().optional(),
	googleOauthEnabled: z.boolean().optional(),
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
		return c.json({
			orgName: cfg.orgName,
			allowedEmailDomain: cfg.allowedEmailDomain,
			allowedEmailDomains: parseAllowedDomains(cfg.allowedEmailDomain),
			openSignupEnabled: cfg.openSignupEnabled,
			googleOauthEnabled: cfg.googleOauthEnabled,
			googleClientId: cfg.googleClientId,
			googleOauthRedirectUri: cfg.googleOauthRedirectUri,
			slackChannelId: cfg.slackChannelId,
			anthropicAdminApiKeySet: cfg.anthropicAdminApiKey != null && cfg.anthropicAdminApiKey !== "",
			cursorAdminApiKeySet: cfg.cursorAdminApiKey != null && cfg.cursorAdminApiKey !== "",
			slackBotTokenSet: cfg.slackBotToken != null && cfg.slackBotToken !== "",
			googleClientSecretSet: cfg.googleClientSecret != null && cfg.googleClientSecret !== "",
			githubOrg: cfg.githubOrg,
			githubAccessTokenSet: cfg.githubAccessToken != null && cfg.githubAccessToken !== "",
			spendVisibility: cfg.spendVisibility,
			enrichmentProvider: cfg.enrichmentProvider,
			enrichmentApiKeySet: cfg.enrichmentApiKey != null && cfg.enrichmentApiKey !== "",
			enrichmentModelName: cfg.enrichmentModelName,
			enrichmentBaseUrl: cfg.enrichmentBaseUrl,
		})
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

		const data = parse.data
		const patch: Parameters<typeof saveConfig>[0] = {
			orgName: data.orgName,
			allowedEmailDomain: data.allowedEmailDomain,
			openSignupEnabled: data.openSignupEnabled,
			googleOauthEnabled: data.googleOauthEnabled,
			googleClientId: data.googleClientId,
			googleOauthRedirectUri: data.googleOauthRedirectUri,
			slackChannelId: data.slackChannelId,
			githubOrg: data.githubOrg,
			spendVisibility: data.spendVisibility,
			enrichmentProvider: data.enrichmentProvider,
			enrichmentModelName: data.enrichmentModelName,
			enrichmentBaseUrl: data.enrichmentBaseUrl,
		}

		if (data.googleClientSecret !== undefined) {
			patch.googleClientSecret = data.googleClientSecret === "" ? null : data.googleClientSecret
		}
		if (data.anthropicAdminApiKey !== undefined) {
			patch.anthropicAdminApiKey =
				data.anthropicAdminApiKey === "" ? null : data.anthropicAdminApiKey
		}
		if (data.cursorAdminApiKey !== undefined) {
			patch.cursorAdminApiKey = data.cursorAdminApiKey === "" ? null : data.cursorAdminApiKey
		}
		if (data.slackBotToken !== undefined) {
			patch.slackBotToken = data.slackBotToken === "" ? null : data.slackBotToken
		}
		if (data.githubAccessToken !== undefined) {
			patch.githubAccessToken = data.githubAccessToken === "" ? null : data.githubAccessToken
		}
		if (data.enrichmentApiKey !== undefined) {
			patch.enrichmentApiKey = data.enrichmentApiKey === "" ? null : data.enrichmentApiKey
		}

		await saveConfig(patch)
		return c.json({ ok: true })
	})
}
