import { describe, expect, it } from "bun:test"
import { GitHubClient } from "./github"
import { fetchWithRetry } from "./http-transport"

const noopSleep = async (_ms: number) => {}

describe("http-transport", () => {
	it("retries 429 honoring Retry-After and stops on non-retryable 4xx", async () => {
		let calls = 0
		const delays: number[] = []
		const res = await fetchWithRetry(
			"https://example.test/api",
			{ method: "GET" },
			{
				label: "test",
				fetchFn: (async () => {
					calls++
					return calls === 1
						? new Response("rate limited", { status: 429, headers: { "retry-after": "3" } })
						: new Response("ok", { status: 200 })
				}) as unknown as typeof fetch,
				sleepFn: async (ms) => {
					delays.push(ms)
				},
			},
		)
		expect(res.status).toBe(200)
		expect(delays).toEqual([3000])

		let authCalls = 0
		const unauth = await fetchWithRetry(
			"https://example.test/api",
			{ method: "GET" },
			{
				label: "test",
				fetchFn: (async () => {
					authCalls++
					return new Response("unauthorized", { status: 401 })
				}) as unknown as typeof fetch,
				sleepFn: noopSleep,
			},
		)
		expect(unauth.status).toBe(401)
		expect(authCalls).toBe(1)
	})

	it("does not retry when caller AbortSignal is already aborted", async () => {
		let calls = 0
		const controller = new AbortController()
		controller.abort(new Error("cancelled"))

		await expect(
			fetchWithRetry(
				"https://example.test/api",
				{ method: "GET", signal: controller.signal },
				{
					label: "test",
					fetchFn: (async () => {
						calls++
						throw new Error("AbortError")
					}) as unknown as typeof fetch,
					sleepFn: noopSleep,
				},
			),
		).rejects.toThrow("AbortError")
		expect(calls).toBe(1)
	})

	it("GitHubClient fails immediately on permission 403 but retries rate-limit 403 (capped)", async () => {
		let permCalls = 0
		const badClient = new GitHubClient("ghp_bad", {
			fetchFn: (async () => {
				permCalls++
				return new Response("Forbidden", {
					status: 403,
					headers: { "x-ratelimit-remaining": "4999" },
				})
			}) as unknown as typeof fetch,
			sleepFn: noopSleep,
		})
		await expect(badClient.validateCredentials("acme")).rejects.toThrow("GitHub API 403")
		expect(permCalls).toBe(1)

		let rlCalls = 0
		const delays: number[] = []
		const resetEpoch = Math.floor(Date.now() / 1000) + 120
		const okClient = new GitHubClient("ghp_ok", {
			fetchFn: (async () => {
				rlCalls++
				return rlCalls === 1
					? new Response("Rate limit", {
							status: 403,
							headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetEpoch) },
						})
					: new Response(JSON.stringify({ login: "acme" }), { status: 200 })
			}) as unknown as typeof fetch,
			sleepFn: async (ms) => {
				delays.push(ms)
			},
		})
		await okClient.validateCredentials("acme")
		expect(rlCalls).toBe(2)
		expect(delays).toEqual([60_000])
	})
})
