/**
 * Shared model color palette. All values use CSS custom properties so they
 * work correctly in both light and dark mode and respect the design token system.
 *
 * Two use cases:
 * - colorForModelInMix: platform-segregated shades for the model-mix bar chart
 *   (ModelMixSection). CC models cycle through amber shades; Cursor through sky.
 * - colorForModelTrend: rank-based colors for the model-trends line chart
 *   (user-detail). Top model gets the primary accent; subsequent models fan out
 *   through the palette.
 */

export const CC_SHADES = [
	"var(--amber)",
	"var(--amber-hot)",
	"color-mix(in oklch, var(--amber) 60%, transparent)",
	"color-mix(in oklch, var(--amber-hot) 60%, transparent)",
] as const

export const CU_SHADES = [
	"var(--sky)",
	"color-mix(in oklch, var(--sky) 70%, transparent)",
	"color-mix(in oklch, var(--sky) 50%, transparent)",
	"color-mix(in oklch, var(--sky) 35%, transparent)",
] as const

// Interleave CC and CU shades so adjacent ranked models contrast.
const TREND_COLORS = [
	CC_SHADES[0],
	CU_SHADES[0],
	CC_SHADES[1],
	CU_SHADES[1],
	CC_SHADES[2],
	CU_SHADES[2],
	CC_SHADES[3],
	CU_SHADES[3],
] as const

/** Color for a model entry in the platform-segmented mix bar chart. */
export function colorForModelInMix(platform: "claude_code" | "cursor", idx: number): string {
	return platform === "claude_code"
		? CC_SHADES[idx % CC_SHADES.length]
		: CU_SHADES[idx % CU_SHADES.length]
}

/**
 * Color for a model line in the combined (CC + Cursor) trends chart.
 * Assigned by rank in `topModels`; "Other" always gets the dim fallback.
 */
export function colorForModelTrend(model: string, topModels: string[]): string {
	if (model === "Other") return "var(--fg-very-dim)"
	const idx = topModels.indexOf(model)
	if (idx === -1) return "var(--fg-very-dim)"
	return TREND_COLORS[idx] ?? TREND_COLORS[TREND_COLORS.length - 1]
}
