import type { UsageRow } from "@shared/api-types"

export function totalTokens(r: UsageRow): number {
	return (
		Number(r.input_tokens ?? 0) +
		Number(r.output_tokens ?? 0) +
		Number(r.cache_read_tokens ?? 0) +
		Number(r.cache_creation_tokens ?? 0) +
		Number(r.cache_write_tokens ?? 0)
	)
}

export interface ModelTrendsResult {
	/** All model keys present in modelTrendsData (top 6 + "Other" if applicable). */
	chartModels: string[]
	/** Top 6 model names in rank order (used for color assignment). */
	topModels: string[]
	/** Wide-format rows: { date: "MM-DD", [model]: value, ... } */
	modelTrendsData: Array<Record<string, string | number>>
}

/**
 * Pivots per-date-per-model CC + Cursor usage rows into a wide-format array
 * suitable for a Recharts LineChart. Top 6 models by total value get their own
 * line; everything else is summed into an "Other" series.
 */
export function buildModelTrends(
	ccRows: UsageRow[],
	cuRows: UsageRow[],
	trendMode: "usd" | "tokens",
): ModelTrendsResult {
	type ModelRow = { date: string; model: string; value: number }
	const allRows: ModelRow[] = [
		...ccRows.map((r) => ({
			date: r.date,
			model: r.model ?? "unknown",
			value: trendMode === "usd" ? Number(r.estimated_cost_cents ?? 0) / 100 : totalTokens(r),
		})),
		...cuRows.map((r) => ({
			date: r.date,
			model: r.model ?? "unknown",
			value: trendMode === "usd" ? Number(r.charged_cents ?? 0) / 100 : totalTokens(r),
		})),
	]

	if (allRows.length === 0) {
		return { chartModels: [], topModels: [], modelTrendsData: [] }
	}

	// Rank models by total value across all dates.
	const modelTotals = new Map<string, number>()
	for (const { model, value } of allRows) {
		modelTotals.set(model, (modelTotals.get(model) ?? 0) + value)
	}
	const rankedModels = [...modelTotals.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([m]) => m)
	const topModels = rankedModels.slice(0, 6)
	const otherModels = new Set(rankedModels.slice(6))

	// Aggregate per (date, effective-model-key).
	const cellMap = new Map<string, Map<string, number>>()
	for (const { date, model, value } of allRows) {
		const key = otherModels.has(model) ? "Other" : model
		let dateMap = cellMap.get(date)
		if (!dateMap) {
			dateMap = new Map()
			cellMap.set(date, dateMap)
		}
		dateMap.set(key, (dateMap.get(key) ?? 0) + value)
	}

	const chartModels = [...topModels, ...(otherModels.size > 0 ? ["Other"] : [])]
	const chartDates = [...cellMap.keys()].sort()

	const modelTrendsData = chartDates.map((date) => {
		const row: Record<string, string | number> = { date: date.slice(5) }
		const dateMap = cellMap.get(date) ?? new Map<string, number>()
		for (const m of chartModels) row[m] = dateMap.get(m) ?? 0
		return row
	})

	return { chartModels, topModels, modelTrendsData }
}

export { colorForModelTrend as colorForModel } from "./model-color"
