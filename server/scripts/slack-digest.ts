import { PLATFORM_LABELS } from "@shared/constants"
import { DEFAULTS } from "@shared/defaults"
import { alerts } from "@shared/schema"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db, pool } from "../db"
import { loadConfig } from "../lib/config"
import { postDigest } from "../lib/slack"
import { withSyncRun, yesterday } from "./lib/shared"

interface TopRow extends Record<string, unknown> {
	email: string
	total_cents: number
}

function formatCents(c: number): string {
	return `$${(c / 100).toFixed(2)}`
}

export async function runSlackDigest(opts?: {
	existingRunId?: string
	triggeredBy?: string
}): Promise<{ rowsUpserted: number }> {
	return withSyncRun(
		"slack_digest",
		async () => {
			const day = yesterday()
			const top = DEFAULTS.slack.digestTopSpendersCount

			const ccRes = await db.execute<TopRow>(sql`
      select email, coalesce(sum(attributed_cents),0)::int as total_cents
        from daily_claude_code_attribution
       where date = ${day}
       group by email
       order by total_cents desc
       limit ${top}
    `)
			const cuRes = await db.execute<TopRow>(sql`
      select email, coalesce(sum(charged_cents),0)::int as total_cents
        from daily_cursor_usage
       where date = ${day}
       group by email
       order by total_cents desc
       limit ${top}
    `)
			const ccTop = ccRes.rows ?? []
			const cuTop = cuRes.rows ?? []

			const openAlerts = await db
				.select()
				.from(alerts)
				.where(and(eq(alerts.date, day), eq(alerts.status, "open")))

			const ccTotal = ccTop.reduce((a, r) => a + r.total_cents, 0)
			const cuTotal = cuTop.reduce((a, r) => a + r.total_cents, 0)

			const lines: string[] = []
			lines.push(`*tokenmaxxer daily digest — ${day}*`)
			lines.push("")
			if (openAlerts.length > 0) {
				lines.push(
					`:rotating_light: *${openAlerts.length} alert${openAlerts.length === 1 ? "" : "s"} triggered*`,
				)
				for (const a of openAlerts) {
					lines.push(
						`• ${a.email} · ${PLATFORM_LABELS[a.platform]} · ${formatCents(a.amountCents)} (threshold ${formatCents(a.thresholdCents)})`,
					)
				}
				lines.push("")
			} else {
				lines.push(":white_check_mark: No alerts triggered.")
				lines.push("")
			}

			if (ccTop.length > 0) {
				lines.push(`*Top Claude Code spenders* (total ${formatCents(ccTotal)})`)
				for (const r of ccTop) lines.push(`• ${r.email} — ${formatCents(r.total_cents)}`)
				lines.push("")
			}
			if (cuTop.length > 0) {
				lines.push(`*Top Cursor spenders* (total ${formatCents(cuTotal)})`)
				for (const r of cuTop) lines.push(`• ${r.email} — ${formatCents(r.total_cents)}`)
			}

			const text = lines.join("\n")
			const cfg = await loadConfig()
			const token = cfg.slackBotToken ?? process.env.SLACK_BOT_TOKEN
			const channel = cfg.slackChannelId ?? process.env.SLACK_CHANNEL_ID
			await postDigest(token, channel, text)

			if (openAlerts.length > 0) {
				const ids = openAlerts.map((a) => a.id)
				await db
					.update(alerts)
					.set({
						channelsSent: sql`channels_sent || '["slack"]'::jsonb`,
					})
					.where(inArray(alerts.id, ids))
			}

			console.log(
				`[slack-digest] posted (${openAlerts.length} alerts, top ${ccTop.length + cuTop.length})`,
			)
			return { rowsUpserted: openAlerts.length }
		},
		opts,
	)
}

if (import.meta.main) {
	runSlackDigest()
		.then(() => pool.end())
		.catch((err) => {
			console.error("[slack-digest] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
