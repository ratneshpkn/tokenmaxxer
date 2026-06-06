import { DEFAULTS } from "@shared/defaults"
import { appConfig } from "@shared/schema"
import { eq } from "drizzle-orm"
import { db, pool } from "../db"
import { encrypt, getMasterKey } from "../lib/crypto"

/**
 * Idempotent: runs on every container start.
 *
 *   1. Ensure the `app_config` singleton row exists (id=1) with default thresholds.
 *   2. Auto-import any process.env values into `app_config` so operators who'd
 *      rather hand-edit a `.env` than click through the setup wizard can do so.
 *      Only fills empty columns — never overwrites a value already in the DB.
 *
 * The bootstrap admin user is NOT created here. The first user to sign up
 * becomes admin (atomic claim via createUserAndMaybeClaimAdmin).
 */
async function main(): Promise<void> {
	// Ensure the encryption key is validated and cached at startup
	getMasterKey()

	await db
		.insert(appConfig)
		.values({
			id: 1,
			claudeCodeDailyThresholdCents: DEFAULTS.thresholds.claude_code_daily_cents,
			cursorDailyThresholdCents: DEFAULTS.thresholds.cursor_daily_cents,
		})
		.onConflictDoNothing({ target: appConfig.id })

	const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1)
	if (!row) throw new Error("[bootstrap-config] app_config singleton missing after insert")

	const updates: Record<string, unknown> = {}

	function importPlain(envVar: string, columnName: string, currentValue: unknown): void {
		const v = process.env[envVar]?.trim()
		if (v && (currentValue == null || currentValue === "")) {
			updates[columnName] = v
		}
	}
	function importSecret(envVar: string, columnName: string, currentValue: unknown): void {
		const v = process.env[envVar]?.trim()
		if (v && (currentValue == null || currentValue === "")) {
			updates[columnName] = encrypt(v)
		}
	}

	importSecret("ANTHROPIC_ADMIN_API_KEY", "anthropicAdminApiKeyEnc", row.anthropicAdminApiKeyEnc)
	importSecret("CURSOR_ADMIN_API_KEY", "cursorAdminApiKeyEnc", row.cursorAdminApiKeyEnc)
	importSecret("SLACK_BOT_TOKEN", "slackBotTokenEnc", row.slackBotTokenEnc)
	importPlain("SLACK_CHANNEL_ID", "slackChannelId", row.slackChannelId)
	importPlain("GOOGLE_CLIENT_ID", "googleClientId", row.googleClientId)
	importSecret("GOOGLE_CLIENT_SECRET", "googleClientSecretEnc", row.googleClientSecretEnc)
	importPlain("GOOGLE_OAUTH_REDIRECT_URI", "googleOauthRedirectUri", row.googleOauthRedirectUri)
	importPlain("ALLOWED_EMAIL_DOMAIN", "allowedEmailDomain", row.allowedEmailDomain)

	if (process.env.GOOGLE_CLIENT_ID && !row.googleOauthEnabled) {
		updates.googleOauthEnabled = true
	}

	if (Object.keys(updates).length > 0) {
		await db
			.update(appConfig)
			.set({ ...updates, updatedAt: new Date() })
			.where(eq(appConfig.id, 1))
		console.log(
			`[bootstrap-config] imported ${Object.keys(updates).length} env value(s) into app_config`,
		)
	} else {
		console.log("[bootstrap-config] app_config singleton ready")
	}
}

if (import.meta.main) {
	main()
		.then(() => pool.end())
		.catch((err) => {
			console.error("[bootstrap-config] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
