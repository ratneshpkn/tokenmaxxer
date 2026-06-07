import { appConfig } from "@shared/schema"
import { eq } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"

async function main() {
	const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1)
	console.log("Raw Database Row:")
	console.log(JSON.stringify(row, null, 2))

	try {
		const resolved = await loadConfig()
		console.log("\nDecrypted resolved config loaded successfully:")
		console.log(
			JSON.stringify(
				{
					orgName: resolved.orgName,
					allowedEmailDomain: resolved.allowedEmailDomain,
					openSignupEnabled: resolved.openSignupEnabled,
					googleOauthEnabled: resolved.googleOauthEnabled,
					googleClientId: resolved.googleClientId,
					googleOauthRedirectUri: resolved.googleOauthRedirectUri,
					slackChannelId: resolved.slackChannelId,
					anthropicAdminApiKeySet:
						resolved.anthropicAdminApiKey != null && resolved.anthropicAdminApiKey !== "",
					cursorAdminApiKeySet:
						resolved.cursorAdminApiKey != null && resolved.cursorAdminApiKey !== "",
					slackBotTokenSet: resolved.slackBotToken != null && resolved.slackBotToken !== "",
					googleClientSecretSet:
						resolved.googleClientSecret != null && resolved.googleClientSecret !== "",
				},
				null,
				2,
			),
		)
	} catch (err) {
		console.error("\nDecrypted config loading failed:", err)
	}
}

main()
	.then(() => pool.end())
	.catch((err) => {
		console.error(err)
		pool.end()
	})
