import { sql } from "drizzle-orm"
import {
	bigint,
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { z } from "zod"

// ── Enums ─────────────────────────────────────────────────────────────────

export const appUserRoleEnum = pgEnum("app_user_role", ["viewer", "admin"])
export const platformEnum = pgEnum("platform", ["claude_code", "cursor"])
export const alertScopeEnum = pgEnum("alert_scope", ["global", "user"])
export const alertStatusEnum = pgEnum("alert_status", ["open", "acknowledged", "resolved"])
export const syncJobEnum = pgEnum("sync_job", ["anthropic", "cursor", "alerts", "slack_digest"])
export const syncStatusEnum = pgEnum("sync_status", ["success", "failed", "running"])

// ── App auth ──────────────────────────────────────────────────────────────

export const appUsers = pgTable(
	"app_users",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		email: varchar("email", { length: 320 }).notNull(),
		name: text("name"),
		role: appUserRoleEnum("role").notNull().default("viewer"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
		passwordHash: text("password_hash"),
		googleId: text("google_id"),
	},
	(t) => ({
		emailIdx: uniqueIndex("app_users_email_idx").on(t.email),
		googleIdx: uniqueIndex("app_users_google_id_idx")
			.on(t.googleId)
			.where(sql`${t.googleId} is not null`),
	}),
)

// ── Tracked engineers (joined identity across platforms) ─────────────────

export const trackedUsers = pgTable("tracked_users", {
	email: varchar("email", { length: 320 }).primaryKey(),
	name: text("name"),
	anthropicUserId: text("anthropic_user_id"),
	cursorUserId: text("cursor_user_id"),
	isActive: boolean("is_active").notNull().default(true),
	firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── Anthropic Admin API caches ───────────────────────────────────────────

export const anthropicUsers = pgTable("anthropic_users", {
	id: text("id").primaryKey(),
	email: varchar("email", { length: 320 }).notNull(),
	name: text("name"),
	role: text("role"),
	addedAt: timestamp("added_at", { withTimezone: true }),
	syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
})

// Cached snapshot of /v1/organizations/api_keys. We need the name → created_by
// mapping to attribute `api_actor` rows in Claude Code usage to a human user —
// without it, every CLI/IDE invocation (which is most of real Claude Code spend)
// is invisible to the per-user dashboard.
export const anthropicApiKeys = pgTable(
	"anthropic_api_keys",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		status: text("status"),
		workspaceId: text("workspace_id"),
		createdByUserId: text("created_by_user_id"),
		createdAt: timestamp("created_at", { withTimezone: true }),
		syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => ({
		// Lookup-by-name; not unique because Anthropic doesn't enforce name uniqueness.
		nameIdx: index("anthropic_api_keys_name_idx").on(t.name),
	}),
)

// ── Cursor Admin API caches ──────────────────────────────────────────────

export const cursorMembers = pgTable("cursor_members", {
	id: text("id").primaryKey(),
	email: varchar("email", { length: 320 }).notNull(),
	name: text("name"),
	role: text("role"),
	isRemoved: boolean("is_removed").notNull().default(false),
	syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── Daily usage rollups ──────────────────────────────────────────────────

// Raw per-api-key token volume per day per bucket, sourced from Anthropic's
// /v1/organizations/usage_report/messages endpoint. This is the only public
// admin endpoint that gives us complete per-key data — usage_report/claude_code
// is sparse, and cost_report has no api_key dimension.
// Bucketed by (api_key, model, service_tier, context_window) so we can join
// to cost_report buckets and pro-rate $.
export const dailyMessageUsage = pgTable(
	"daily_message_usage",
	{
		date: date("date").notNull(),
		workspaceId: text("workspace_id").notNull().default(""),
		apiKeyId: text("api_key_id").notNull(),
		model: text("model").notNull().default(""),
		serviceTier: text("service_tier").notNull().default(""),
		contextWindow: text("context_window").notNull().default(""),
		uncachedInputTokens: bigint("uncached_input_tokens", { mode: "number" }).notNull().default(0),
		cacheReadInputTokens: bigint("cache_read_input_tokens", { mode: "number" })
			.notNull()
			.default(0),
		cacheCreation5mTokens: bigint("cache_creation_5m_tokens", { mode: "number" })
			.notNull()
			.default(0),
		cacheCreation1hTokens: bigint("cache_creation_1h_tokens", { mode: "number" })
			.notNull()
			.default(0),
		outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
		webSearchRequests: integer("web_search_requests").notNull().default(0),
		syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => ({
		pk: primaryKey({
			columns: [t.date, t.workspaceId, t.apiKeyId, t.model, t.serviceTier, t.contextWindow],
		}),
		dateWsIdx: index("dmu_date_ws_idx").on(t.date, t.workspaceId),
		apiKeyIdx: index("dmu_api_key_idx").on(t.apiKeyId),
	}),
)

// Derived per-engineer Claude Code attribution per day per model.
// Computed by pro-rating cost_report buckets across api_keys (via token share)
// then resolving api_key.created_by_user_id → users.email.
// Re-derived on each sync; not authoritative — the raw inputs (daily_message_usage
// + daily_anthropic_cost_totals) are the ground truth.
export const dailyClaudeCodeAttribution = pgTable(
	"daily_claude_code_attribution",
	{
		date: date("date").notNull(),
		email: varchar("email", { length: 320 }).notNull(),
		model: text("model").notNull(),
		uncachedInputTokens: bigint("uncached_input_tokens", { mode: "number" }).notNull().default(0),
		cacheReadInputTokens: bigint("cache_read_input_tokens", { mode: "number" })
			.notNull()
			.default(0),
		cacheCreation5mTokens: bigint("cache_creation_5m_tokens", { mode: "number" })
			.notNull()
			.default(0),
		cacheCreation1hTokens: bigint("cache_creation_1h_tokens", { mode: "number" })
			.notNull()
			.default(0),
		outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
		attributedCents: integer("attributed_cents").notNull().default(0),
		syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.date, t.email, t.model] }),
		emailDateIdx: index("dcca_email_date_idx").on(t.email, t.date),
		dateIdx: index("dcca_date_idx").on(t.date),
	}),
)

export const dailyCursorUsage = pgTable(
	"daily_cursor_usage",
	{
		date: date("date").notNull(),
		email: varchar("email", { length: 320 }).notNull(),
		model: text("model").notNull(),
		inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
		outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
		cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
		cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
		chargedCents: integer("charged_cents").notNull().default(0),
		requestCount: integer("request_count").notNull().default(0),
		syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.date, t.email, t.model] }),
		emailDateIdx: index("dcu_email_date_idx").on(t.email, t.date),
		dateIdx: index("dcu_date_idx").on(t.date),
	}),
)

