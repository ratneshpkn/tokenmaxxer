/**
 * Deterministic, file-path-based signals for grounding PR complexity scoring.
 * No diff/patch content is read — only filenames, per-file add/delete counts,
 * and status, so a large generated/vendored/lockfile diff can't masquerade as
 * real effort just because it's large.
 */

import type { PRFileCache } from "@shared/schema"

/** Share of changed lines that must be generated/vendored to call a diff mechanical. */
const MECHANICAL_LINE_FRACTION = 0.7
/** Share of files that must be pure renames to call a diff mechanical. */
const MECHANICAL_RENAME_FRACTION = 0.7
/** A renamed file changing at most this many lines is a pure move, not real editing. */
const PURE_RENAME_MAX_LINES = 2

export interface DiffSignals {
	totalLinesChanged: number
	totalFiles: number
	/** Lines changed (additions + deletions) in real source files only. */
	effLinesChanged: number
	effFiles: number
	layers: string[]
	langs: string[]
	/** Diff is dominated by generated/vendored content or pure renames. */
	mechanical: boolean
	/** Touches auth/payment/security/billing — risk-bearing, not merely shared. */
	sensitive: boolean
	/**
	 * What the diff actually consists of. Distinguishes "no source files because
	 * it's all generated" (low effort) from "no source files because it's tests or
	 * docs" (judge on merit) — collapsing those forced real test suites to score 1.
	 */
	contentKind: "code" | "tests-or-docs-only" | "generated-or-vendored" | "empty"
}

const GENERATED_RE =
	/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock|Podfile\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock|go\.sum|\/migrations\/|\.pb\.|_pb2|\/generated\/|openapi.*client|\.min\.|\/Pods\/|\.snap$|node_modules\/|\.zip$)/i
const VENDOR_RE = /(\/vendor\/|\/third_party\/|\.patch$)/i
const TEST_RE = /(\/test_|_test\.|\/tests?\/|\.spec\.|\.test\.|conftest)/i
const DOC_RE = /\.(md|rst|txt)$/i

const LAYER_PATTERNS: Array<[string, RegExp]> = [
	["api", /\/(api|routers?|views?|endpoints?|handlers?)\//i],
	["service", /\/(services?|managers?|lib|core)\//i],
	["data", /\/(models?|db|schema|selectors?|repositor)/i],
	// The lookbehind keeps `.github/workflows/` out — that's CI config (infra), not
	// an application workflow layer.
	["workflow", /(?<!\/\.github)\/workflows?\/|\/(activities|tasks?|jobs?|celery)\//i],
	["frontend", /\/(web|frontend|ui|components?|pages?)\/|\.(tsx|jsx|vue)$/i],
	["infra", /\.(tf|yaml|yml)$|\/(terraform|infra|\.circleci|helm|\.github)\//i],
	["mobile", /\/(mobile|ios|android)\/|\.(swift|kt)$/i],
]

/** Risk-bearing systems only. Deliberately excludes core/common/lib/base/models —
 *  those match most files in a typical layout, so they carry no signal. */
const SENSITIVE_RE = /\/(auth|authz|authentication|payment|billing|security|crypto|secrets?)\//i
const EXT_RE = /\.([a-z0-9]+)$/i
const CODE_EXTENSIONS = new Set([
	"py",
	"rs",
	"ts",
	"tsx",
	"js",
	"jsx",
	"go",
	"swift",
	"kt",
	"java",
	"rb",
	"sql",
	"sh",
	"c",
	"cpp",
	"h",
	"hpp",
	"proto",
])

export function computeDiffSignals(files: PRFileCache[]): DiffSignals {
	let totalLinesChanged = 0
	let generatedLines = 0
	let pureRenames = 0
	let testOrDocFiles = 0
	const effective: PRFileCache[] = []

	for (const f of files) {
		// Every pattern below expects a leading slash so `/vendor/` and friends match
		// at the repo root too — testing the bare filename let `vendor/lib.js` through.
		const path = `/${f.filename}`
		const lineCount = f.additions + f.deletions
		totalLinesChanged += lineCount

		// GitHub reports `renamed` for moves that also change content, so only a
		// near-zero-line rename counts as mechanical.
		if (f.status === "renamed" && lineCount <= PURE_RENAME_MAX_LINES) pureRenames++

		if (GENERATED_RE.test(path) || VENDOR_RE.test(path)) {
			generatedLines += lineCount
			continue
		}
		if (TEST_RE.test(path) || DOC_RE.test(path)) {
			testOrDocFiles++
			continue
		}
		effective.push(f)
	}

	const effLinesChanged = effective.reduce((sum, f) => sum + f.additions + f.deletions, 0)
	const effFiles = effective.length

	const layers = new Set<string>()
	const langs = new Set<string>()
	let sensitive = false

	for (const f of effective) {
		const path = `/${f.filename}`
		for (const [name, pattern] of LAYER_PATTERNS) {
			if (pattern.test(path)) layers.add(name)
		}
		if (SENSITIVE_RE.test(path)) sensitive = true
		const ext = EXT_RE.exec(f.filename)?.[1]?.toLowerCase()
		if (ext && CODE_EXTENSIONS.has(ext)) langs.add(ext)
	}

	const genFrac = generatedLines / Math.max(1, totalLinesChanged)
	const renFrac = pureRenames / Math.max(1, files.length)
	const mechanical =
		genFrac > MECHANICAL_LINE_FRACTION ||
		renFrac > MECHANICAL_RENAME_FRACTION ||
		(effFiles === 0 && generatedLines > 0)

	let contentKind: DiffSignals["contentKind"] = "code"
	if (files.length === 0) contentKind = "empty"
	else if (effFiles === 0) {
		contentKind = testOrDocFiles > 0 ? "tests-or-docs-only" : "generated-or-vendored"
	}

	return {
		totalLinesChanged,
		totalFiles: files.length,
		effLinesChanged,
		effFiles,
		layers: Array.from(layers).sort(),
		langs: Array.from(langs).sort(),
		mechanical,
		sensitive,
		contentKind,
	}
}
