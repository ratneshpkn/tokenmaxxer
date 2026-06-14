import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { isAuthenticated, requireAdmin } from "../auth/session"
import { AnthropicAdminClient } from "../lib/anthropic-admin"
import { loadConfig, saveConfig } from "../lib/config"
import { CursorAdminClient } from "../lib/cursor-admin"
import { GitHubClient } from "../lib/github"
import { slackAuthTest, slackChannelInfo } from "../lib/slack"

const validateSchema = z.object({
	provider: z.enum(["anthropic", "cursor", "slack", "github"]),
	key: z.string().min(1).max(2000),
	channelId: z.string().optional(),
	org: z.string().optional(),
})

const setupSchema = z.object({
	orgName: z.string().min(1).max(100),
	allowedEmailDomain: z.string().nullable().optional(),
	openSignupEnabled: z.boolean().optional(),
	anthropicAdminApiKey: z.string().min(1),
	cursorAdminApiKey: z.string().min(1),
	slackBotToken: z.string().nullable().optional(),
	slackChannelId: z.string().nullable().optional(),
	githubAccessToken: z.string().nullable().optional(),
	githubOrg: z.string().nullable().optional(),
	claudeCodeDailyThresholdCents: z.number().int().nonnegative().optional(),
	cursorDailyThresholdCents: z.number().int().nonnegative().optional(),
})

export function registerSetupRoutes(app: Hono<AppEnv>): void {
	app.get("/api/setup/status", isAuthenticated, async (c) => {
		const cfg = await loadConfig()
		return c.json({ setupCompleted: cfg.setupCompletedAt != null })
	})

	app.post("/api/setup/validate-key", isAuthenticated, requireAdmin, async (c) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ message: "Invalid JSON body" }, 400)
		}
		const parse = validateSchema.safeParse(body)
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const { provider, key, channelId, org } = parse.data

		try {
			if (provider === "anthropic") {
				const client = new AnthropicAdminClient(key)
				// Pull just one batch to validate auth
				for await (const _batch of client.listUsers()) break
				return c.json({ ok: true })
			}
			if (provider === "cursor") {
				const client = new CursorAdminClient(key)
				await client.listMembers()
				return c.json({ ok: true })
			}
			if (provider === "slack") {
				await slackAuthTest(key)
				if (channelId) await slackChannelInfo(key, channelId)
				return c.json({ ok: true })
			}
			if (provider === "github") {
				if (!org) {
					return c.json(
						{ ok: false, error: "Organization name is required to validate GitHub integration" },
						400,
					)
				}
				const client = new GitHubClient(key)
				await client.listOrgRepos(org)
				return c.json({ ok: true })
			}
			return c.json({ ok: false, error: "unknown provider" }, 400)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return c.json({ ok: false, error: message.slice(0, 300) }, 400)
		}
	})

	app.post("/api/setup", isAuthenticated, requireAdmin, async (c) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ message: "Invalid JSON body" }, 400)
		}
		const parse = setupSchema.safeParse(body)
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const p = parse.data

		// First-run only — once setup is completed, refuse further wholesale
		// rewrites of org config. Per-field admin endpoints handle later updates.
		const cfg = await loadConfig()
		if (cfg.setupCompletedAt) {
			return c.json({ message: "Setup already completed" }, 409)
		}

		await saveConfig({
			orgName: p.orgName,
			allowedEmailDomain: p.allowedEmailDomain ?? null,
			openSignupEnabled: p.openSignupEnabled ?? false,
			anthropicAdminApiKey: p.anthropicAdminApiKey,
			cursorAdminApiKey: p.cursorAdminApiKey,
			slackBotToken: p.slackBotToken ?? null,
			slackChannelId: p.slackChannelId ?? null,
			githubAccessToken: p.githubAccessToken ?? null,
			githubOrg: p.githubOrg ?? null,
			claudeCodeDailyThresholdCents: p.claudeCodeDailyThresholdCents ?? 5000,
			cursorDailyThresholdCents: p.cursorDailyThresholdCents ?? 5000,
			setupCompletedAt: new Date(),
		})

		return c.json({ ok: true })
	})
}
