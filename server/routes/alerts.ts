import { alerts } from "@shared/schema"
import { and, eq, sql } from "drizzle-orm"
import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { requireAdmin } from "../auth/session"
import { db } from "../db"

const listQuery = z.object({
	status: z.enum(["open", "acknowledged", "resolved", "all"]).default("open"),
	limit: z.coerce.number().int().min(1).max(200).default(50),
})

export function registerAlertRoutes(app: Hono<AppEnv>): void {
	app.get("/api/alerts/count", requireAdmin, async (c) => {
		const result = await db.execute<{ open: number }>(
			sql`select count(*)::int as open from alerts where status = 'open'`,
		)
		const open = result.rows?.[0]?.open ?? 0
		return c.json({ open })
	})

	app.get("/api/alerts", requireAdmin, async (c) => {
		const parse = listQuery.safeParse(c.req.query())
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const { status, limit } = parse.data

		// Hand-rolled join so we can include tracked_users.name in the response
		const statusFilter = status === "all" ? sql`true` : sql`a.status = ${status}::alert_status`
		const result = await db.execute(sql`
      select a.id, a.date, a.email, a.platform, a.amount_cents as "amountCents",
             a.threshold_cents as "thresholdCents", a.status,
             a.channels_sent as "channelsSent",
             a.created_at as "createdAt", a.acknowledged_at as "acknowledgedAt",
             a.resolved_at as "resolvedAt",
             tu.name as name
        from alerts a
        left join tracked_users tu on tu.email = a.email
       where ${statusFilter}
       order by a.created_at desc
       limit ${limit}
    `)
		return c.json(result.rows ?? [])
	})

	app.post("/api/alerts/:id/acknowledge", requireAdmin, async (c) => {
		const id = String(c.req.param("id"))
		const [updated] = await db
			.update(alerts)
			.set({ status: "acknowledged", acknowledgedAt: new Date() })
			.where(and(eq(alerts.id, id), eq(alerts.status, "open")))
			.returning()
		if (!updated) return c.json({ message: "Alert not found or not open" }, 404)
		return c.json(updated)
	})

	app.post("/api/alerts/:id/resolve", requireAdmin, async (c) => {
		const id = String(c.req.param("id"))
		const [updated] = await db
			.update(alerts)
			.set({ status: "resolved", resolvedAt: new Date() })
			.where(eq(alerts.id, id))
			.returning()
		if (!updated) return c.json({ message: "Alert not found" }, 404)
		return c.json(updated)
	})
}
