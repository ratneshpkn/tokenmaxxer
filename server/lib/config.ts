import type { AdminConfigPatch, AdminConfigResponse } from "@shared/api-types"
import { type AppConfig, appConfig } from "@shared/schema"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { decrypt, encrypt } from "./crypto"

export const ENRICHMENT_PROVIDERS = ["anthropic", "openai", "openai_compatible"] as const
export type EnrichmentProvider = (typeof ENRICHMENT_PROVIDERS)[number]
export type SpendVisibility = "admin_only" | "viewer_own" | "viewer_all"

/** Decrypted, app-friendly view of `app_config`. Secrets are plaintext here; never log this. */
export interface ResolvedConfig {
	id: 1
	orgName: string
	allowedEmailDomain: string | null
	openSignupEnabled: boolean
	googleOauthEnabled: boolean
	passwordAuthDisabled: boolean
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
	spendVisibility: SpendVisibility
	enrichmentProvider: EnrichmentProvider | null
	enrichmentApiKey: string | null // decrypted
	enrichmentModelName: string | null
	enrichmentBaseUrl: string | null
}

/** Mutable fields accepted by saveConfig. Secrets are plaintext on input. */
export type ConfigPatch = Partial<Omit<ResolvedConfig, "id" | "claudeCodeWorkspaceId">>

/** Single registry for all encrypted `app_config` secret fields.
 *  Drives decryption, encryption, response masking, empty-string clearing, and env bootstrap. */
export const SECRET_CONFIG_FIELDS = [
	{
		prop: "googleClientSecret",
		column: "googleClientSecretEnc",
		setFlag: "googleClientSecretSet",
		envVar: "GOOGLE_CLIENT_SECRET",
	},
	{
		prop: "anthropicAdminApiKey",
		column: "anthropicAdminApiKeyEnc",
		setFlag: "anthropicAdminApiKeySet",
		envVar: "ANTHROPIC_ADMIN_API_KEY",
	},
	{
		prop: "cursorAdminApiKey",
		column: "cursorAdminApiKeyEnc",
		setFlag: "cursorAdminApiKeySet",
		envVar: "CURSOR_ADMIN_API_KEY",
	},
	{
		prop: "slackBotToken",
		column: "slackBotTokenEnc",
		setFlag: "slackBotTokenSet",
		envVar: "SLACK_BOT_TOKEN",
	},
	{
		prop: "githubAccessToken",
		column: "githubAccessTokenEnc",
		setFlag: "githubAccessTokenSet",
		envVar: "GITHUB_ACCESS_TOKEN",
	},
	{
		prop: "enrichmentApiKey",
		column: "enrichmentApiKeyEnc",
		setFlag: "enrichmentApiKeySet",
		envVar: "ENRICHMENT_API_KEY",
	},
] as const satisfies ReadonlyArray<{
	prop: keyof ResolvedConfig
	column: keyof AppConfig
	setFlag: keyof AdminConfigResponse
	envVar: string
}>

type SecretProp = (typeof SECRET_CONFIG_FIELDS)[number]["prop"]
type SecretSetFlag = (typeof SECRET_CONFIG_FIELDS)[number]["setFlag"]

const PLAIN_CONFIG_KEYS = [
	"orgName",
	"allowedEmailDomain",
	"openSignupEnabled",
	"googleOauthEnabled",
	"passwordAuthDisabled",
	"googleClientId",
	"googleOauthRedirectUri",
	"slackChannelId",
	"claudeCodeDailyThresholdCents",
	"cursorDailyThresholdCents",
	"bootstrapAdminUserId",
	"setupCompletedAt",
	"githubOrg",
	"spendVisibility",
	"enrichmentProvider",
	"enrichmentModelName",
	"enrichmentBaseUrl",
] as const satisfies ReadonlyArray<keyof ConfigPatch & keyof AppConfig>

