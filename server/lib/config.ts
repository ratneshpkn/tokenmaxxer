import { appConfig } from "@shared/schema"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { decrypt, encrypt } from "./crypto"

/** Decrypted, app-friendly view of `app_config`. Secrets are plaintext here; never log this. */
export interface ResolvedConfig {
	id: 1
	orgName: string
	allowedEmailDomain: string | null
	openSignupEnabled: boolean
	googleOauthEnabled: boolean
	googleClientId: string | null
	googleClientSecret: string | null // decrypted
	googleOauthRedirectUri: string | null
	anthropicAdminApiKey: string | null // decrypted
	cursorAdminApiKey: string | null // decrypted
	slackBotToken: string | null // decrypted
	slackChannelId: string | null
	claudeCodeDailyThresholdCents: number
	cursorDailyThresholdCents: number
	bootstrapAdminUserId: string | null
	setupCompletedAt: Date | null
	claudeCodeWorkspaceId: string | null
	githubAccessToken: string | null // decrypted
	githubOrg: string | null
	spendVisibility: "admin_only" | "viewer_own" | "viewer_all"
	enrichmentProvider: "anthropic" | "openai" | "openai_compatible" | null
	enrichmentApiKey: string | null // decrypted
	enrichmentModelName: string | null
	enrichmentBaseUrl: string | null
}

/** Mutable fields accepted by saveConfig. Secrets are plaintext on input. */
export interface ConfigPatch {
	orgName?: string
	allowedEmailDomain?: string | null
	openSignupEnabled?: boolean
	googleOauthEnabled?: boolean
	googleClientId?: string | null
	googleClientSecret?: string | null
	googleOauthRedirectUri?: string | null
	anthropicAdminApiKey?: string | null
	cursorAdminApiKey?: string | null
	slackBotToken?: string | null
	slackChannelId?: string | null
	claudeCodeDailyThresholdCents?: number
	cursorDailyThresholdCents?: number
	bootstrapAdminUserId?: string | null
	setupCompletedAt?: Date | null
	githubAccessToken?: string | null
	githubOrg?: string | null
	spendVisibility?: "admin_only" | "viewer_own" | "viewer_all"
	enrichmentProvider?: "anthropic" | "openai" | "openai_compatible" | null
	enrichmentApiKey?: string | null
	enrichmentModelName?: string | null
	enrichmentBaseUrl?: string | null
}

function decryptOrThrow(v: string | null, columnName: string): string | null {
	if (v == null || v === "") return null
	try {
		return decrypt(v)
	} catch (_err) {
		throw new Error(
			`CRITICAL: Decryption failed for column ${columnName}. Master key mismatch or missing.`,
		)
	}
}
function encryptOrNull(v: string | null | undefined): string | null | undefined {
	if (v === undefined) return undefined
	return v === null ? null : encrypt(v)
}

let cached: ResolvedConfig | null = null

/** Force the next loadConfig() to hit the DB. Call after saveConfig in long-lived processes. */
export function invalidateConfigCache(): void {
	cached = null
}

