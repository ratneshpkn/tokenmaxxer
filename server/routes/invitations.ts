import type { Hono } from "hono"
import { z } from "zod"
import { createInvite, deleteInvite, listPendingInvites } from "../auth/invitations"
import type { AppEnv } from "../auth/session"
import { isAuthenticated, requireAdmin } from "../auth/session"
import { currentUser } from "./index"

const createSchema = z.object({
	email: z.string().email(),
	role: z.enum(["viewer", "admin"]),
})

export function registerInvitationRoutes(app: Hono<AppEnv>): void {
	app.get("/api/invitations", isAuthenticated, requireAdmin, async (c) => {
		const rows = await listPendingInvites()
		return c.json(rows)
	})

	app.post("/api/invitations", isAuthenticated, requireAdmin, async (c) => {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ message: "Invalid JSON body" }, 400)
		}
		const parse = createSchema.safeParse(body)
		if (!parse.success) return c.json({ issues: parse.error.issues }, 400)
		const me = currentUser(c)
		if (!me) return c.json({ message: "Unauthorized" }, 401)
		const inv = await createInvite({
			email: parse.data.email,
			role: parse.data.role,
			createdBy: me.id,
		})
		// Build a copy-paste URL from a single trusted config value. The
		// fallback is for dev convenience only — production
		// deployments MUST set BASE_URL so attackers can't forge the link by
		// spoofing Host / X-Forwarded-Host.
		const urlObj = new URL(c.req.url)
		const proto = c.req.header("x-forwarded-proto") || urlObj.protocol.replace(":", "")
		const host = c.req.header("x-forwarded-host") || c.req.header("host") || urlObj.host
		const base = process.env.BASE_URL ?? `${proto}://${host}`
		const url = `${base}/signup?token=${inv.token}`
		return c.json({ invitation: inv, url }, 201)
	})

	app.delete("/api/invitations/:id", isAuthenticated, requireAdmin, async (c) => {
		await deleteInvite(String(c.req.param("id")))
		return c.body(null, 204)
	})
}
