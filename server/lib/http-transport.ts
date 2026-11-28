export interface TransportDeps {
	fetchFn?: typeof fetch
	sleepFn?: (ms: number) => Promise<void>
}

export interface RetryPolicy extends TransportDeps {
	label: string
	timeoutMs?: number
	baseDelayMs?: number
	maxDelayMs?: number
	maxRetries429?: number
	maxRetries5xx?: number
	maxRetriesNetwork?: number
	retryableStatuses?: ReadonlySet<number>
	/** Optional guard to narrow retryable responses (e.g., only retry GitHub 403 on rate-limit headers). */
	shouldRetry?: (res: Response) => boolean
	/** Return custom delay in ms for a retryable response (or null to use Retry-After / backoff). */
	computeRetryDelay?: (res: Response, attempt: number) => number | null
}

const DEFAULT_RETRYABLE = new Set([429, 500, 502, 503, 504])

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Parse RFC 7231 `Retry-After` (delta-seconds or HTTP-date) into ms, capped at `capMs`. */
export function parseRetryAfter(value: string | null, capMs = 60_000): number | null {
	if (!value) return null
	const trimmed = value.trim()
	if (!trimmed) return null
	if (/^\d+$/.test(trimmed)) {
		const secs = Number.parseInt(trimmed, 10)
		return Number.isFinite(secs) && secs >= 0 ? Math.min(secs * 1000, capMs) : null
	}
	const dateMs = Date.parse(trimmed)
	if (!Number.isFinite(dateMs)) return null
	const delta = dateMs - Date.now()
	return delta > 0 ? Math.min(delta, capMs) : null
}

/** Shared resilient HTTP fetch with timeout, Retry-After, exponential backoff, and injectable transport. */
export async function fetchWithRetry(
	url: string,
	init: RequestInit,
	policy: RetryPolicy,
): Promise<Response> {
	const doFetch = policy.fetchFn ?? fetch
	const doSleep = policy.sleepFn ?? sleep
	const timeoutMs = policy.timeoutMs ?? 30_000
	const baseDelayMs = policy.baseDelayMs ?? 1000
	const maxDelayMs = policy.maxDelayMs ?? 60_000
	const max429 = policy.maxRetries429 ?? 5
	const max5xx = policy.maxRetries5xx ?? 3
	const maxNet = policy.maxRetriesNetwork ?? 3
	const retryable = policy.retryableStatuses ?? DEFAULT_RETRYABLE

	const backoff = (attempt: number) => Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)

	let a429 = 0
	let a5xx = 0
	let aNet = 0

	while (true) {
		let res: Response
		try {
			const timeoutSignal = AbortSignal.timeout(timeoutMs)
			const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
			res = await doFetch(url, { ...init, signal })
		} catch (err) {
			if (init.signal?.aborted || aNet >= maxNet) throw err
			aNet++
			const waitMs = backoff(aNet)
			const msg = err instanceof Error ? err.message : String(err)
			console.warn(
				`[${policy.label}] network error (${msg}) — retry ${aNet}/${maxNet} in ${Math.round(waitMs / 1000)}s`,
			)
			await doSleep(waitMs)
			continue
		}

		if (res.ok || !retryable.has(res.status) || (policy.shouldRetry && !policy.shouldRetry(res))) {
			return res
		}

		const isRateLimit = res.status === 429 || res.status === 403
		if (isRateLimit) {
			if (a429 >= max429) return res
			a429++
			const custom = policy.computeRetryDelay?.(res, a429)
			const waitMs =
				(custom != null ? Math.min(custom, maxDelayMs) : null) ??
				parseRetryAfter(res.headers.get("retry-after"), maxDelayMs) ??
				backoff(a429)
			await res.body?.cancel().catch(() => {})
			console.warn(
				`[${policy.label}] HTTP ${res.status} — retry ${a429}/${max429} in ${Math.round(waitMs / 1000)}s`,
			)
			await doSleep(waitMs)
			continue
		}

		if (a5xx >= max5xx) return res
		a5xx++
		const custom = policy.computeRetryDelay?.(res, a5xx)
		const waitMs =
			(custom != null ? Math.min(custom, maxDelayMs) : null) ??
			parseRetryAfter(res.headers.get("retry-after"), maxDelayMs) ??
			backoff(a5xx)
		await res.body?.cancel().catch(() => {})
		console.warn(
			`[${policy.label}] HTTP ${res.status} — retry ${a5xx}/${max5xx} in ${Math.round(waitMs / 1000)}s`,
		)
		await doSleep(waitMs)
	}
}
