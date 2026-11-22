/** GitHub REST API client for syncing org-level code output data.
 *  Follows the same class pattern as AnthropicAdminClient / CursorAdminClient:
 *  constructor takes token, methods return typed data, built-in pagination. */

import type { PRFileCache } from "@shared/schema"
import { toLocalDateStr } from "../scripts/lib/shared"
import { isBlacklistedPatchFile } from "./enrichment-llm"
import { fetchWithRetry, sleep, type TransportDeps } from "./http-transport"

export { sleep }

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

const GITHUB_RETRYABLE = new Set([403, 429, 500, 502, 503, 504])

export class GitHubClient {
	private headers: Record<string, string>

	constructor(
		token: string,
		private deps?: TransportDeps,
	) {
		this.headers = {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "tokenmaxxer/1.0",
		}
	}

	private fetchWithRetry(url: string): Promise<Response> {
		return fetchWithRetry(
			url,
			{ headers: this.headers },
			{
				label: "GitHubClient",
				baseDelayMs: 5000,
				maxDelayMs: 60_000,
				maxRetries429: 5,
				maxRetries5xx: 5,
				maxRetriesNetwork: 5,
				retryableStatuses: GITHUB_RETRYABLE,
				shouldRetry: (res) =>
					res.status !== 403 ||
					res.headers.get("x-ratelimit-remaining") === "0" ||
					res.headers.has("retry-after"),
				computeRetryDelay: (res) => {
					if (res.status !== 403 && res.status !== 429) return null
					if (res.headers.get("x-ratelimit-remaining") === "0") {
						const reset = Number.parseInt(res.headers.get("x-ratelimit-reset") ?? "", 10)
						if (Number.isFinite(reset)) {
							const delta = reset * 1000 - Date.now() + 1000
							if (delta > 0) return delta
						}
					}
					return null
				},
				...this.deps,
			},
		)
	}

	async validateCredentials(org: string): Promise<void> {
		await this.fetchJson<Record<string, unknown>>(`${GITHUB_API}/orgs/${encodeURIComponent(org)}`)
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
				await (this.deps?.sleepFn ?? sleep)(2000)
			}
		}
		return results
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
				await (this.deps?.sleepFn ?? sleep)(2000)
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

	/** Get the changed-file list (filename, additions, deletions, status, and patch) for a single PR.
	 *  Full patch content is preserved for all files except those matched by `isBlacklistedPatchFile`.
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
		return raw.map((f) => {
			const filename = f.filename as string
			const previousFilename =
				typeof f.previous_filename === "string" ? f.previous_filename : undefined
			const patch =
				typeof f.patch === "string" && !isBlacklistedPatchFile(filename) ? f.patch : null
			return {
				filename,
				...(previousFilename ? { previousFilename } : {}),
				additions: (f.additions as number) ?? 0,
				deletions: (f.deletions as number) ?? 0,
				status: (f.status as string) ?? "modified",
				patch,
			}
		})
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Parse the `rel="next"` URL from a GitHub Link header. */
function parseLinkNext(header: string): string | null {
	const match = header.match(/<([^>]+)>;\s*rel="next"/)
	return match?.[1] ?? null
}
