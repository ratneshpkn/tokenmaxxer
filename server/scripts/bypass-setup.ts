import { appConfig, appUsers } from "@shared/schema"
import { eq } from "drizzle-orm"
import { hashPassword } from "../auth/password"
import { db, pool } from "../db"
import { encrypt } from "../lib/crypto"

async function main() {
	console.log("[bypass-setup] starting database setup bypass...")

	// 1. Create the admin user
	const email = "admin@example.com"
	const password = "admin123456"

	// Wipe any existing admin first to be fully idempotent
	await db.delete(appUsers).where(eq(appUsers.email, email))

	const hash = await hashPassword(password)
	const [user] = await db
		.insert(appUsers)
		.values({
			email,
			name: "Admin User",
			role: "admin",
			passwordHash: hash,
			lastLoginAt: new Date(),
		})
		.returning()

	if (!user) throw new Error("Failed to insert admin user")
	console.log(`[bypass-setup] created admin user: ${email} (${user.id})`)

	// 2. Configure appConfig singleton
	const encryptedAnthropicKey = encrypt(
		"sk-ant-admin-demo-key-1234567890abcdefghijklmnopqrstuvwxyz",
	)
	const encryptedCursorKey = encrypt("key_demo_cursor_api_key_1234567890abcdefghijklmnopqrstuvwxyz")

	await db
		.update(appConfig)
		.set({
			orgName: "Demo Corporation",
			allowedEmailDomain: "example.com",
			openSignupEnabled: true,
			bootstrapAdminUserId: user.id,
			setupCompletedAt: new Date(),
			anthropicAdminApiKeyEnc: encryptedAnthropicKey,
			cursorAdminApiKeyEnc: encryptedCursorKey,
			updatedAt: new Date(),
		})
		.where(eq(appConfig.id, 1))

	console.log("[bypass-setup] configured appConfig singleton successfully!")
}

if (import.meta.main) {
	main()
		.then(() => pool.end())
		.catch((err) => {
			console.error("[bypass-setup] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