export const cursorSpendSnapshots = pgTable(
	"cursor_spend_snapshots",
	{
		snapshotDate: date("snapshot_date").notNull(),
		email: varchar("email", { length: 320 }).notNull(),
		spendCents: integer("spend_cents").notNull().default(0),
		overallSpendCents: integer("overall_spend_cents").notNull().default(0),
		fastPremiumRequests: integer("fast_premium_requests").notNull().default(0),
		hardLimitDollars: integer("hard_limit_dollars"),
		monthlyLimitDollars: integer("monthly_limit_dollars"),
		syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.snapshotDate, t.email] }),
	}),
)

// Raw cost_report buckets, expanded to natively store the dimension columns
// instead of only the (string) description. These dimensions match exactly to
// daily_message_usage so pro-rating is a clean join.
export const dailyAnthropicCostTotals = pgTable(
	"daily_anthropic_cost_totals",
	{
		date: date("date").notNull(),
		workspaceId: text("workspace_id").notNull().default(""),
		model: text("model").notNull().default(""),
		serviceTier: text("service_tier").notNull().default(""),
		contextWindow: text("context_window").notNull().default(""),
		inferenceGeo: text("inference_geo").notNull().default(""),
		tokenType: text("token_type").notNull().default(""),
		description: text("description").notNull().default(""), // human-readable, audit
		costCents: integer("cost_cents").notNull().default(0),
		syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => ({
		pk: primaryKey({
			columns: [
				t.date,
				t.workspaceId,
				t.model,
				t.serviceTier,
				t.contextWindow,
				t.inferenceGeo,
				t.tokenType,
			],
		}),
		dateWsIdx: index("dact_date_ws_idx").on(t.date, t.workspaceId),
	}),
)

// ── Alerts ───────────────────────────────────────────────────────────────

export const alertThresholds = pgTable(
	"alert_thresholds",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		scope: alertScopeEnum("scope").notNull(),
		email: varchar("email", { length: 320 }), // nullable when scope=global
		platform: platformEnum("platform").notNull(),
		dailyCents: integer("daily_cents").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => ({
		scopePlatformIdx: index("at_scope_platform_idx").on(t.scope, t.platform),
		userPlatformIdx: index("at_user_platform_idx").on(t.email, t.platform),
	}),
)

export const alerts = pgTable(
	"alerts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		date: date("date").notNull(),
		email: varchar("email", { length: 320 }).notNull(),
		platform: platformEnum("platform").notNull(),
		amountCents: integer("amount_cents").notNull(),
		thresholdCents: integer("threshold_cents").notNull(),
		status: alertStatusEnum("status").notNull().default("open"),
		channelsSent: jsonb("channels_sent").$type<string[]>().notNull().default([]),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
	},
	(t) => ({
		dateEmailPlatformIdx: uniqueIndex("alerts_date_email_platform_idx").on(
			t.date,
			t.email,
			t.platform,
		),
		statusIdx: index("alerts_status_idx").on(t.status),
		emailIdx: index("alerts_email_idx").on(t.email),
	}),
)

