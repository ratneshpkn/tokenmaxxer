import { describe, expect, it } from "bun:test"
import type { PRFileCache } from "@shared/schema"
import { computeDiffSignals } from "./pr-diff-signals"

function file(overrides: Partial<PRFileCache>): PRFileCache {
	return { filename: "src/app.ts", additions: 10, deletions: 0, status: "modified", ...overrides }
}

describe("computeDiffSignals", () => {
	it("flags an all-lockfile PR as mechanical with zero effective files", () => {
		const signals = computeDiffSignals([
			file({ filename: "package-lock.json", additions: 5000, deletions: 200 }),
			file({ filename: "yarn.lock", additions: 100, deletions: 10 }),
		])
		expect(signals.mechanical).toBe(true)
		expect(signals.effFiles).toBe(0)
		expect(signals.effLinesChanged).toBe(0)
		expect(signals.contentKind).toBe("generated-or-vendored")
	})

	it("detects multi-layer breadth and language span for a real feature PR", () => {
		const signals = computeDiffSignals([
			file({ filename: "server/api/users.ts", additions: 80 }),
			file({ filename: "server/services/billing.py", additions: 120 }),
			file({ filename: "client/src/components/UserCard.tsx", additions: 60 }),
		])
		expect(signals.mechanical).toBe(false)
		expect(signals.layers).toContain("api")
		expect(signals.layers).toContain("frontend")
		expect(signals.langs.length).toBe(3)
		expect(signals.contentKind).toBe("code")
	})

	it("returns zeroed defaults for an empty file list", () => {
		const signals = computeDiffSignals([])
		expect(signals.effFiles).toBe(0)
		expect(signals.mechanical).toBe(false)
		expect(signals.contentKind).toBe("empty")
	})

	// Excluded-path patterns need a leading slash, so a bare filename let
	// root-level vendored/generated dumps through as real work.
	describe("root-level paths are excluded, not just nested ones", () => {
		it("treats a root vendor/ dump as mechanical", () => {
			const signals = computeDiffSignals([file({ filename: "vendor/lib.js", additions: 5000 })])
			expect(signals.mechanical).toBe(true)
			expect(signals.effLinesChanged).toBe(0)
		})

		it("excludes root migrations/", () => {
			const signals = computeDiffSignals([
				file({ filename: "migrations/0006_x.sql", additions: 200 }),
			])
			expect(signals.effFiles).toBe(0)
			expect(signals.mechanical).toBe(true)
		})

		it("excludes a root tests/ directory", () => {
			const signals = computeDiffSignals([file({ filename: "tests/thing.py", additions: 300 })])
			expect(signals.effFiles).toBe(0)
			expect(signals.contentKind).toBe("tests-or-docs-only")
		})
	})

	// Test/doc-only diffs used to collapse into `mechanical`, which the prompt
	// scores 1 by definition — forcing real test suites to the floor.
	describe("tests/docs are not mechanical", () => {
		it("marks a substantial test-only PR as tests-or-docs-only, not mechanical", () => {
			const signals = computeDiffSignals([
				file({ filename: "server/lib/a.test.ts", additions: 400 }),
				file({ filename: "server/lib/b.test.ts", additions: 400 }),
			])
			expect(signals.mechanical).toBe(false)
			expect(signals.contentKind).toBe("tests-or-docs-only")
		})

		it("marks a docs-only PR as tests-or-docs-only, not mechanical", () => {
			const signals = computeDiffSignals([file({ filename: "docs/arch.md", additions: 1200 })])
			expect(signals.mechanical).toBe(false)
			expect(signals.contentKind).toBe("tests-or-docs-only")
		})

		it("does not treat an ordinary filename containing 'test_' as a test file", () => {
			const signals = computeDiffSignals([
				file({ filename: "server/latest_config.ts", additions: 50 }),
			])
			expect(signals.effFiles).toBe(1)
			expect(signals.mechanical).toBe(false)
		})
	})

	describe("renames", () => {
		it("treats pure moves as mechanical", () => {
			const signals = computeDiffSignals([
				file({ filename: "server/lib/a.ts", additions: 0, deletions: 0, status: "renamed" }),
				file({ filename: "server/lib/b.ts", additions: 0, deletions: 0, status: "renamed" }),
			])
			expect(signals.mechanical).toBe(true)
		})

		it("does not treat renames carrying substantive edits as mechanical", () => {
			const signals = computeDiffSignals([
				file({ filename: "a.ts", additions: 300, deletions: 200, status: "renamed" }),
				file({ filename: "b.ts", additions: 250, deletions: 180, status: "renamed" }),
			])
			expect(signals.mechanical).toBe(false)
			expect(signals.effLinesChanged).toBe(930)
		})
	})

	describe("line accounting", () => {
		it("counts deletions in effLinesChanged so cleanups aren't read as no-ops", () => {
			const signals = computeDiffSignals([
				file({ filename: "server/legacy.ts", additions: 10, deletions: 5000 }),
			])
			expect(signals.totalLinesChanged).toBe(5010)
			expect(signals.effLinesChanged).toBe(5010)
		})
	})

	describe("sensitive", () => {
		it("flags risk-bearing paths", () => {
			expect(computeDiffSignals([file({ filename: "server/auth/session.ts" })]).sensitive).toBe(
				true,
			)
			expect(computeDiffSignals([file({ filename: "app/billing/charge.rb" })]).sensitive).toBe(true)
		})

		it("does not flag ordinary shared directories", () => {
			expect(computeDiffSignals([file({ filename: "server/lib/foo.ts" })]).sensitive).toBe(false)
			expect(computeDiffSignals([file({ filename: "app/models/user.rb" })]).sensitive).toBe(false)
		})
	})

	it("does not count .github CI config as an app workflow layer", () => {
		const signals = computeDiffSignals([
			file({ filename: ".github/workflows/ci.yml", additions: 1 }),
		])
		expect(signals.layers).toEqual(["infra"])
	})
})
