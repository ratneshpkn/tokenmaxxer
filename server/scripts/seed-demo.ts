/**
 * Demo seed — populate the dashboard with 90 days of plausible fake usage so a
 * stranger who just ran `docker compose up` sees a dashboard within 30 seconds
 * instead of an empty graveyard.
 *
 * Idempotent. Re-running just refreshes the data. All emails use `@example.com`
 * so the fake data is trivially separable from any real sync that lands later.
 *
 *   docker compose exec app bun run seed:demo
 *
 * Optional `--reset` flag deletes only the demo rows first (anything @example.com).
 */

import {
	alerts,
	dailyClaudeCodeAttribution,
	dailyCursorUsage,
	dailyGithubActivity,
	trackedUsers,
} from "@shared/schema"
import { like, sql } from "drizzle-orm"
import { db, pool } from "../db"

const DEMO_DOMAIN = "example.com"

const PEOPLE = [
	"Alex Chen",
	"Jordan Patel",
	"Sam Rivera",
	"Morgan Yu",
	"Casey Park",
	"Riley Khan",
	"Avery Singh",
	"Cameron Wu",
	"Drew Nakamura",
	"Emerson Lee",
	"Finley Garcia",
	"Hayden Brooks",
	"Indigo Martin",
	"Jules Cohen",
	"Kai Nguyen",
	"Logan Reyes",
	"Mika Lopez",
	"Noor Kapoor",
	"Quinn Park",
	"River Tanaka",
	"Sage Wilson",
	"Tessa Müller",
	"Uma Bose",
	"Vega Ortiz",
	"Wren Davis",
]

type Persona = "light" | "regular" | "heavy" | "power"

interface DemoUser {
	email: string
	name: string
	persona: Persona
	// Affinity for each model — sums need not be 1; we'll normalize.
	ccModels: Array<{ model: string; w: number }>
	cuModels: Array<{ model: string; w: number }>
}

const _CC_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"]
const _CU_MODELS = ["claude-sonnet-4-6", "claude-opus-4-7", "gpt-5.5-medium", "gemini-2.5-pro"]

// Approximate cents-per-1k-tokens for the demo (not real billing — just to
// make the tokens × cents ratio look believable).
const CENTS_PER_KTOK: Record<string, number> = {
	"claude-opus-4-7": 75,
	"claude-sonnet-4-6": 30,
	"claude-haiku-4-5": 8,
	"gpt-5.5-medium": 40,
	"gemini-2.5-pro": 25,
}

const DAILY_CENTS_RANGES: Record<Persona, [number, number]> = {
	light: [0, 500], // $0–5
	regular: [200, 3000], // $2–30
	heavy: [3000, 12000], // $30–120
	power: [8000, 30000], // $80–300
}

function _pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]
}

function rand(min: number, max: number): number {
	return min + Math.random() * (max - min)
}

function weightedPick<T>(items: Array<{ item: T; w: number }>): T {
	const total = items.reduce((s, x) => s + x.w, 0)
	let r = Math.random() * total
	for (const x of items) {
		r -= x.w
		if (r <= 0) return x.item
	}
	return items[items.length - 1].item
}

function ymd(d: Date): string {
	return d.toISOString().slice(0, 10)
}

function isWeekend(d: Date): boolean {
	const day = d.getUTCDay()
	return day === 0 || day === 6
}

function buildUsers(): DemoUser[] {
	return PEOPLE.map((name, i): DemoUser => {
		const slug = name.toLowerCase().replace(/[^a-z]+/g, ".")
		const persona: Persona = i < 3 ? "power" : i < 9 ? "heavy" : i < 18 ? "regular" : "light"

		// Per-user model preferences — some lean Opus, some lean Sonnet/cheaper.
		const opusLean = Math.random()
		const ccModels = [
			{ model: "claude-opus-4-7", w: 0.2 + opusLean * 0.6 },
			{ model: "claude-sonnet-4-6", w: 0.3 + (1 - opusLean) * 0.5 },
			{ model: "claude-haiku-4-5", w: 0.1 + Math.random() * 0.2 },
		]
		const cuOpus = Math.random()
		const cuModels = [
			{ model: "claude-sonnet-4-6", w: 0.3 + Math.random() * 0.4 },
			{ model: "claude-opus-4-7", w: 0.1 + cuOpus * 0.4 },
			{ model: "gpt-5.5-medium", w: 0.1 + Math.random() * 0.4 },
			{ model: "gemini-2.5-pro", w: 0.05 + Math.random() * 0.3 },
		]

		return {
			email: `${slug}@${DEMO_DOMAIN}`,
			name,
			persona,
			ccModels,
			cuModels,
		}
	})
}

