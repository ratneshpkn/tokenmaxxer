/**
 * Universal LLM client for PR classification and enrichment.
 * Supports Anthropic, OpenAI, and custom OpenAI-compatible proxy endpoints.
 */

export interface PREnrichmentInput {
	repo: string
	number: number
	title: string
	body?: string | null
	additions?: number
	deletions?: number
}

export interface PREnrichmentResult {
	repo: string
	number: number
	category: "bug_fix" | "feature" | "refactor" | "docs" | "infrastructure" | "other"
	complexityScore: number // 1 to 5
	complexityReason: string
	summary: string
}

export interface LLMConfig {
	provider: "anthropic" | "openai" | "openai_compatible"
	apiKey: string
	modelName: string
	baseUrl?: string | null
}

const SYSTEM_PROMPT = `You are a senior software engineering analyst classifying Pull Requests.

## Input Schema
The input will be a JSON array of objects, each containing:
- "repo": repository name string
- "number": pull request number
- "title": pull request title
- "body": pull request description (may be truncated)
- "linesChanged": total lines changed (additions + deletions)

For each PR in the input array, produce an object with these exact output fields:
- "repo": copy verbatim from the input
- "number": copy verbatim from the input
- "category": exactly one of the values below
- "complexityScore": integer 1–5 per the rubric below
- "complexityReason": one sentence justifying the score
- "summary": one sentence describing what the PR does (not the title — rephrase for clarity)

## Category definitions
- "bug_fix": Fixes incorrect behavior, crashes, regressions, or security vulnerabilities.
- "feature": Adds new user-facing or developer-facing functionality.
- "refactor": Restructures existing code without changing external behavior (renames, extractions, pattern changes).
- "docs": Changes only documentation, comments, READMEs, or changelogs.
- "infrastructure": CI/CD pipelines, build configs, dependency bumps, tooling, linting rules, Dockerfiles.
- "other": Anything that doesn't clearly fit the above (e.g. reverts, merge commits, license changes).

When a PR spans multiple categories, pick the one that best describes the *primary intent*.

## Complexity rubric
Complexity balances *intellectual difficulty* with *implementation scope and code footprint*.

Ask: How hard is this to design, implement, review, and verify? What is the scope of changes and blast radius if it breaks?

- **Small Diff Rule (<= 5 lines)**: Small diffs (<= 5 lines changed, e.g. 1-file bug fixes, parameter tweaks, minor admin edits, logging, typos, or version bumps) belong in **Score 1 (Minor)** by default. They should ONLY move to **Score 2** if they involve a multi-file dependency or non-trivial logic change, and max out at **Score 3** for rare high-risk concurrency/security fixes. Small-line PRs (<= 5 lines) should NEVER be scored 4 or 5.
- **Score 4 & 5 Guidance**: Scores 4 and 5 should be actively awarded whenever a PR delivers a major feature, new subsystem capability, multi-component refactor, core API/service integration, or key architectural addition.

1 = Minor: Default score for small diffs (<= 5 lines), 1-file bug fixes with straightforward logic, low-risk tweaks, documentation, typos, version bumps, cosmetic UI edits, logging/text additions, basic parameter adjustments, or simple config updates.
2 = Routine: Multi-file routine development following established patterns (e.g., adding a standard field across model + API + view, standard component additions, or typical multi-file bug fixes).
3 = Moderate: Substantive feature development or multi-component additions. Non-trivial bug fixes, workflow adjustments, or service/DB integrations.
4 = Substantive (~10-12% target): Major multi-component features, key API additions, state/concurrency handling, complex data model migrations, or significant refactors across modules.
5 = Major / Heavy (~4-5% target): Primary subsystem features, core framework/pipeline capabilities, heavy multi-file feature implementations, breaking API redesigns, or high-impact system additions.

## Automated / generated change guidance
Many PRs have large diffs that do NOT reflect real engineering complexity. Score these LOW (1–3) regardless of line count:
- Greenfield scaffolding / repository bootstrapping: Initial project setup, boilerplate creation, or app scaffolding should be scored **Score 2 or 3** (not 5) unless introducing novel, complex algorithmic systems.
- Benchmark datasets & test fixtures: Adding evaluation benchmarks, mock datasets, or test fixture suites should be scored **Score 2 or 3** (not 4 or 5) despite large line counts.
- Lockfile updates (package-lock.json, yarn.lock, bun.lock, Gemfile.lock, poetry.lock, go.sum)
- Dependency version bumps from bots (Dependabot, Renovate, Snyk)
- Auto-generated code (protobuf stubs, OpenAI clients, GraphQL codegen, ORM migrations)
- Bulk formatting or linting fixes (Prettier, ESLint, Biome, Black, gofmt)
- Snapshot file updates (.snap, __snapshots__)
- Copy/paste of vendor or third-party code
Look at the title and body for signals like "chore:", "deps:", "bump", "generated", "auto-format", bot author names, or mentions of lockfiles.

## Example Output
[
  {
    "repo": "instawork",
    "number": 1432,
    "category": "infrastructure",
    "complexityScore": 1,
    "complexityReason": "Dependabot version bump for a minor library with no logic changes.",
    "summary": "Updates the lodash dependency to version 4.17.21."
  }
]

## Rules
- **Input Schema:** The input will be an array of objects containing repo, number, title, body, and linesChanged. The PR body may be truncated; base your analysis only on the provided text.
- **Line Counts:** Use linesChanged to enforce the Small Diff Rule (<= 5 lines). However, never assume a high line count equals a high complexity score (see Automated Changes guidance).
- **Formatting:** Return ONLY a raw JSON array. Do not wrap the response in markdown code fences (\`\`\`json), do not include a preamble, and do not include conversational text.
- **Completeness:** Every PR in the input array must have exactly one corresponding output object, in the exact same order.`

