import { appUsers } from "@shared/schema"
import { eq } from "drizzle-orm"
import { hashPassword } from "../auth/password"
import { db, pool } from "../db"

async function main(): Promise<void> {
	const [, , email, newPassword] = process.argv
	if (!email || !newPassword) {
		console.error("Usage: bun run server/scripts/reset-admin-password.ts <email> <new-password>")
		process.exit(2)
	}
	if (newPassword.length < 8) {
		console.error("Password must be at least 8 characters")
		process.exit(2)
	}

	const hash = await hashPassword(newPassword)
	const [updated] = await db
		.update(appUsers)
		.set({ passwordHash: hash })
		.where(eq(appUsers.email, email.toLowerCase()))
		.returning({ id: appUsers.id, email: appUsers.email, role: appUsers.role })

	if (!updated) {
		console.error(`No user with email ${email}`)
		process.exit(1)
	}

	console.log(`Password reset for ${updated.email} (role=${updated.role})`)
}

main()
	.then(() => pool.end())
	.catch((err) => {
		console.error(err)
		pool.end()
		process.exit(1)
	})
