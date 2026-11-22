import type { SyncJob } from "@shared/constants"
import { backfillUserGithub } from "../scripts/backfill-user-github"
import { runComputeAlerts } from "../scripts/compute-alerts"
import { computeRecommendations } from "../scripts/compute-recommendations"
import { runPREnrichment } from "../scripts/enrich-prs"
import { type DateRangeArgs, startSyncRun } from "../scripts/lib/shared"
import { runSlackDigest } from "../scripts/slack-digest"
import { runAnthropicSync } from "../scripts/sync-anthropic"
import { runCursorSync } from "../scripts/sync-cursor"
import { runGithubSync } from "../scripts/sync-github"
import { runPrFilesSync } from "../scripts/sync-pr-files"

export interface SyncDispatchOptions {
	range?: DateRangeArgs
	triggeredBy?: string
	dates?: string[]
	days?: number
	existingRunId?: string
}

export type DispatchResult = { skipped: true } | { skipped: false; runId: string }

export type JobExecutor = (opts: SyncDispatchOptions) => Promise<unknown>

const JOB_REGISTRY: Record<SyncJob, JobExecutor> = {
	anthropic: (o) =>
		runAnthropicSync(o.range, { existingRunId: o.existingRunId, triggeredBy: o.triggeredBy }),
	cursor: (o) =>
		runCursorSync(o.range, { existingRunId: o.existingRunId, triggeredBy: o.triggeredBy }),
	github: (o) =>
		runGithubSync(o.range, { existingRunId: o.existingRunId, triggeredBy: o.triggeredBy }),
	pr_files: (o) => runPrFilesSync({ existingRunId: o.existingRunId, triggeredBy: o.triggeredBy }),
	prs_enrich: (o) =>
		runPREnrichment({ existingRunId: o.existingRunId, triggeredBy: o.triggeredBy, days: o.days }),
	alerts: (o) =>
		runComputeAlerts({
			existingRunId: o.existingRunId,
			triggeredBy: o.triggeredBy,
			dates: o.dates,
		}),
	slack_digest: (o) =>
		runSlackDigest({ existingRunId: o.existingRunId, triggeredBy: o.triggeredBy }),
	recommendations: (o) =>
		computeRecommendations({ existingRunId: o.existingRunId, triggeredBy: o.triggeredBy }),
}

/** Per-job in-process lock preventing overlapping executions of the same sync job. */
export class JobLockRegistry {
	private active = new Set<string>()

	isRunning(job: string): boolean {
		return this.active.has(job)
	}

	tryAcquire(job: string): (() => void) | null {
		if (this.active.has(job)) return null
		this.active.add(job)
		let released = false
		return () => {
			if (!released) {
				released = true
				this.active.delete(job)
			}
		}
	}

	async runExclusive<T>(job: string, fn: () => Promise<T>): Promise<{ ran: boolean; value?: T }> {
		const release = this.tryAcquire(job)
		if (!release) return { ran: false }
		try {
			return { ran: true, value: await fn() }
		} finally {
			release()
		}
	}
}

export function createSyncRunner(
	registry: Record<SyncJob, JobExecutor> = JOB_REGISTRY,
	startRun: (job: SyncJob, triggeredBy?: string) => Promise<string> = startSyncRun,
	locks = new JobLockRegistry(),
) {
	async function runSyncJob(
		job: SyncJob,
		opts: SyncDispatchOptions = {},
		label: string = job,
	): Promise<boolean> {
		try {
			const { ran } = await locks.runExclusive(job, () => registry[job](opts))
			if (!ran) console.warn(`[sync] ${label} skipped — already running`)
			return ran
		} catch (err) {
			console.error(`[sync] ${label} failed`, err)
			return true
		}
	}

	async function dispatchSyncJob(
		job: SyncJob,
		opts: Omit<SyncDispatchOptions, "existingRunId"> = {},
	): Promise<DispatchResult> {
		const release = locks.tryAcquire(job)
		if (!release) return { skipped: true }

		let runId: string
		try {
			runId = await startRun(job, opts.triggeredBy)
		} catch (err) {
			release()
			throw err
		}

		Promise.resolve()
			.then(() => registry[job]({ ...opts, existingRunId: runId }))
			.catch((err) => console.error(`[sync] background ${job} failed`, err))
			.finally(release)

		return { skipped: false, runId }
	}

	async function dispatchUserGithubBackfill(
		email: string,
		githubUsername: string,
		lookbackDays: number,
	): Promise<DispatchResult> {
		const release = locks.tryAcquire("github")
		if (!release) return { skipped: true }

		let runId: string
		try {
			runId = await startRun("github", `user-mapping:${email}`)
		} catch (err) {
			release()
			throw err
		}

		Promise.resolve()
			.then(() => backfillUserGithub(email, githubUsername, lookbackDays, { existingRunId: runId }))
			.catch((err) => console.error(`[sync] user github backfill for ${email} failed`, err))
			.finally(release)

		return { skipped: false, runId }
	}

	return {
		isSyncJobRunning: (job: SyncJob) => locks.isRunning(job),
		runSyncJob,
		dispatchSyncJob,
		dispatchUserGithubBackfill,
	}
}

const defaultRunner = createSyncRunner()
export const { isSyncJobRunning, runSyncJob, dispatchSyncJob, dispatchUserGithubBackfill } =
	defaultRunner
