import { appUsers } from "@shared/schema"
import { eq, sql } from "drizzle-orm"
import type { Hono } from "hono"
import type { AppEnv } from "../auth/session"
import { isAuthenticated, requireAdmin } from "../auth/session"
import { db } from "../db"
import { currentUser } from "./index"

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

		const [targetUser] = await db
			.select({ id: appUsers.id, role: appUsers.role })
			.from(appUsers)
			.where(eq(appUsers.id, id))

		if (!targetUser) {
			return c.json({ message: "User not found" }, 404)
		}

		const current = currentUser(c)
		if (current?.id === id && role !== "admin") {
			return c.json({ message: "You cannot demote your own account" }, 400)
		}

		if (role !== "admin" && targetUser.role === "admin") {
			const [adminCount] = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(appUsers)
				.where(eq(appUsers.role, "admin"))

			if ((adminCount?.count ?? 0) <= 1) {
				return c.json({ message: "Cannot demote the last remaining admin" }, 400)
			}
		}

		await db.update(appUsers).set({ role }).where(eq(appUsers.id, id))

		return c.json({ ok: true })
	})
}
