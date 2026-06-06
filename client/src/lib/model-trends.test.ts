import { describe, expect, it } from "bun:test"
import type { UsageRow } from "./model-trends"
import { buildModelTrends } from "./model-trends"

// Helper: a CC row with one model on one date
function ccRow(date: string, model: string, cents: number, tokens = 0): UsageRow {
	return { date, model, estimated_cost_cents: cents, output_tokens: tokens }
}

// Helper: a Cursor row with one model on one date
function cuRow(date: string, model: string, cents: number, tokens = 0): UsageRow {
	return { date, model, charged_cents: cents, output_tokens: tokens }
}

describe("buildModelTrends", () => {
	it("returns empty data when both row arrays are empty", () => {
		const result = buildModelTrends([], [], "usd")
		expect(result.chartModels).toEqual([])
		expect(result.topModels).toEqual([])
		expect(result.modelTrendsData).toEqual([])
	})

	it("returns a single model row for one CC row", () => {
		const result = buildModelTrends([ccRow("2026-05-01", "claude-3-5-sonnet", 500)], [], "usd")
		expect(result.chartModels).toEqual(["claude-3-5-sonnet"])
		expect(result.modelTrendsData).toHaveLength(1)
		expect(result.modelTrendsData[0]["claude-3-5-sonnet"]).toBeCloseTo(5.0) // 500 cents → $5.00
		expect(result.modelTrendsData[0].date).toBe("05-01")
	})

	it("sums CC and Cursor values for the same model on the same date", () => {
		const result = buildModelTrends(
			[ccRow("2026-05-01", "claude-3-5-sonnet", 300)],
			[cuRow("2026-05-01", "claude-3-5-sonnet", 200)],
			"usd",
		)
		expect(result.modelTrendsData[0]["claude-3-5-sonnet"]).toBeCloseTo(5.0) // 300+200=500 cents
	})

	it("ranks models by total value and caps at 6, grouping the rest as Other", () => {
		// 7 distinct models; model-7 should become "Other"
		const rows = [
			ccRow("2026-05-01", "model-1", 700),
			ccRow("2026-05-01", "model-2", 600),
			ccRow("2026-05-01", "model-3", 500),
			ccRow("2026-05-01", "model-4", 400),
			ccRow("2026-05-01", "model-5", 300),
			ccRow("2026-05-01", "model-6", 200),
			ccRow("2026-05-01", "model-7", 100), // smallest → Other
		]
		const result = buildModelTrends(rows, [], "usd")
		expect(result.topModels).toHaveLength(6)
		expect(result.chartModels).toContain("Other")
		expect(result.chartModels).not.toContain("model-7")
		expect(result.modelTrendsData[0].Other).toBeCloseTo(1.0) // 100 cents → $1.00
	})

	it("zero-fills missing (date, model) combinations", () => {
		// model-A appears only on 2026-05-01; model-B only on 2026-05-02
		const rows = [ccRow("2026-05-01", "model-a", 100), ccRow("2026-05-02", "model-b", 200)]
		const result = buildModelTrends(rows, [], "usd")
		const day1 = result.modelTrendsData[0]
		const day2 = result.modelTrendsData[1]
		expect(day1["model-a"]).toBeCloseTo(1.0)
		expect(day1["model-b"]).toBe(0)
		expect(day2["model-a"]).toBe(0)
		expect(day2["model-b"]).toBeCloseTo(2.0)
	})

	it("uses token counts when trendMode is tokens", () => {
		const result = buildModelTrends(
			[
				{
					date: "2026-05-01",
					model: "claude-3-5-sonnet",
					estimated_cost_cents: 999,
					output_tokens: 42,
				},
			],
			[],
			"tokens",
		)
		expect(result.modelTrendsData[0]["claude-3-5-sonnet"]).toBe(42)
	})

	it("sums all token fields for totalTokens", () => {
		const row: UsageRow = {
			date: "2026-05-01",
			model: "m",
			input_tokens: 10,
			output_tokens: 20,
			cache_read_tokens: 5,
			cache_creation_tokens: 3,
			cache_write_tokens: 2,
		}
		const result = buildModelTrends([row], [], "tokens")
		expect(result.modelTrendsData[0].m).toBe(40) // 10+20+5+3+2
	})

	it("dates in output are sliced to MM-DD", () => {
		const result = buildModelTrends([ccRow("2026-05-21", "m", 100)], [], "usd")
		expect(result.modelTrendsData[0].date).toBe("05-21")
	})
})
