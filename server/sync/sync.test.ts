import { describe, expect, it } from "bun:test"
import type { SyncJob } from "@shared/constants"
import {
	type DailySpendRow,
	evaluateDailyAlerts,
	type ThresholdLookup,
} from "../scripts/compute-alerts"
import { createSyncRunner, type JobExecutor, JobLockRegistry } from "./runner"

describe("JobLockRegistry & createSyncRunner", () => {
	function makeRegistry(overrides: Partial<Record<SyncJob, JobExecutor>> = {}) {
		const noop: JobExecutor = async () => ({ rowsUpserted: 0 })
		return {
			anthropic: noop,
			cursor: noop,
			github: noop,
			pr_files: noop,
			prs_enrich: noop,
			alerts: noop,
			slack_digest: noop,
			recommendations: noop,
			...overrides,
		}
	}

	it("prevents overlapping runs of the same job while allowing different jobs concurrently", async () => {
		const locks = new JobLockRegistry()
		let releaseFirst!: () => void
		const gate = new Promise<void>((r) => {
			releaseFirst = r
		})

		const p1 = locks.runExclusive("anthropic", async () => {
			await gate
			return "done"
		})
		expect((await locks.runExclusive("anthropic", async () => "nope")).ran).toBe(false)
		expect(await locks.runExclusive("cursor", async () => "ok")).toEqual({ ran: true, value: "ok" })

		releaseFirst()
		expect(await p1).toEqual({ ran: true, value: "done" })
		expect(locks.isRunning("anthropic")).toBe(false)
	})

	it("releases lock when startRun or executor throws synchronously", async () => {
		const failingStart = createSyncRunner(makeRegistry(), async () => {
			throw new Error("db down")
		})
		await expect(failingStart.dispatchSyncJob("anthropic")).rejects.toThrow("db down")
		expect(failingStart.isSyncJobRunning("anthropic")).toBe(false)

		const syncThrow = createSyncRunner(
			makeRegistry({
				cursor: () => {
					throw new Error("sync boom")
				},
			}),
			async () => "run-123",
		)
		expect(await syncThrow.dispatchSyncJob("cursor")).toEqual({ skipped: false, runId: "run-123" })
		await new Promise((r) => setTimeout(r, 10))
		expect(syncThrow.isSyncJobRunning("cursor")).toBe(false)
	})
})

describe("evaluateDailyAlerts", () => {
	it("respects per-user overrides, disabled flags, and strict > threshold", () => {
		const thresholds: ThresholdLookup = {
			global: new Map([
				["claude_code", 5000],
				["cursor", 3000],
			]),
			perUser: new Map([
				["alice@example.com|claude_code", 10_000],
				["muted@example.com|cursor", 1000],
			]),
			perUserEnabled: new Map([
				["alice@example.com|claude_code", true],
				["muted@example.com|cursor", false],
			]),
		}
		const rows: DailySpendRow[] = [
			{ email: "ALICE@example.com", platform: "claude_code", amount_cents: 8000 },
			{ email: "ALICE@example.com", platform: "claude_code", amount_cents: 10_001 },
			{ email: "bob@example.com", platform: "claude_code", amount_cents: 5000 },
			{ email: "bob@example.com", platform: "cursor", amount_cents: 3500 },
			{ email: "muted@example.com", platform: "cursor", amount_cents: 99_999 },
		]

		expect(evaluateDailyAlerts(rows, thresholds)).toEqual([
			{
				email: "ALICE@example.com",
				platform: "claude_code",
				amountCents: 10_001,
				thresholdCents: 10_000,
			},
			{ email: "bob@example.com", platform: "cursor", amountCents: 3500, thresholdCents: 3000 },
		])
	})
})
