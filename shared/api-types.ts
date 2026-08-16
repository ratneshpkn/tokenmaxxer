export interface UsageRow {
	date: string
	model?: string
	estimated_cost_cents?: number
	charged_cents?: number
	input_tokens?: number
	output_tokens?: number
	cache_read_tokens?: number
	cache_creation_tokens?: number
	cache_write_tokens?: number
}

export interface ConfigResponse {
	allowedEmailDomain: string
	allowedEmailDomains: string[]
	orgName: string
	googleOauthEnabled: boolean
	openSignupEnabled: boolean
	setupCompleted: boolean
	bootstrapNeeded: boolean
	spendVisibility: "admin_only" | "viewer_own" | "viewer_all"
}

export interface AdminConfigResponse {
	orgName: string
	allowedEmailDomain: string | null
	allowedEmailDomains: string[]
	openSignupEnabled: boolean
	googleOauthEnabled: boolean
	googleClientId: string | null
	googleOauthRedirectUri: string | null
	slackChannelId: string | null
	anthropicAdminApiKeySet: boolean
	cursorAdminApiKeySet: boolean
	slackBotTokenSet: boolean
	googleClientSecretSet: boolean
	githubOrg: string | null
	githubAccessTokenSet: boolean
	spendVisibility: "admin_only" | "viewer_own" | "viewer_all"
	enrichmentProvider: "anthropic" | "openai" | "openai_compatible" | null
	enrichmentApiKeySet: boolean
	enrichmentModelName: string | null
	enrichmentBaseUrl: string | null
}

export interface AdminConfigPatch {
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
	githubAccessToken?: string | null
	githubOrg?: string | null
	spendVisibility?: "admin_only" | "viewer_own" | "viewer_all"
	enrichmentProvider?: "anthropic" | "openai" | "openai_compatible" | null
	enrichmentApiKey?: string | null
	enrichmentModelName?: string | null
	enrichmentBaseUrl?: string | null
}

export interface MeResponse {
	id: string
	email: string
	name: string | null
	role: "viewer" | "admin"
}

export interface AuthResponse {
	id: string
	email: string
	role: "viewer" | "admin"
}

export interface AppUserItem {
	id: string
	email: string
	name: string | null
	role: "viewer" | "admin"
	createdAt: string
	lastLoginAt: string | null
}

export interface InvitationItem {
	id: string
	email: string
	role: "viewer" | "admin"
	expiresAt: string
	createdAt: string
}

export interface CreateInvitationResponse {
	url: string
	invitation: {
		id: string
		email: string
		role: string
		expiresAt: string
	}
}

export interface DashboardSummaryResponse {
	totals: {
		cc_cents: number | null
		cu_cents: number | null
		cc_tokens: number
		cu_tokens: number
		cc_users: number
		cu_users: number
		gh_commits: number
		gh_prs_opened: number
		gh_prs_merged: number
		gh_additions: number
		gh_deletions: number
		gh_users: number
		open_alerts: number | null
	} | null
	trend: Array<{
		date: string
		claude_code_cents: number | null
		cursor_cents: number | null
		claude_code_tokens: number
		cursor_tokens: number
		gh_prs_merged: number
		gh_additions: number
		gh_deletions: number
	}>
}

export interface TopSpenderItem {
	email: string
	name: string | null
	cc_cents: number | null
	cu_cents: number | null
	total_cents: number | null
	cc_tokens: number
	cu_tokens: number
	total_tokens: number
	trend_cents: number[] | null
	trend_tokens: number[]
	gh_prs_merged: number
	gh_additions: number
	gh_deletions: number
}

export interface ModelMixItem {
	model: string
	cents: number | null
	tokens: number
	trend_cents: number[] | null
	trend_tokens: number[]
}

export interface UserListItem {
	email: string
	name: string | null
	github_username: string | null
	cc_cents: number | null
	cu_cents: number | null
	cc_tokens: number
	cu_tokens: number
	trend_cents: number[] | null
	trend_tokens: number[]
	gh_prs_merged: number
	gh_additions: number
	gh_deletions: number
}

export interface UserDetailResponse {
	email: string
	name: string | null
	anthropic_user_id: string | null
	cursor_user_id: string | null
	github_username: string | null
}

export interface HeatmapItem {
	date: string
	cc_cents: number | null
	cu_cents: number | null
	cc_tokens: number
	cu_tokens: number
}

