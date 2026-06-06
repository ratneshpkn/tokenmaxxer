import { alerts, alertThresholds } from "@shared/schema"
import { eq, sql } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { withSyncRun, yesterday } from "./lib/shared"

interface DailySpendRow extends Record<string, unknown> {
	email: string
	platform: "claude_code" | "cursor"
	amount_cents: number
}

interface ThresholdLookup {
	global: Map<string, number> // platform → cents
	perUser: Map<string, number> // `${email}|${platform}` → cents
	perUserEnabled: Map<string, boolean>
}

async function loadThresholds(): Promise<ThresholdLookup> {
	const cfg = await loadConfig()
	const out: ThresholdLookup = {
		global: new Map([
			["claude_code", cfg.claudeCodeDailyThresholdCents],
			["cursor", cfg.cursorDailyThresholdCents],
		]),
		perUser: new Map(),
		perUserEnabled: new Map(),
	}
	const perUserRows = await db
		.select()
		.from(alertThresholds)
		.where(eq(alertThresholds.scope, "user"))
	for (const t of perUserRows) {
		if (!t.email) continue
		const key = `${t.email.toLowerCase()}|${t.platform}`
		out.perUser.set(key, t.dailyCents)
		out.perUserEnabled.set(key, t.enabled)
	}
	return out
}

function applicableThreshold(
	email: string,
	platform: "claude_code" | "cursor",
	th: ThresholdLookup,
): { cents: number; enabled: boolean } | null {
	const userKey = `${email.toLowerCase()}|${platform}`
	const perUserCents = th.perUser.get(userKey)
	if (perUserCents !== undefined) {
		return { cents: perUserCents, enabled: th.perUserEnabled.get(userKey) ?? true }
	}
	const globalCents = th.global.get(platform)
	if (globalCents !== undefined) {
		return { cents: globalCents, enabled: true }
	}
	return null
}

export async function runComputeAlerts(opts?: {
	existingRunId?: string
	triggeredBy?: string
	dates?: string[]
}): Promise<{ rowsUpserted: number }> {
	return withSyncRun(
		"alerts",
		async () => {
			// Default: just yesterday (matches the daily cron + CLI behavior).
			// Hourly cron passes [yesterday(), today()] so threshold breaches surface
			// mid-day instead of waiting for the next morning's tick.
			const dates = opts?.dates ?? [yesterday()]
			const thresholds = await loadThresholds()

			let firedCount = 0
			for (const day of dates) {
				const [cc, cu] = await Promise.all([
					db.execute<DailySpendRow>(sql`
          select email,
                 'claude_code' as platform,
                 coalesce(sum(attributed_cents), 0)::int as amount_cents
            from daily_claude_code_attribution
           where date = ${day}
           group by email
        `),
					db.execute<DailySpendRow>(sql`
          select email,
                 'cursor' as platform,
                 coalesce(sum(charged_cents), 0)::int as amount_cents
            from daily_cursor_usage
           where date = ${day}
           group by email
        `),
				])
				const rows: DailySpendRow[] = [...(cc.rows ?? []), ...(cu.rows ?? [])]

				let dayFired = 0
				for (const r of rows) {
					const t = applicableThreshold(r.email, r.platform, thresholds)
					if (!t?.enabled) continue
					if (r.amount_cents <= t.cents) continue

					const inserted = await db
						.insert(alerts)
						.values({
							date: day,
							email: r.email,
							platform: r.platform,
							amountCents: r.amount_cents,
							thresholdCents: t.cents,
							status: "open",
							channelsSent: [],
						})
						.onConflictDoNothing({
							target: [alerts.date, alerts.email, alerts.platform],
						})
						.returning()

					if (inserted.length > 0) dayFired++
				}
				firedCount += dayFired
				console.log(`[compute-alerts] fired ${dayFired} alerts for ${day}`)
			}
			return { rowsUpserted: firedCount }
		},
		opts,
	)
}

if (import.meta.main) {
	runComputeAlerts()
		.then(() => pool.end())
		.catch((err) => {
			console.error("[compute-alerts] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