export async function classifyPRBatch(
	prs: PREnrichmentInput[],
	config: LLMConfig,
): Promise<PREnrichmentResult[]> {
	if (prs.length === 0) return []
	if (!config.apiKey || !config.modelName) {
		throw new Error("Enrichment API key and model name are required.")
	}

	const prPayload = prs.map((pr) => ({
		repo: pr.repo,
		number: pr.number,
		title: pr.title,
		body: (pr.body || "").slice(0, 1500), // truncate very long bodies
		linesChanged: (pr.additions ?? 0) + (pr.deletions ?? 0),
	}))

	const userMessage = JSON.stringify(prPayload)

	if (config.provider === "anthropic") {
		return classifyWithAnthropic(userMessage, config)
	}
	return classifyWithOpenAI(userMessage, config)
}

async function classifyWithAnthropic(
	userContent: string,
	config: LLMConfig,
): Promise<PREnrichmentResult[]> {
	const baseUrl = config.baseUrl?.trim() || "https://api.anthropic.com"
	const url = `${baseUrl.replace(/\/+$/, "")}/v1/messages`

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"x-api-key": config.apiKey,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: config.modelName,
			max_tokens: 2048,
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: userContent }],
		}),
	})

	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Anthropic LLM error (${res.status}): ${text.slice(0, 300)}`)
	}

	const data = (await res.json()) as { content?: Array<{ type: string; text: string }> }
	const textResponse = data.content?.find((c) => c.type === "text")?.text || ""
	return parseJSONResult(textResponse)
}

async function classifyWithOpenAI(
	userContent: string,
	config: LLMConfig,
): Promise<PREnrichmentResult[]> {
	const baseUrl = config.baseUrl?.trim() || "https://api.openai.com/v1"
	const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`

	const res = await fetch(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: config.modelName,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userContent },
			],
		}),
	})

	if (!res.ok) {
		const text = await res.text()
		throw new Error(`OpenAI LLM error (${res.status}): ${text.slice(0, 300)}`)
	}

	const data = (await res.json()) as {
		choices?: Array<{ message?: { content: string } }>
	}
	const textResponse = data.choices?.[0]?.message?.content || ""
	return parseJSONResult(textResponse)
}

function parseJSONResult(raw: string): PREnrichmentResult[] {
	let jsonStr = raw.trim()
	// Strip markdown code block wrappers if present
	if (jsonStr.startsWith("```")) {
		jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
	}
	try {
		const parsed = JSON.parse(jsonStr)
		const list = Array.isArray(parsed) ? parsed : parsed.results || parsed.prs || []
		return list.map((item: Partial<PREnrichmentResult>) => ({
			repo: String(item.repo || ""),
			number: Number(item.number || 0),
			category: sanitizeCategory(item.category),
			complexityScore: Math.min(5, Math.max(1, Number(item.complexityScore || 3))),
			complexityReason: String(item.complexityReason || "No explanation provided."),
			summary: String(item.summary || ""),
		}))
	} catch (_err) {
		console.error("[enrichment-llm] Failed to parse JSON LLM response:", raw)
		return []
	}
}

function sanitizeCategory(
	raw?: string,
): "bug_fix" | "feature" | "refactor" | "docs" | "infrastructure" | "other" {
	const valid = ["bug_fix", "feature", "refactor", "docs", "infrastructure", "other"]
	const norm = (raw || "").toLowerCase().trim()
	if (valid.includes(norm)) {
		return norm as "bug_fix" | "feature" | "refactor" | "docs" | "infrastructure" | "other"
	}
	if (norm.includes("bug") || norm.includes("fix")) return "bug_fix"
	if (norm.includes("feat")) return "feature"
	if (norm.includes("refactor")) return "refactor"
	if (norm.includes("doc")) return "docs"
	if (norm.includes("infra") || norm.includes("ci")) return "infrastructure"
	return "other"
}
