import { trackedUsers } from "@shared/schema"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../db"
import { GitHubClient, sleep } from "./github"

export async function discoverGithubUsernames(client: GitHubClient, org: string, token: string): Promise<Map<string, string>> {
	const newlyMapped = new Map<string, string>() // login -> email

	const unmapped = await db
		.select({ email: trackedUsers.email, name: trackedUsers.name })
		.from(trackedUsers)
		.where(and(eq(trackedUsers.isActive, true), isNull(trackedUsers.githubUsername)))

	if (unmapped.length === 0) {
		return newlyMapped
	}

	console.log(`[github-discovery] ${unmapped.length} active users missing github_username — starting discovery...`)

	const alreadyMapped = await db
		.select({ githubUsername: trackedUsers.githubUsername })
		.from(trackedUsers)
		.where(eq(trackedUsers.isActive, true))

	const takenLogins = new Set(alreadyMapped.filter((r) => r.githubUsername).map((r) => r.githubUsername!.toLowerCase()))
	const unmappedEmails = new Set(unmapped.map((u) => u.email.toLowerCase()))
	const emailToUser = new Map(unmapped.map((u) => [u.email.toLowerCase(), u]))
	const emailPrefixToUser = new Map(unmapped.map((u) => [u.email.split("@")[0].toLowerCase().replace(/[._+-]/g, ""), u]))
	const cleanNameToUser = new Map(unmapped.filter(u => u.name).map(u => [u.name!.toLowerCase().replace(/\s+/g, ""), u]))

	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "tokenmaxxer/1.0",
	}

	const orgMembers = await client.listOrgMembers(org)
	const availableMembers = orgMembers.filter((m) => !takenLogins.has(m.login.toLowerCase()))

	// ── 1. Fast match: Name or Prefix heuristics ──
	for (const member of availableMembers) {
		const login = member.login.toLowerCase()
		if (takenLogins.has(login) || newlyMapped.has(login)) continue

		const cleanLogin = login.replace(/[._-]/g, "")
		
		const byPrefix = emailPrefixToUser.get(cleanLogin)
		if (byPrefix && !newlyMapped.has(login)) {
			newlyMapped.set(member.login, byPrefix.email)
			emailPrefixToUser.delete(cleanLogin)
			continue
		}

		const byName = cleanNameToUser.get(cleanLogin)
		if (byName && !newlyMapped.has(login)) {
			newlyMapped.set(member.login, byName.email)
			cleanNameToUser.delete(cleanLogin)
			continue
		}

		// Heuristics (firstlast, etc.)
		for (const u of unmapped) {
			if (!u.name) continue
			const parts = u.name.toLowerCase().split(/\s+/)
			if (parts.length < 2) continue
			const first = parts[0]
			const last = parts[parts.length - 1]

			if (
				login === `${first}${last}` ||
				login === `${first}-${last}` ||
				login === `${first}.${last}` ||
				login === `${first}${last[0]}` ||
				login === `${first}-${last[0]}` ||
				login === `${first[0]}${last}`
			) {
				// verify the email isn't already matched
				if (Array.from(newlyMapped.values()).includes(u.email)) continue
				newlyMapped.set(member.login, u.email)
				break
			}
		}
	}

	// ── 2. Medium match: Public Profile Email ──
	for (const member of availableMembers) {
		const login = member.login.toLowerCase()
		if (takenLogins.has(login) || newlyMapped.has(login)) continue

		try {
			const res = await fetch(`https://api.github.com/users/${member.login}`, { headers })
			if (!res.ok) continue
			const profile = (await res.json()) as { email?: string }
			if (profile.email) {
				const pubEmail = profile.email.toLowerCase()
				if (unmappedEmails.has(pubEmail) && !Array.from(newlyMapped.values()).includes(pubEmail)) {
					newlyMapped.set(member.login, pubEmail)
				}
			}
		} catch {
			// skip
		}
	}

	// ── 3. Slow match: Commit history scanning ──
	// Scan repos for actual commit email -> author login mapping
	const remainingEmails = new Set(Array.from(unmappedEmails).filter(e => !Array.from(newlyMapped.values()).includes(e)))
	if (remainingEmails.size > 0) {
		console.log(`[github-discovery] ${remainingEmails.size} users still unmapped. Scanning recent commits...`)
		try {
			const allRepos = await client.listOrgRepos(org)
			const sixMonthsAgo = new Date()
			sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
			const cutoff = sixMonthsAgo.toISOString().slice(0, 10)

			const activeRepos = allRepos.filter((r) => !r.archived && r.pushedAt && r.pushedAt.slice(0, 10) >= cutoff)

			// Try to find exact email -> login mapping from commits
			for (const repo of activeRepos) {
				if (remainingEmails.size === 0) break // early exit

				try {
					const since = sixMonthsAgo.toISOString()
					const url = `https://api.github.com/repos/${org}/${repo.name}/commits?since=${since}&per_page=100`
					const res = await fetch(url, { headers })
					if (!res.ok) continue
					const commits = (await res.json()) as Array<{
						author?: { login: string }
						commit: { author?: { email?: string } }
					}>

					for (const c of commits) {
						const login = c.author?.login
						const email = c.commit?.author?.email?.toLowerCase()
						if (!login || !email) continue
						
						if (remainingEmails.has(email) && !takenLogins.has(login.toLowerCase()) && !newlyMapped.has(login)) {
							newlyMapped.set(login, email)
							remainingEmails.delete(email)
						}
					}
				} catch {
					// skip
				}
				await sleep(100)
			}
		} catch (err) {
			console.warn(`[github-discovery] Deep commit scan failed: ${err instanceof Error ? err.message : err}`)
		}
	}

	// ── 4. Save newly mapped users ──
	if (newlyMapped.size > 0) {
		for (const [login, email] of newlyMapped) {
			await db
				.update(trackedUsers)
				.set({ githubUsername: login, updatedAt: new Date() })
				.where(eq(trackedUsers.email, email))
		}
		console.log(`[github-discovery] Auto-populated github_username for ${newlyMapped.size} users.`)
	} else {
		console.log(`[github-discovery] No new mappings found.`)
	}

	return newlyMapped
}
