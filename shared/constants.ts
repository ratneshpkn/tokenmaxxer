export const PLATFORMS = ["claude_code", "cursor"] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
	claude_code: "Claude Code",
	cursor: "Cursor",
}

export const ALERT_STATUSES = ["open", "acknowledged", "resolved"] as const
export type AlertStatus = (typeof ALERT_STATUSES)[number]

export const SYNC_JOBS = [
	"anthropic",
	"cursor",
	"alerts",
	"slack_digest",
	"github",
	"prs_enrich",
	"pr_files",
	"recommendations",
] as const
export type SyncJob = (typeof SYNC_JOBS)[number]

export const APP_USER_ROLES = ["viewer", "admin"] as const
export type AppUserRole = (typeof APP_USER_ROLES)[number]

/** Recharts color palette (matches CSS vars in client/src/index.css). */
export const CHART_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
] as const

/** Grounded PR complexity weights: L1=0.1, L2=0.5, L3=2.0, L4=8.0, L5=24.0 */
export const PR_COMPLEXITY_WEIGHTS: Record<number, number> = {
	1: 0.1,
	2: 0.5,
	3: 2.0,
	4: 8.0,
	5: 24.0,
}