export const PLAIN_ENV_CONFIG_FIELDS = [
	{ column: "slackChannelId", envVar: "SLACK_CHANNEL_ID" },
	{ column: "googleClientId", envVar: "GOOGLE_CLIENT_ID" },
	{ column: "googleOauthRedirectUri", envVar: "GOOGLE_OAUTH_REDIRECT_URI" },
	{ column: "allowedEmailDomain", envVar: "ALLOWED_EMAIL_DOMAIN" },
	{ column: "githubOrg", envVar: "GITHUB_ORG" },
	{ column: "enrichmentModelName", envVar: "ENRICHMENT_MODEL_NAME" },
	{ column: "enrichmentBaseUrl", envVar: "ENRICHMENT_BASE_URL" },
] as const satisfies ReadonlyArray<{ column: keyof AppConfig; envVar: string }>

/** Parse comma, whitespace, or newline delimited domains into a clean lowercase array. */
export function parseAllowedDomains(domainStr: string | null | undefined): string[] {
	if (!domainStr) return []
	return domainStr
		.split(/[\s,]+/)
		.map((d) => d.trim().replace(/^@/, "").toLowerCase())
		.filter((d) => d.length > 0)
}

/** Check if an email matches the allowed domains. Fail-closed: returns false if allowedDomains is empty or email is invalid. */
export function isEmailDomainAllowed(email: string, allowedDomains: string[]): boolean {
	if (!allowedDomains || allowedDomains.length === 0) return false
	const lowerEmail = email.trim().toLowerCase()
	const parts = lowerEmail.split("@")
	if (parts.length !== 2) return false
	const [local, domain] = parts
	if (!local || !domain) return false
	return allowedDomains.includes(domain)
}

/** Project a resolved config to the secret-masked admin response shape. */
export function toAdminConfigResponse(cfg: ResolvedConfig): AdminConfigResponse {
	const flags: Record<string, boolean> = {}
	for (const f of SECRET_CONFIG_FIELDS) {
		const val = cfg[f.prop]
		flags[f.setFlag] = val != null && val !== ""
	}
	return {
		orgName: cfg.orgName,
		allowedEmailDomain: cfg.allowedEmailDomain,
		allowedEmailDomains: parseAllowedDomains(cfg.allowedEmailDomain),
		openSignupEnabled: cfg.openSignupEnabled,
		googleOauthEnabled: cfg.googleOauthEnabled,
		passwordAuthDisabled: cfg.passwordAuthDisabled,
		googleClientId: cfg.googleClientId,
		googleOauthRedirectUri: cfg.googleOauthRedirectUri,
		slackChannelId: cfg.slackChannelId,
		githubOrg: cfg.githubOrg,
		spendVisibility: cfg.spendVisibility,
		enrichmentProvider: cfg.enrichmentProvider,
		enrichmentModelName: cfg.enrichmentModelName,
		enrichmentBaseUrl: cfg.enrichmentBaseUrl,
		...(flags as Pick<AdminConfigResponse, SecretSetFlag>),
	}
}

/** Coerce empty secret strings in an admin patch to `null` (clear secret). */
export function normalizeAdminConfigPatch(data: AdminConfigPatch): ConfigPatch {
	const patch: Record<string, unknown> = { ...data }
	for (const f of SECRET_CONFIG_FIELDS) {
		if (patch[f.prop] === "") patch[f.prop] = null
	}
	return patch as ConfigPatch
}

/** Prevent disabling password auth unless Google OAuth is enabled and fully configured. */
export function validateAuthLockout(cfg: ResolvedConfig, patch: ConfigPatch): string | null {
	const passwordDisabled =
		patch.passwordAuthDisabled !== undefined ? patch.passwordAuthDisabled : cfg.passwordAuthDisabled
	if (!passwordDisabled) return null

	const oauthEnabled =
		patch.googleOauthEnabled !== undefined ? patch.googleOauthEnabled : cfg.googleOauthEnabled
	const clientId = patch.googleClientId !== undefined ? patch.googleClientId : cfg.googleClientId
	const clientSecret =
		patch.googleClientSecret !== undefined ? patch.googleClientSecret : cfg.googleClientSecret

	if (!oauthEnabled || !clientId?.trim() || !clientSecret?.trim()) {
		return "Cannot disable password authentication without enabling and configuring Google OAuth (Client ID and Client Secret)."
	}
	return null
}

