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
	/** File paths touched, capped to the largest N by lines changed. */
	filePaths?: string[]
	/** Lines changed (additions + deletions) after excluding lockfiles/generated/vendor/test/doc files. */
	effLinesChanged?: number
	/** File count after the same exclusion. */
	effFiles?: number
	/** Count of distinct architectural layers touched (api/service/data/etc). */
	breadth?: number
	/** Count of distinct source-code languages touched. */
	langSpan?: number
	/** True when the diff is dominated by generated/vendored content or pure renames. */
	mechanical?: boolean
	/** True when the diff touches auth/payment/security/billing paths. */
	sensitive?: boolean
	/** What the diff consists of — distinguishes generated bulk from tests/docs. */
	contentKind?: "code" | "tests-or-docs-only" | "generated-or-vendored" | "empty"
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
- "filePaths": file paths touched (capped to the largest by lines changed; may be a partial list on huge PRs)
- "effLinesChanged": lines changed (additions + deletions, same basis as "linesChanged") AFTER excluding lockfiles, generated code, vendored code, tests, and docs — a computed value, not a guess
- "effFiles": file count after the same exclusion
- "breadth": number of distinct architectural layers touched (api/service/data/workflow/frontend/infra/mobile) — computed from file paths
- "langSpan": number of distinct source-code languages touched — computed from file extensions
- "mechanical": boolean, true when the diff is dominated by generated/vendored content or pure file moves — computed, not a guess
- "sensitive": boolean, true when the diff touches auth/payment/security/billing paths — computed, not a guess
- "contentKind": one of "code", "tests-or-docs-only", "generated-or-vendored", "empty" — what the diff actually consists of, computed from file paths

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

## Complexity rubric: effort to competently produce this change

Ask one question: how much skilled engineering time would this take — design, implementation, review, and verification included? A 5 should represent real time and effort from a strong engineer. A 1 should be something almost anyone could do quickly.

**Trust the computed fields over guesswork.** Do not infer "this is probably generated" or "this is probably a big feature" from the title alone — "mechanical", "contentKind", "effLinesChanged", "effFiles", "breadth", and "sensitive" are computed from the actual file list, not estimated. If "mechanical" is true, the effort is low regardless of "linesChanged" or how the title reads.

**Size is neutral, not automatically high or low:**
- A large "linesChanged" with "mechanical": true (lockfiles, vendored code, generated stubs, pure file moves) reflects near-zero effort — score 1-2 no matter how many lines it touches.
- A large "effLinesChanged" that also spans several layers ("breadth" >= 3) or touches sensitive systems reflects real effort — do not cap it just because it's big.
- A tiny diff is not automatically low effort: a 10-line fix to a real concurrency, security, or data-correctness bug can be a 4, while a 10-line typo fix is a 1. Judge what the change is actually doing, not just its size.

**"contentKind" tells you what you're looking at when "effFiles" is 0:**
- "generated-or-vendored": no hand-written source at all — score 1.
- "tests-or-docs-only": no product code, but the tests or docs themselves may be substantial work. Judge them on their merit — a large hand-written test suite or a real design document is typically 2-3, NOT 1. Only score 1 if the change is genuinely trivial (a typo fix, a one-line assertion tweak).
- "empty": no files — score 1.

1 = Minor: near-zero effort. Config/default tweaks, typos, one-line bug fixes with obvious causes, cosmetic edits, or a diff flagged "mechanical" (lockfiles, generated code, pure file moves) regardless of its raw line count.
2 = Routine: mechanical-but-curated bulk work (e.g. vendoring a dependency and deciding what to keep), substantial test or documentation work, OR straightforward multi-file changes following an established pattern (adding a standard field across model + API + view, a typical CRUD endpoint, a routine bug fix).
3 = Moderate: substantive feature work or a multi-file change requiring real judgment — non-trivial business logic with edge cases, an investigated bug fix, a behavior-preserving refactor, or a conventional new service/module that is bigger but not architecturally novel.
4 = Substantive: multi-component features spanning several layers or systems, non-obvious algorithms, concurrency/state handling, complex data model changes, or significant cross-module refactors. Use this for both "big and touches many layers" and "small but requires real expertise" changes.
5 = Major: primary subsystem or platform-level work, core framework/pipeline capabilities, breaking API/architecture redesigns, or a small change that most engineers would need significant time to get right (e.g. a subtle concurrency/security fix). Reserve this for genuinely high-effort or high-expertise work, not just "large diff."

## Anchor examples
- A 20,000-line diff that is 95% an autogenerated GraphQL client ("mechanical": true) → complexityScore 1, regardless of the impressive-sounding title.
- A 15-line fix that resolves a real lock-ordering deadlock ("effFiles": 1, "mechanical": false) → complexityScore 4: small diff, real expertise required.
- A 3,000-line PR adding a standard CRUD resource (model + API + one UI page, "breadth": 2, no unusual logic) → complexityScore 2-3, not 5: familiar shape, just more of it.
- A 2,000-line PR introducing a new subsystem that spans API, service, data, and workflow layers ("breadth" >= 3) with non-trivial state handling → complexityScore 4-5.
- An 800-line hand-written test suite ("contentKind": "tests-or-docs-only", "effFiles": 0) → complexityScore 2-3, not 1: no product code, but real work.

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
- The PR body may be truncated; base your analysis only on the provided text and computed fields.
- Never assume a high "linesChanged" equals a high complexity score — always check "mechanical" and "effLinesChanged" first.
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
		filePaths: pr.filePaths ?? [],
		effLinesChanged: pr.effLinesChanged,
		effFiles: pr.effFiles,
		breadth: pr.breadth,
		langSpan: pr.langSpan,
		mechanical: pr.mechanical,
		sensitive: pr.sensitive,
		contentKind: pr.contentKind,
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