export interface AlertItem {
	id: string
	date: string
	email: string
	name: string | null
	platform: "claude_code" | "cursor"
	amountCents: number
	thresholdCents: number
	status: "open" | "acknowledged" | "resolved"
	createdAt: string
}

export interface ThresholdsResponse {
	global: {
		claude_code: number
		cursor: number
	}
	perUser: Array<{
		id: string
		scope: "user"
		email: string | null
		platform: "claude_code" | "cursor"
		dailyCents: number
		enabled: boolean
	}>
}

export interface SyncRunItem {
	id: string
	job: "anthropic" | "cursor" | "alerts" | "slack_digest" | "github"
	status: "success" | "failed" | "running"
	startedAt: string
	completedAt: string | null
	rowsUpserted: number
	error: string | null
	triggeredBy: string | null
}

export interface SetupSavePayload {
	orgName: string
	allowedEmailDomain?: string | null
	openSignupEnabled?: boolean
	anthropicAdminApiKey: string
	cursorAdminApiKey: string
	slackBotToken?: string | null
	slackChannelId?: string | null
	claudeCodeDailyThresholdCents?: number
	cursorDailyThresholdCents?: number
	githubAccessToken?: string | null
	githubOrg?: string | null
}

export interface CodeOutputItem {
	date: string
	prs_opened: number
	prs_merged: number
	additions: number
	deletions: number
}

export interface UpdateTrackedUserRequest {
	githubUsername?: string | null
	name?: string | null
}

export interface UpdateTrackedUserResponse {
	user: UserDetailResponse
	backfillRunId?: string
}

export interface GithubHeatmapItem {
	date: string
	prs_opened: number
	prs_merged: number
	additions: number
	deletions: number
}

export interface ModelProfileResponse {
	model: string
	base_model?: string
	raw_models: string[]
	platforms: ("claude_code" | "cursor")[]
	cc_cents: number | null
	cu_cents: number | null
	cc_tokens: number
	cu_tokens: number
	total_cents: number | null
	total_tokens: number
	active_users: number
}

export interface ModelUserItem {
	email: string
	name: string | null
	cents: number | null
	tokens: number
	share_pct: number
	trend_cents: number[] | null
	trend_tokens: number[]
}

export interface ModelTrendItem {
	date: string
	cc_cents: number | null
	cu_cents: number | null
	cc_tokens: number
	cu_tokens: number
}

export interface ModelRawModelItem {
	raw_model: string
	cents: number | null
	tokens: number
	share_pct: number
	trend_cents: number[] | null
	trend_tokens: number[]
}

export interface UserRawModelClaudeCodeItem {
	model: string
	input_tokens: number
	output_tokens: number
	cache_read_tokens: number
	cache_creation_tokens: number
	estimated_cost_cents?: number
}

export interface UserRawModelCursorItem {
	model: string
	input_tokens: number
	output_tokens: number
	cache_read_tokens: number
	cache_write_tokens: number
	charged_cents?: number
	request_count: number
}

export interface UserRawModelsResponse {
	claude_code: UserRawModelClaudeCodeItem[]
	cursor: UserRawModelCursorItem[]
}

export interface ModelRecommendationItem {
	id: string
	email: string
	computedDate: string
	type: "cost_optimization" | "policy_violation" | "work_type_mismatch"
	severity: "info" | "warning" | "critical"
	title: string
	message: string
	suggestedModel?: string | null
	potentialSavingsCents?: number | null
	metadata?: {
		bugFixPct?: number
		featurePct?: number
		heavyweightModel?: string
		orgAvgCentsPerToken?: number
		userCentsPerToken?: number
	} | null
	createdAt: string
}

export interface UserPRComplexityItem {
	repo: string
	number: number
	title: string
	category: string
	complexityScore: number
	complexityReason: string
	summary: string
	mergedAt: string | null
}

export interface UserPRComplexityTrendItem {
	date: string
	averageComplexity: number
	prCount: number
}

export interface UserPRComplexityResponse {
	averageComplexity: number | null
	weightedAvgComplexity: number | null
	totalImpactPoints: number
	substantivePrCount: number
	totalEnrichedPrs: number
	distribution: Array<{
		score: number
		count: number
	}>
	trend: UserPRComplexityTrendItem[]
	recentPrs: UserPRComplexityItem[]
}
