/** GitHub REST API client for syncing org-level code output data.
 *  Follows the same class pattern as AnthropicAdminClient / CursorAdminClient:
 *  constructor takes token, methods return typed data, built-in pagination. */

import type { PRFileCache } from "@shared/schema"
import { toLocalDateStr } from "../scripts/lib/shared"

export class GitHubApiError extends Error {
	constructor(
		public status: number,
		public statusText: string,
		public body: string,
	) {
		super(`GitHub API ${status}: ${statusText} – ${body.slice(0, 300)}`)
		this.name = "GitHubApiError"
	}
}

const GITHUB_API = "https://api.github.com"

export interface GitHubRepo {
	id: number
	name: string
	fullName: string
	archived: boolean
	pushedAt: string | null
	defaultBranch: string
}

export interface OrgMember {
	login: string
	id: number
}

export interface SearchPRResult {
	totalCount: number
}

export class GitHubClient {
	private headers: Record<string, string>

	constructor(token: string) {
		this.headers = {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "tokenmaxxer/1.0",
		}
	}

	// ── Retry wrapper ──────────────────────────────────────────────────
	private async fetchWithRetry(url: string): Promise<Response> {
		let retries = 5
		let baseDelay = 5000 // Start with 5s delay

		while (retries > 0) {
			let res: Response
			try {
				res = await fetch(url, { headers: this.headers })
			} catch (err) {
				console.log(
					`[GitHubClient] fetch failed for ${url} (${err instanceof Error ? err.message : err}). Retrying in ${baseDelay / 1000}s...`,
				)
				await sleep(baseDelay)
				baseDelay *= 2
				retries--
				if (retries === 0) throw err
				continue
			}

			if (res.status === 403 || res.status === 429) {
				const remaining = res.headers.get("x-ratelimit-remaining")
				const reset = res.headers.get("x-ratelimit-reset")
				if (remaining === "0" && reset) {
					const resetMs = parseInt(reset, 10) * 1000
					const sleepMs = resetMs - Date.now() + 1000 // Add 1s buffer
					if (sleepMs > 0) {
						console.log(
							`[GitHubClient] Rate limit hit. Sleeping for ${Math.ceil(sleepMs / 1000)}s until reset...`,
						)
						await sleep(sleepMs)
						continue
					}
				}
				const retryAfter = res.headers.get("retry-after")
				if (retryAfter) {
					const sleepMs = parseInt(retryAfter, 10) * 1000 + 1000
					console.log(
						`[GitHubClient] Secondary limit hit. Sleeping for ${Math.ceil(sleepMs / 1000)}s...`,
					)
					await sleep(sleepMs)
					continue
				}

				console.log(`[GitHubClient] 403/429 hit (no reset header). Sleeping for 60s fallback...`)
				await sleep(60000)
				retries--
				continue
			}

			if (res.status >= 500 && res.status < 600) {
				console.log(`[GitHubClient] ${res.status} error. Retrying in ${baseDelay / 1000}s...`)
				await sleep(baseDelay)
				baseDelay *= 2
				retries--
				continue
			}

			return res
		}
		throw new Error(`[GitHubClient] Max retries exceeded for ${url}`)
	}

	// ── Paginated fetch ────────────────────────────────────────────────

	async fetchJson<T>(url: string): Promise<T> {
		const res = await this.fetchWithRetry(url)
		if (!res.ok) {
			const body = await res.text().catch(() => "")
			throw new GitHubApiError(res.status, res.statusText, body)
		}
		return res.json() as Promise<T>
	}

	/** Follows Link rel="next" headers for paginated endpoints. */
	private async fetchAllPages<T>(url: string, perPage = 100): Promise<T[]> {
		const results: T[] = []
		let nextUrl: string | null = `${url}${url.includes("?") ? "&" : "?"}per_page=${perPage}`

		while (nextUrl) {
			const res = await this.fetchWithRetry(nextUrl)
			if (!res.ok) {
				const body = await res.text().catch(() => "")
				throw new GitHubApiError(res.status, res.statusText, body)
			}

			const data = (await res.json()) as T[]
			results.push(...data)

			// Parse Link header for next page
			const linkHeader: string | null = res.headers.get("Link")
			nextUrl = linkHeader ? parseLinkNext(linkHeader) : null
		}
		return results
	}

	// ── Org repos ──────────────────────────────────────────────────────

	async listOrgRepos(org: string): Promise<GitHubRepo[]> {
		const raw = await this.fetchAllPages<Record<string, unknown>>(
			`${GITHUB_API}/orgs/${encodeURIComponent(org)}/repos?type=all`,
		)
		return raw.map((r) => ({
			id: r.id as number,
			name: r.name as string,
			fullName: (r.full_name as string) ?? "",
			archived: (r.archived as boolean) ?? false,
			pushedAt: (r.pushed_at as string) ?? null,
			defaultBranch: (r.default_branch as string) ?? "main",
		}))
	}

	// ── Org members ────────────────────────────────────────────────────

	async listOrgMembers(org: string): Promise<OrgMember[]> {
		const raw = await this.fetchAllPages<Record<string, unknown>>(
			`${GITHUB_API}/orgs/${encodeURIComponent(org)}/members`,
		)
		return raw.map((m) => ({
			login: m.login as string,
			id: m.id as number,
		}))
	}

	// ── PR search ──────────────────────────────────────────────────────

