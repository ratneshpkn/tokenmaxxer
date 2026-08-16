import { type AppUser, appUsers } from "@shared/schema"
import { eq, sql } from "drizzle-orm"
import { db } from "../db"

import { invalidateConfigCache } from "../lib/config"

export async function hashPassword(plain: string): Promise<string> {
	return Bun.password.hash(plain, {
		algorithm: "bcrypt",
		cost: 12,
	})
}

export async function verifyPassword(
	user: { passwordHash: string | null },
	plain: string,
): Promise<boolean> {
	if (!user.passwordHash) return false // Google-only user has no password
	return Bun.password.verify(plain, user.passwordHash)
}

/**
 * Atomic admin claim: the first user created when the app_users table is empty
 * wins the bootstrap admin role. Subsequent concurrent signups become 'viewer'.
 */
export async function createUserAndMaybeClaimAdmin(
	email: string,
	passwordHash: string,
	name: string | null = null,
): Promise<AppUser> {
	return db.transaction(async (tx) => {
		const [userCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(appUsers)
		const isFirstUser = (userCount?.count ?? 0) === 0

		const [user] = await tx
			.insert(appUsers)
			.values({
				email: email.toLowerCase(),
				name,
				role: isFirstUser ? "admin" : "viewer",
				passwordHash,
				lastLoginAt: new Date(),
			})
			.returning()
		if (!user) throw new Error("user insert returned no row")

		if (isFirstUser) {
			await tx.execute(sql`
				update app_config
				   set bootstrap_admin_user_id = ${user.id}
				 where id = 1
				   and bootstrap_admin_user_id is null
			`)
			invalidateConfigCache()
		}

		return user
	})
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
	const [u] = await db
		.select()
		.from(appUsers)
		.where(eq(appUsers.email, email.toLowerCase()))
		.limit(1)
	return u ?? null
}

export async function setPassword(userId: string, plain: string): Promise<void> {
	const hash = await hashPassword(plain)
	await db.update(appUsers).set({ passwordHash: hash }).where(eq(appUsers.id, userId))
}