export async function loadConfig(): Promise<ResolvedConfig> {
	if (cached) return cached
	const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1)
	if (!row) {
		throw new Error("app_config singleton row missing — run db:migrate then bootstrap")
	}
	const googleClientSecret = decryptOrThrow(row.googleClientSecretEnc, "googleClientSecretEnc")
	const anthropicAdminApiKey = decryptOrThrow(
		row.anthropicAdminApiKeyEnc,
		"anthropicAdminApiKeyEnc",
	)
	const cursorAdminApiKey = decryptOrThrow(row.cursorAdminApiKeyEnc, "cursorAdminApiKeyEnc")
	const slackBotToken = decryptOrThrow(row.slackBotTokenEnc, "slackBotTokenEnc")
	const githubAccessToken = decryptOrThrow(row.githubAccessTokenEnc, "githubAccessTokenEnc")
	const enrichmentApiKey = decryptOrThrow(row.enrichmentApiKeyEnc, "enrichmentApiKeyEnc")

	cached = {
		id: 1,
		orgName: row.orgName,
		allowedEmailDomain: row.allowedEmailDomain,
		openSignupEnabled: row.openSignupEnabled,
		googleOauthEnabled: row.googleOauthEnabled,
		googleClientId: row.googleClientId,
		googleClientSecret,
		googleOauthRedirectUri: row.googleOauthRedirectUri,
		anthropicAdminApiKey,
		cursorAdminApiKey,
		slackBotToken,
		slackChannelId: row.slackChannelId,
		claudeCodeDailyThresholdCents: row.claudeCodeDailyThresholdCents,
		cursorDailyThresholdCents: row.cursorDailyThresholdCents,
		bootstrapAdminUserId: row.bootstrapAdminUserId,
		setupCompletedAt: row.setupCompletedAt,
		claudeCodeWorkspaceId: row.claudeCodeWorkspaceId,
		githubAccessToken,
		githubOrg: row.githubOrg,
		spendVisibility: row.spendVisibility,
		enrichmentProvider:
			(row.enrichmentProvider as "anthropic" | "openai" | "openai_compatible" | null) ?? null,
		enrichmentApiKey,
		enrichmentModelName: row.enrichmentModelName,
		enrichmentBaseUrl: row.enrichmentBaseUrl,
	}
	return cached
}

export async function saveConfig(patch: ConfigPatch): Promise<ResolvedConfig> {
	const update: Record<string, unknown> = { updatedAt: new Date() }

	if (patch.orgName !== undefined) update.orgName = patch.orgName
	if (patch.allowedEmailDomain !== undefined) update.allowedEmailDomain = patch.allowedEmailDomain
	if (patch.openSignupEnabled !== undefined) update.openSignupEnabled = patch.openSignupEnabled
	if (patch.googleOauthEnabled !== undefined) update.googleOauthEnabled = patch.googleOauthEnabled
	if (patch.googleClientId !== undefined) update.googleClientId = patch.googleClientId
	if (patch.googleClientSecret !== undefined)
		update.googleClientSecretEnc = encryptOrNull(patch.googleClientSecret)
	if (patch.googleOauthRedirectUri !== undefined)
		update.googleOauthRedirectUri = patch.googleOauthRedirectUri
	if (patch.anthropicAdminApiKey !== undefined)
		update.anthropicAdminApiKeyEnc = encryptOrNull(patch.anthropicAdminApiKey)
	if (patch.cursorAdminApiKey !== undefined)
		update.cursorAdminApiKeyEnc = encryptOrNull(patch.cursorAdminApiKey)
	if (patch.slackBotToken !== undefined)
		update.slackBotTokenEnc = encryptOrNull(patch.slackBotToken)
	if (patch.slackChannelId !== undefined) update.slackChannelId = patch.slackChannelId
	if (patch.claudeCodeDailyThresholdCents !== undefined)
		update.claudeCodeDailyThresholdCents = patch.claudeCodeDailyThresholdCents
	if (patch.cursorDailyThresholdCents !== undefined)
		update.cursorDailyThresholdCents = patch.cursorDailyThresholdCents
	if (patch.bootstrapAdminUserId !== undefined)
		update.bootstrapAdminUserId = patch.bootstrapAdminUserId
	if (patch.setupCompletedAt !== undefined) update.setupCompletedAt = patch.setupCompletedAt
	if (patch.githubAccessToken !== undefined)
		update.githubAccessTokenEnc = encryptOrNull(patch.githubAccessToken)
	if (patch.githubOrg !== undefined) update.githubOrg = patch.githubOrg
	if (patch.spendVisibility !== undefined) update.spendVisibility = patch.spendVisibility
	if (patch.enrichmentProvider !== undefined) update.enrichmentProvider = patch.enrichmentProvider
	if (patch.enrichmentApiKey !== undefined)
		update.enrichmentApiKeyEnc = encryptOrNull(patch.enrichmentApiKey)
	if (patch.enrichmentModelName !== undefined)
		update.enrichmentModelName = patch.enrichmentModelName
	if (patch.enrichmentBaseUrl !== undefined) update.enrichmentBaseUrl = patch.enrichmentBaseUrl

	await db.update(appConfig).set(update).where(eq(appConfig.id, 1))
	invalidateConfigCache()
	return loadConfig()
}