async function reset(): Promise<void> {
	// Only delete demo rows (everything @example.com). Real syncs use real domains.
	const pattern = `%@${DEMO_DOMAIN}`
	await db.delete(alerts).where(like(alerts.email, pattern))
	await db.delete(dailyClaudeCodeAttribution).where(like(dailyClaudeCodeAttribution.email, pattern))
	await db.delete(dailyCursorUsage).where(like(dailyCursorUsage.email, pattern))
	await db.delete(dailyGithubActivity).where(like(dailyGithubActivity.email, pattern))
	await db.delete(trackedUsers).where(like(trackedUsers.email, pattern))
	console.log(`[seed:demo] cleared rows for *@${DEMO_DOMAIN}`)
}

async function seed(): Promise<void> {
	const users = buildUsers()
	const today = new Date()
	const startMs = today.getTime() - 90 * 24 * 60 * 60 * 1000

	console.log(`[seed:demo] inserting ${users.length} users + 90 days of usage`)

	// Roster
	await db
		.insert(trackedUsers)
		.values(
			users.map((u) => ({
				email: u.email,
				name: u.name,
				isActive: true,
				githubUsername: u.email.split("@")[0].replace(".", ""),
			})),
		)
		.onConflictDoUpdate({
			target: trackedUsers.email,
			set: {
				name: sql`excluded.name`,
				isActive: true,
				githubUsername: sql`excluded.github_username`,
				updatedAt: new Date(),
			},
		})

	// Per-day per-user usage
	const ccRows: Array<typeof dailyClaudeCodeAttribution.$inferInsert> = []
	const cuRows: Array<typeof dailyCursorUsage.$inferInsert> = []
	const ghRows: Array<typeof dailyGithubActivity.$inferInsert> = []

	for (let t = startMs; t <= today.getTime(); t += 24 * 60 * 60 * 1000) {
		const d = new Date(t)
		const date = ymd(d)
		const weekend = isWeekend(d)

		for (const u of users) {
			// Probability of activity that day — lower on weekends, higher for heavy/power.
			const baseActivity =
				u.persona === "power"
					? 0.95
					: u.persona === "heavy"
						? 0.85
						: u.persona === "regular"
							? 0.6
							: 0.3
			const pActive = weekend ? baseActivity * 0.4 : baseActivity
			if (Math.random() > pActive) continue

			const [minDay, maxDay] = DAILY_CENTS_RANGES[u.persona]
			const dailyBudget = rand(minDay, maxDay)
			const ccShare = 0.3 + Math.random() * 0.5 // 30–80% of activity on Claude Code
			const ccCents = Math.round(dailyBudget * ccShare)
			const cuCents = Math.round(dailyBudget - ccCents)

			// Claude Code — pick 1–2 models for the day
			const ccPickCount = Math.random() < 0.4 ? 2 : 1
			const ccPicked = new Set<string>()
			while (ccPicked.size < ccPickCount) {
				ccPicked.add(weightedPick(u.ccModels.map((m) => ({ item: m.model, w: m.w }))))
			}
			const ccModels = Array.from(ccPicked)
			const ccSplitRatios = ccModels.map(() => Math.random())
			const ccSplitSum = ccSplitRatios.reduce((a, b) => a + b, 0) || 1
			ccModels.forEach((model, idx) => {
				const modelCents = Math.round(ccCents * (ccSplitRatios[idx] / ccSplitSum))
				if (modelCents <= 0) return
				const tokensPerK = CENTS_PER_KTOK[model] ?? 30
				const totalTokens = Math.round((modelCents / tokensPerK) * 1000)
				// Distribute total tokens into input/output/cache buckets
				const input = Math.round(totalTokens * (0.3 + Math.random() * 0.2))
				const output = Math.round(totalTokens * (0.2 + Math.random() * 0.2))
				const cacheRead = Math.round(totalTokens * (0.1 + Math.random() * 0.2))
				const cacheCreate = Math.max(0, totalTokens - input - output - cacheRead)
				ccRows.push({
					date,
					email: u.email,
					model,
					uncachedInputTokens: input,
					cacheReadInputTokens: cacheRead,
					cacheCreation5mTokens: cacheCreate,
					cacheCreation1hTokens: 0,
					outputTokens: output,
					attributedCents: modelCents,
				})
			})

			// Cursor — pick 1–3 models
			const cuPickCount = 1 + Math.floor(Math.random() * 3)
			const cuPicked = new Set<string>()
			while (cuPicked.size < cuPickCount) {
				cuPicked.add(weightedPick(u.cuModels.map((m) => ({ item: m.model, w: m.w }))))
			}
			const cuModels = Array.from(cuPicked)
			const cuSplitRatios = cuModels.map(() => Math.random())
			const cuSplitSum = cuSplitRatios.reduce((a, b) => a + b, 0) || 1
			cuModels.forEach((model, idx) => {
				const modelCents = Math.round(cuCents * (cuSplitRatios[idx] / cuSplitSum))
				if (modelCents <= 0) return
				const tokensPerK = CENTS_PER_KTOK[model] ?? 30
				const totalTokens = Math.round((modelCents / tokensPerK) * 1000)
				const input = Math.round(totalTokens * (0.3 + Math.random() * 0.2))
				const output = Math.round(totalTokens * (0.2 + Math.random() * 0.2))
				const cacheRead = Math.round(totalTokens * (0.1 + Math.random() * 0.2))
				const cacheWrite = Math.max(0, totalTokens - input - output - cacheRead)
				cuRows.push({
					date,
					email: u.email,
					model,
					inputTokens: input,
					outputTokens: output,
					cacheReadTokens: cacheRead,
					cacheWriteTokens: cacheWrite,
					chargedCents: modelCents,
					requestCount: 1 + Math.floor(Math.random() * 20),
				})
			})

			// GitHub activity
			const openedChance = u.persona === "power" ? 0.35 : u.persona === "heavy" ? 0.2 : 0.08
			const mergedChance = u.persona === "power" ? 0.3 : u.persona === "heavy" ? 0.15 : 0.06
			const prsOpened = Math.random() < openedChance ? (Math.random() < 0.15 ? 2 : 1) : 0
			const prsMerged = Math.random() < mergedChance ? (Math.random() < 0.15 ? 2 : 1) : 0

			const baseGithubActivity = Math.floor(rand(1, 10))
			const additions = baseGithubActivity * Math.floor(rand(25, 120))
			const deletions = Math.floor(additions * rand(0.1, 0.4))

			ghRows.push({
				date,
				email: u.email,

				prsOpened,
				prsMerged,
				additions,
				deletions,
			})
		}
	}

	// Batch upserts (Postgres default param limit is ~32k; chunk to be safe)
	await batchUpsert(dailyClaudeCodeAttribution, ccRows, "claude_code")
	await batchUpsert(dailyCursorUsage, cuRows, "cursor")
	await batchUpsert(dailyGithubActivity, ghRows, "github")

	console.log(
		`[seed:demo] done — ${users.length} users, ${ccRows.length} claude_code rows, ${cuRows.length} cursor rows, ${ghRows.length} github rows`,
	)
	console.log(`[seed:demo] open http://localhost:3003 to see the populated dashboard`)
}

