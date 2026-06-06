/**
 * Non-secret defaults that ship with the app. Edit and redeploy to change.
 * Per-user overrides live in the alert_thresholds table (scope='user').
 */
export const DEFAULTS = {
	thresholds: {
		claude_code_daily_cents: 5000, // $50/day
		cursor_daily_cents: 5000, // $50/day
	},
	cron: {
		dailySyncAt: "0 9 * * *", // 9:00 AM PT — cron.ts adds +15min offset to avoid colliding with the hourly tick
		timezone: "America/Los_Angeles",
	},
	slack: {
		digestTopSpendersCount: 5,
	},
} as const

export type Defaults = typeof DEFAULTS
