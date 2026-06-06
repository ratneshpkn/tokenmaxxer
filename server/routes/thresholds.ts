import {
	alertThresholds,
	updateGlobalThresholdSchema,
	updateUserThresholdSchema,
} from "@shared/schema"
import { and, eq } from "drizzle-orm"
import type { Hono } from "hono"
import type { AppEnv } from "../auth/session"
import { requireAdmin } from "../auth/session"
import { db } from "../db"
import { loadConfig, saveConfig } from "../lib/config"

export function registerThresholdRoutes(app: Hono<AppEnv>): void {
	app.get("/api/thresholds", requireAdmin, async (c) => {
		const cfg = await loadConfig()
		const perUser = await db.select().from(alertThresholds).where(eq(alertThresholds.scope, "user"))
		return c.json({
			global: {
				claude_code: cfg.claudeCodeDailyThresholdCents,
				cursor: cfg.cursorDailyThresholdCents,
			},
			perUser,
		})
	})

	app.put("/api/thresholds/global", requireAdmin, async (c) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ message: "Invalid JSON body" }, 400)
		}
		const parse = updateGlobalThresholdSchema.safeParse(body)
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const { platform, dailyCents } = parse.data
		if (platform === "claude_code") {
			await saveConfig({ claudeCodeDailyThresholdCents: dailyCents })
		} else {
			await saveConfig({ cursorDailyThresholdCents: dailyCents })
		}
		return c.json({ ok: true, platform, dailyCents })
	})

	app.put("/api/thresholds/user/:email", requireAdmin, async (c) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ message: "Invalid JSON body" }, 400)
		}
		const parse = updateUserThresholdSchema.safeParse(body)
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const { platform, dailyCents, enabled } = parse.data
		const email = String(c.req.param("email")).toLowerCase()

		const existing = await db
			.select()
			.from(alertThresholds)
			.where(
				and(
					eq(alertThresholds.scope, "user"),
					eq(alertThresholds.platform, platform),
					eq(alertThresholds.email, email),
				),
			)
			.limit(1)

		if (existing.length > 0) {
			const [updated] = await db
				.update(alertThresholds)
				.set({ dailyCents, enabled, updatedAt: new Date() })
				.where(eq(alertThresholds.id, existing[0].id))
				.returning()
			return c.json(updated)
		}
		const [inserted] = await db
			.insert(alertThresholds)
			.values({ scope: "user", platform, dailyCents, enabled, email })
			.returning()
		return c.json(inserted, 201)
	})

	app.delete("/api/thresholds/user/:email/:platform", requireAdmin, async (c) => {
		const email = String(c.req.param("email")).toLowerCase()
		const platform = String(c.req.param("platform")) as "claude_code" | "cursor"
		if (platform !== "claude_code" && platform !== "cursor") {
			return c.json({ message: "Invalid platform" }, 400)
		}
		await db
			.delete(alertThresholds)
			.where(
				and(
					eq(alertThresholds.scope, "user"),
					eq(alertThresholds.platform, platform),
					eq(alertThresholds.email, email),
				),
			)
		return c.body(null, 204)
	})
}