// ── Operational ──────────────────────────────────────────────────────────

export const syncRuns = pgTable(
	"sync_runs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		job: syncJobEnum("job").notNull(),
		status: syncStatusEnum("status").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		rowsUpserted: integer("rows_upserted").notNull().default(0),
		error: text("error"),
		triggeredBy: text("triggered_by"),
	},
	(t) => ({
		jobStartedIdx: index("sync_runs_job_started_idx").on(t.job, t.startedAt),
	}),
)

// ── App config (singleton) ────────────────────────────────────────────

export const appConfig = pgTable("app_config", {
	id: integer("id").primaryKey().notNull(), // always 1
	orgName: text("org_name").notNull().default(""),
	allowedEmailDomain: text("allowed_email_domain"),
	openSignupEnabled: boolean("open_signup_enabled").notNull().default(false),
	googleOauthEnabled: boolean("google_oauth_enabled").notNull().default(false),
	googleClientId: text("google_client_id"),
	googleClientSecretEnc: text("google_client_secret_enc"),
	googleOauthRedirectUri: text("google_oauth_redirect_uri"),
	anthropicAdminApiKeyEnc: text("anthropic_admin_api_key_enc"),
	cursorAdminApiKeyEnc: text("cursor_admin_api_key_enc"),
	slackBotTokenEnc: text("slack_bot_token_enc"),
	slackChannelId: text("slack_channel_id"),
	claudeCodeDailyThresholdCents: integer("claude_code_daily_threshold_cents")
		.notNull()
		.default(5000),
	cursorDailyThresholdCents: integer("cursor_daily_threshold_cents").notNull().default(5000),
	// Auto-detected on first sync: the workspace_id Anthropic uses for Claude Code activity.
	// We filter messages + cost_report data to this workspace for the dashboard.
	claudeCodeWorkspaceId: text("claude_code_workspace_id"),
	bootstrapAdminUserId: uuid("bootstrap_admin_user_id"),
	setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
	encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── Invitations ───────────────────────────────────────────────────────

export const invitations = pgTable(
	"invitations",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		email: varchar("email", { length: 320 }).notNull(),
		role: appUserRoleEnum("role").notNull(),
		token: text("token").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => appUsers.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		consumedUserId: uuid("consumed_user_id").references(() => appUsers.id, {
			onDelete: "set null",
		}),
	},
	(t) => ({
		tokenIdx: uniqueIndex("invitations_token_idx").on(t.token),
		emailIdx: index("invitations_email_idx").on(t.email),
	}),
)

// ── Zod schemas (insert/select) ──────────────────────────────────────────

export const insertAppUserSchema = createInsertSchema(appUsers).omit({
	id: true,
	createdAt: true,
})
export const selectAppUserSchema = createSelectSchema(appUsers)

export const insertAlertThresholdSchema = createInsertSchema(alertThresholds).omit({
	id: true,
	createdAt: true,
	updatedAt: true,
})

export const updateGlobalThresholdSchema = z.object({
	platform: z.enum(["claude_code", "cursor"]),
	dailyCents: z.number().int().nonnegative(),
	enabled: z.boolean().default(true),
})

export const updateUserThresholdSchema = z.object({
	platform: z.enum(["claude_code", "cursor"]),
	dailyCents: z.number().int().nonnegative(),
	enabled: z.boolean().default(true),
})

// ── Inferred types ───────────────────────────────────────────────────────

export type AppUser = typeof appUsers.$inferSelect
export type NewAppUser = typeof appUsers.$inferInsert
export type TrackedUser = typeof trackedUsers.$inferSelect
export type AlertThreshold = typeof alertThresholds.$inferSelect
export type Alert = typeof alerts.$inferSelect
export type SyncRun = typeof syncRuns.$inferSelect
export type DailyMessageUsage = typeof dailyMessageUsage.$inferSelect
export type DailyClaudeCodeAttribution = typeof dailyClaudeCodeAttribution.$inferSelect
export type DailyCursorUsage = typeof dailyCursorUsage.$inferSelect
export type CursorSpendSnapshot = typeof cursorSpendSnapshots.$inferSelect
export type AppConfig = typeof appConfig.$inferSelect
export type Invitation = typeof invitations.$inferSelect