/** Build `app_config` column updates from env vars for empty DB columns only. */
export function buildBootstrapUpdates(
	row: Partial<AppConfig>,
	env: Record<string, string | undefined> = process.env,
	encryptFn: (v: string) => string = encrypt,
): Partial<typeof appConfig.$inferInsert> {
	const updates: Record<string, unknown> = {}
	for (const f of SECRET_CONFIG_FIELDS) {
		const v = env[f.envVar]?.trim()
		if (v && (row[f.column] == null || row[f.column] === "")) {
			updates[f.column] = encryptFn(v)
		}
	}
	for (const f of PLAIN_ENV_CONFIG_FIELDS) {
		const v = env[f.envVar]?.trim()
		if (v && (row[f.column] == null || row[f.column] === "")) {
			updates[f.column] = v
		}
	}
	const envProvider = env.ENRICHMENT_PROVIDER?.trim()
	if (
		envProvider &&
		(row.enrichmentProvider == null || row.enrichmentProvider === "") &&
		(ENRICHMENT_PROVIDERS as readonly string[]).includes(envProvider)
	) {
		updates.enrichmentProvider = envProvider
	}
	const hasGoogleSecret = Boolean(updates.googleClientSecretEnc || row.googleClientSecretEnc)
	if (updates.googleClientId && hasGoogleSecret && !row.googleOauthEnabled) {
		updates.googleOauthEnabled = true
	}
	return updates as Partial<typeof appConfig.$inferInsert>
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

	const secrets: Record<string, string | null> = {}
	for (const f of SECRET_CONFIG_FIELDS) {
		secrets[f.prop] = decryptOrThrow(row[f.column], f.column)
	}

	cached = {
		id: 1,
		orgName: row.orgName,
		allowedEmailDomain: row.allowedEmailDomain,
		openSignupEnabled: row.openSignupEnabled,
		googleOauthEnabled: row.googleOauthEnabled,
		passwordAuthDisabled: row.passwordAuthDisabled,
		googleClientId: row.googleClientId,
		googleOauthRedirectUri: row.googleOauthRedirectUri,
		slackChannelId: row.slackChannelId,
		claudeCodeDailyThresholdCents: row.claudeCodeDailyThresholdCents,
		cursorDailyThresholdCents: row.cursorDailyThresholdCents,
		bootstrapAdminUserId: row.bootstrapAdminUserId,
		setupCompletedAt: row.setupCompletedAt,
		claudeCodeWorkspaceId: row.claudeCodeWorkspaceId,
		githubOrg: row.githubOrg,
		spendVisibility: row.spendVisibility,
		enrichmentProvider: (row.enrichmentProvider as EnrichmentProvider | null) ?? null,
		enrichmentModelName: row.enrichmentModelName,
		enrichmentBaseUrl: row.enrichmentBaseUrl,
		...(secrets as Pick<ResolvedConfig, SecretProp>),
	}
	return cached
}

export async function saveConfig(patch: ConfigPatch): Promise<ResolvedConfig> {
	const update: Record<string, unknown> = { updatedAt: new Date() }

	for (const key of PLAIN_CONFIG_KEYS) {
		if (patch[key] !== undefined) update[key] = patch[key]
	}
	for (const f of SECRET_CONFIG_FIELDS) {
		const val = patch[f.prop]
		if (val !== undefined) {
			update[f.column] = val === null || val === "" ? null : encrypt(val)
		}
	}

	await db.update(appConfig).set(update).where(eq(appConfig.id, 1))
	invalidateConfigCache()
	return loadConfig()
}
