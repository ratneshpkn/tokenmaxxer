import { describe, expect, it } from "bun:test"
import {
	buildBootstrapUpdates,
	type ResolvedConfig,
	SECRET_CONFIG_FIELDS,
	toAdminConfigResponse,
	validateAuthLockout,
} from "./config"

const baseConfig = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
	id: 1,
	orgName: "Acme",
	allowedEmailDomain: "acme.com",
	openSignupEnabled: false,
	googleOauthEnabled: false,
	passwordAuthDisabled: false,
	googleClientId: null,
	googleClientSecret: null,
	googleOauthRedirectUri: null,
	anthropicAdminApiKey: "sk-ant-secret",
	cursorAdminApiKey: null,
	slackBotToken: "",
	slackChannelId: "C123",
	claudeCodeDailyThresholdCents: 5000,
	cursorDailyThresholdCents: 5000,
	bootstrapAdminUserId: null,
	setupCompletedAt: null,
	claudeCodeWorkspaceId: null,
	githubAccessToken: "ghp_secret",
	githubOrg: "acme-org",
	spendVisibility: "admin_only",
	enrichmentProvider: "anthropic",
	enrichmentApiKey: "sk-enrich",
	enrichmentModelName: "claude-sonnet-4",
	enrichmentBaseUrl: null,
	...overrides,
})

describe("config registry", () => {
	it("masks all secrets into *Set flags without leaking raw values", () => {
		const res = toAdminConfigResponse(baseConfig())
		expect(res.anthropicAdminApiKeySet).toBe(true)
		expect(res.cursorAdminApiKeySet).toBe(false)
		expect(res.slackBotTokenSet).toBe(false)
		expect(res.githubAccessTokenSet).toBe(true)
		expect(res.enrichmentApiKeySet).toBe(true)
		for (const f of SECRET_CONFIG_FIELDS) {
			expect((res as unknown as Record<string, unknown>)[f.prop]).toBeUndefined()
		}
	})

	it("blocks auth lockout when disabling password auth or clearing OAuth secret", () => {
		expect(validateAuthLockout(baseConfig(), { passwordAuthDisabled: true })).toContain(
			"Cannot disable",
		)
		const locked = baseConfig({
			passwordAuthDisabled: true,
			googleOauthEnabled: true,
			googleClientId: "cid",
			googleClientSecret: "csec",
		})
		expect(validateAuthLockout(locked, {})).toBeNull()
		expect(validateAuthLockout(locked, { googleClientSecret: null })).toContain("Cannot disable")
	})

	it("bootstraps only empty DB columns and never re-enables OAuth on restart", () => {
		expect(
			buildBootstrapUpdates(
				{
					anthropicAdminApiKeyEnc: "keep",
					githubAccessTokenEnc: null,
					enrichmentProvider: null,
					googleClientId: null,
					googleClientSecretEnc: null,
					googleOauthEnabled: false,
				},
				{
					ANTHROPIC_ADMIN_API_KEY: "ignored",
					GITHUB_ACCESS_TOKEN: "ghp_1",
					ENRICHMENT_PROVIDER: "openai",
					GOOGLE_CLIENT_ID: "gid",
					GOOGLE_CLIENT_SECRET: "gsec",
				},
				(v) => `enc:${v}`,
			),
		).toEqual({
			githubAccessTokenEnc: "enc:ghp_1",
			enrichmentProvider: "openai",
			googleClientId: "gid",
			googleClientSecretEnc: "enc:gsec",
			googleOauthEnabled: true,
		})

		expect(
			buildBootstrapUpdates(
				{ googleClientId: "existing", googleClientSecretEnc: "sec", googleOauthEnabled: false },
				{ GOOGLE_CLIENT_ID: "existing", ENRICHMENT_PROVIDER: "bogus" },
				(v) => `enc:${v}`,
			),
		).toEqual({})
	})
})
