import { describe, expect, it } from "bun:test"
import {
	canViewOrgSpend,
	canViewSpendForEmail,
	redactRecommendationMessage,
	redactSpendRows,
} from "./index"

describe("spend visibility policy", () => {
	it("fails closed for unauthenticated users and enforces admin/viewer_all/viewer_own", () => {
		expect(canViewOrgSpend({ role: "admin" }, "admin_only")).toBe(true)
		expect(canViewOrgSpend({ role: "viewer" }, "admin_only")).toBe(false)
		expect(canViewOrgSpend({ role: "viewer" }, "viewer_all")).toBe(true)
		expect(canViewOrgSpend({ role: null }, "viewer_all")).toBe(false)

		const viewer = { role: "viewer" as const, email: "Alice@Example.com" }
		expect(canViewSpendForEmail(viewer, "viewer_own", "alice@example.com")).toBe(true)
		expect(canViewSpendForEmail(viewer, "viewer_own", "bob@example.com")).toBe(false)
		expect(
			canViewSpendForEmail(
				{ role: null, email: "alice@example.com" },
				"viewer_own",
				"alice@example.com",
			),
		).toBe(false)
	})

	it("redactSpendRows sets hidden fields to null and respects viewer_own and targetEmail", () => {
		const rows: Record<string, unknown>[] = [
			{ email: "alice@example.com", cents: 500, tokens: 1000 },
			{ email: "bob@example.com", cents: 900, tokens: 2000 },
		]
		redactSpendRows(rows, { role: "viewer", email: "alice@example.com" }, "viewer_own", ["cents"])
		expect(rows[0].cents).toBe(500)
		expect(rows[1].cents).toBeNull()
		expect(rows[1].tokens).toBe(2000)

		const scoped: Record<string, unknown>[] = [{ date: "2026-07-01", estimated_cost_cents: 120 }]
		redactSpendRows(
			scoped,
			{ role: "viewer", email: "alice@example.com" },
			"viewer_own",
			["estimated_cost_cents"],
			{ targetEmail: "bob@example.com" },
		)
		expect(scoped[0].estimated_cost_cents).toBeNull()
	})

	it("redactRecommendationMessage strips dollar savings and per-million rates", () => {
		expect(
			redactRecommendationMessage(
				"Switch from Opus ($15.00/M) to Sonnet ($3.00/M) on routine PRs to save ~$1,242.50.",
			),
		).toBe("Switch from Opus to Sonnet on routine PRs.")
	})
})