	/** Count PRs matching a search query. Uses the Search API (30 req/min rate limit).
	 *  Returns just the total_count to minimize data transfer. */
	async searchPRCount(query: string): Promise<number> {
		// Search API returns { total_count, items: [...] }
		// We only need the count, so request minimal data with per_page=1
		const url = `${GITHUB_API}/search/issues?q=${encodeURIComponent(query)}&per_page=1`
		const data = await this.fetchJson<{ total_count: number }>(url)
		return data.total_count
	}

	/** Search PRs matching a query and return their dates. Handles pagination. */
	async searchPRDates(query: string, type: "created" | "merged"): Promise<string[]> {
		const results: string[] = []
		let nextUrl: string | null =
			`${GITHUB_API}/search/issues?q=${encodeURIComponent(query)}&per_page=100`

		while (nextUrl) {
			const res = await this.fetchWithRetry(nextUrl)
			if (!res.ok) {
				const body = await res.text().catch(() => "")
				throw new GitHubApiError(res.status, res.statusText, body)
			}
			const data = (await res.json()) as {
				items?: Array<{
					created_at: string
					closed_at: string | null
					pull_request?: { merged_at: string | null }
				}>
			}

			if (!data.items) break

			for (const item of data.items) {
				let dateIso: string | null | undefined = null
				if (type === "created") {
					dateIso = item.created_at
				} else {
					dateIso = item.pull_request?.merged_at || item.closed_at || item.created_at
				}
				if (dateIso) {
					results.push(toLocalDateStr(dateIso))
				}
			}

			const linkHeader = res.headers.get("Link")
			nextUrl = linkHeader ? parseLinkNext(linkHeader) : null
			if (nextUrl) {
				await sleep(2000)
			}
		}
		return results
	}

	/** Get PRs opened by a user in an org on a given date. */
	async countPRsOpened(org: string, username: string, date: string): Promise<number> {
		const query = `type:pr author:${username} org:${org} created:${date}..${date}`
		return this.searchPRCount(query)
	}

	/** Get PRs merged by a user in an org on a given date. */
	async countPRsMerged(org: string, username: string, date: string): Promise<number> {
		const query = `type:pr author:${username} org:${org} is:merged merged:${date}..${date}`
		return this.searchPRCount(query)
	}

	/** Get exact dates of PRs opened by a user in an org in a date range. */
	async getPRsOpenedDates(
		org: string,
		username: string,
		from: string,
		to: string,
	): Promise<string[]> {
		const query = `type:pr author:${username} org:${org} created:${from}..${to}`
		return this.searchPRDates(query, "created")
	}

	/** Get exact details of PRs merged by a user in an org in a date range. */
	async getMergedPRsDetails(
		org: string,
		username: string,
		from: string,
		to: string,
	): Promise<
		Array<{
			repo: string
			number: number
			title: string
			mergedAtDateStr: string
			mergedAtIso: string
		}>
	> {
		const query = `type:pr author:${username} org:${org} is:merged merged:${from}..${to}`
		const results: Array<{
			repo: string
			number: number
			title: string
			mergedAtDateStr: string
			mergedAtIso: string
		}> = []
		let nextUrl: string | null =
			`${GITHUB_API}/search/issues?q=${encodeURIComponent(query)}&per_page=100`

		while (nextUrl) {
			const res = await this.fetchWithRetry(nextUrl)
			if (!res.ok) {
				const body = await res.text().catch(() => "")
				throw new GitHubApiError(res.status, res.statusText, body)
			}
			const data = (await res.json()) as {
				items?: Array<{
					repository_url: string
					number: number
					title: string
					pull_request?: { merged_at: string | null }
				}>
			}

			if (!data.items) break

			for (const item of data.items) {
				const dateIso = item.pull_request?.merged_at
				if (dateIso) {
					// repository_url looks like "https://api.github.com/repos/Instawork/tokenmaxxer"
					const parts = item.repository_url.split("/")
					const repo = parts[parts.length - 1]
					results.push({
						repo,
						number: item.number,
						title: item.title ?? "",
						mergedAtDateStr: toLocalDateStr(dateIso),
						mergedAtIso: dateIso,
					})
				}
			}

			const linkHeader = res.headers.get("Link")
			nextUrl = linkHeader ? parseLinkNext(linkHeader) : null
			if (nextUrl) {
				await sleep(2000)
			}
		}
		return results
	}

	/** Get detailed stats (additions, deletions, body) for a single PR. */
	async getPullRequestDetails(
		owner: string,
		repo: string,
		pullNumber: number,
	): Promise<{ additions: number; deletions: number; body: string | null }> {
		const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`
		return this.fetchJson<{ additions: number; deletions: number; body: string | null }>(url)
	}

	/** Get the changed-file list (filename, additions, deletions, status) for a single PR.
	 *  Patch/diff content in the raw response is intentionally not surfaced here.
	 *  Note: GitHub caps this endpoint at 3000 files, so the list is truncated (not
	 *  an error) for mega-PRs — signals derived from it are approximate in that case. */
	async getPullRequestFiles(
		owner: string,
		repo: string,
		pullNumber: number,
	): Promise<PRFileCache[]> {
		const raw = await this.fetchAllPages<Record<string, unknown>>(
			`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files`,
		)
		return raw.map((f) => ({
			filename: f.filename as string,
			additions: (f.additions as number) ?? 0,
			deletions: (f.deletions as number) ?? 0,
			status: (f.status as string) ?? "modified",
		}))
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Parse the `rel="next"` URL from a GitHub Link header. */
function parseLinkNext(header: string): string | null {
	const match = header.match(/<([^>]+)>;\s*rel="next"/)
	return match?.[1] ?? null
}

/** Sleep for `ms` milliseconds. Used for search API throttling. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