async function batchUpsert<T>(
	table: typeof dailyClaudeCodeAttribution | typeof dailyCursorUsage | typeof dailyGithubActivity,
	rows: T[],
	label: string,
): Promise<void> {
	const CHUNK = 500
	for (let i = 0; i < rows.length; i += CHUNK) {
		const slice = rows.slice(i, i + CHUNK)
		if (slice.length === 0) continue
		const conflictTarget =
			table === dailyClaudeCodeAttribution
				? [
						dailyClaudeCodeAttribution.date,
						dailyClaudeCodeAttribution.email,
						dailyClaudeCodeAttribution.model,
					]
				: table === dailyCursorUsage
					? [dailyCursorUsage.date, dailyCursorUsage.email, dailyCursorUsage.model]
					: [dailyGithubActivity.date, dailyGithubActivity.email]

		await db
			.insert(table as never)
			.values(slice as never)
			.onConflictDoUpdate({
				target: conflictTarget as never,
				set: { syncedAt: new Date() },
			})
	}
	console.log(`[seed:demo]   upserted ${rows.length} ${label} rows`)
}

async function main(): Promise<void> {
	if (process.argv.includes("--reset")) {
		await reset()
	}
	await seed()
}

if (import.meta.main) {
	main()
		.then(() => pool.end())
		.catch((err) => {
			console.error("[seed:demo] FAILED", err)
			pool.end()
			process.exit(1)
		})
}
