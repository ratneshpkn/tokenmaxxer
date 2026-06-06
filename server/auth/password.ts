import { type AppUser, appUsers } from "@shared/schema"
import { eq, sql } from "drizzle-orm"
import { db } from "../db"

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
 * Atomic admin claim: the first password signup against an empty bootstrap state
 * wins admin. Subsequent concurrent signups become 'viewer'. Implemented via a
 * single UPDATE … WHERE bootstrap_admin_user_id IS NULL RETURNING — only one
 * caller can claim.
 */
export async function createUserAndMaybeClaimAdmin(
	email: string,
	passwordHash: string,
	name: string | null = null,
): Promise<AppUser> {
	return db.transaction(async (tx) => {
		const [user] = await tx
			.insert(appUsers)
			.values({
				email: email.toLowerCase(),
				name,
				role: "viewer", // default; may be promoted below
				passwordHash,
				lastLoginAt: new Date(),
			})
			.returning()
		if (!user) throw new Error("user insert returned no row")

		// Try to claim the admin slot
		const claim = await tx.execute<{ bootstrap_admin_user_id: string }>(sql`
      update app_config
         set bootstrap_admin_user_id = ${user.id}
       where id = 1
         and bootstrap_admin_user_id is null
      returning bootstrap_admin_user_id
    `)

		if (claim.rows.length > 0) {
			// We won — promote
			const [promoted] = await tx
				.update(appUsers)
				.set({ role: "admin" })
				.where(eq(appUsers.id, user.id))
				.returning()
			return promoted ?? user
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
