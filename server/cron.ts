import { DEFAULTS } from "@shared/defaults"
import { runComputeAlerts } from "./scripts/compute-alerts"
import { daysAgo, today, yesterday } from "./scripts/lib/shared"
import { runSlackDigest } from "./scripts/slack-digest"
import { runAnthropicSync } from "./scripts/sync-anthropic"
import { runCursorSync } from "./scripts/sync-cursor"

/** Two-cron design:
 *
 *  • HOURLY ("fresh"): every hour, 24/7, pulls the rolling 24-hour window
 *    (yesterday + today). Cheap, surfaces today's spend within ~1h of usage.
 *  • DAILY ("self-heal"): once a day at 09:00 PT, pulls the rolling 7-day
 *    window to yesterday. Catches anything the hourly missed (container
 *    downtime, API hiccups) and triggers the Slack digest.
 *
 *  Both pass `triggeredBy` so `sync_runs` shows the source of every row.
 *  Each job is wrapped in its own try/catch so one failure doesn't kill
 *  the others in the same tick.
 */
const DAILY_LOOKBACK_DAYS = 7
const HOURLY_LOOKBACK_DAYS = 1

const HOURLY_EXPR = "0 * * * *"
const _DAILY_OFFSET_MINUTES = 15

async function runJob(label: string, fn: () => Promise<unknown>): Promise<void> {
	try {
		await fn()
	} catch (err) {
		console.error(`[cron ${label}] failed`, err)
	}
}

/**
 * Calculates the UTC cron expression for a daily job in a specific timezone.
 * Bun.cron runs in UTC, so we convert target local time to UTC on startup.
 */
function getDailyExprInUtc(tz: string, localHour: number, localMinute: number): string {
	const now = new Date()

	// Format today's date in target timezone to find host-to-target offset
	const ptDate = new Date(now.toLocaleString("en-US", { timeZone: tz }))
	const diffMs = now.getTime() - ptDate.getTime()

	// Create target daily time in local timezone
	const targetLocal = new Date(now)
	targetLocal.setHours(localHour, localMinute, 0, 0)

	// Shift to target timezone UTC equivalent
	const targetUtc = new Date(targetLocal.getTime() + diffMs)
	return `${targetUtc.getUTCMinutes()} ${targetUtc.getUTCHours()} * * *`
}

export function startCron(): void {
	if (process.env.ENABLE_CRON !== "true") {
		console.log("[cron] disabled (set ENABLE_CRON=true to enable)")
		return
	}

	const tz = DEFAULTS.cron.timezone

	// "0 9 * * *" is 9:00 AM. Daily fires at xx:15 PT to avoid colliding with top-of-hour.
	const dailyHour = 9
	const dailyMinute = 15
	const dailyExpr = getDailyExprInUtc(tz, dailyHour, dailyMinute)

	// Skip-if-busy guard: if a hourly tick takes >60 min, the next tick is skipped
	let hourlyRunning = false

	// Hourly: keep today's data fresh.
	Bun.cron(HOURLY_EXPR, async () => {
		if (hourlyRunning) {
			console.warn("[cron hourly] previous tick still running — skipping")
			return
		}
		hourlyRunning = true
		try {
			const range = { from: daysAgo(HOURLY_LOOKBACK_DAYS), to: today() }
			const o = { triggeredBy: "cron:hourly" }
			await runJob("hourly anthropic", () => runAnthropicSync(range, o))
			await runJob("hourly cursor", () => runCursorSync(range, o))
			await runJob("hourly alerts", () => runComputeAlerts({ ...o, dates: [yesterday(), today()] }))
		} finally {
			hourlyRunning = false
		}
	})

	// Daily: deeper self-heal + Slack digest.
	Bun.cron(dailyExpr, async () => {
		const range = { from: daysAgo(DAILY_LOOKBACK_DAYS), to: yesterday() }
		const o = { triggeredBy: "cron:daily" }
		await runJob("daily anthropic", () => runAnthropicSync(range, o))
		await runJob("daily cursor", () => runCursorSync(range, o))
		await runJob("daily alerts", () => runComputeAlerts(o))
		await runJob("daily slack", () => runSlackDigest(o))
	})

	console.log(
		`[cron] scheduled — hourly (${HOURLY_EXPR}) for 24h refresh, daily UTC (${dailyExpr}) [equivalent to local 09:15 in ${tz}] for 7d self-heal`,
	)
}
