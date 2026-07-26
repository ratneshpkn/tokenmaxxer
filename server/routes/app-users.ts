import { appUsers } from "@shared/schema"
import { eq } from "drizzle-orm"
import type { Hono } from "hono"
import type { AppEnv } from "../auth/session"
import { isAuthenticated, requireAdmin } from "../auth/session"
import { db } from "../db"

export function registerAppUserRoutes(app: Hono<AppEnv>): void {
	app.get("/api/app-users", isAuthenticated, async (c) => {
		const users = await db
			.select({
				id: appUsers.id,
				email: appUsers.email,
				name: appUsers.name,
				role: appUsers.role,
				createdAt: appUsers.createdAt,
				lastLoginAt: appUsers.lastLoginAt,
			})
			.from(appUsers)
			.orderBy(appUsers.createdAt)

		return c.json(users)
	})

	app.patch("/api/app-users/:id/role", isAuthenticated, requireAdmin, async (c) => {
		const id = c.req.param("id")
		const { role } = await c.req.json<{ role: "viewer" | "admin" }>()

		if (role !== "viewer" && role !== "admin") {
			return c.json({ message: "Invalid role" }, 400)
		}

		await db.update(appUsers).set({ role }).where(eq(appUsers.id, id))

		return c.json({ ok: true })
	})
}
