export type Platform = "claude_code" | "cursor"

export const PLATFORMS = {
	claude_code: { label: "CLAUDE CODE", short: "CC", color: "var(--amber)", colorVar: "amber" },
	cursor: { label: "CURSOR", short: "CU", color: "var(--sky)", colorVar: "sky" },
} as const

export function platformLabel(p: Platform): string {
	return PLATFORMS[p].label
}

export function platformShort(p: Platform): string {
	return PLATFORMS[p].short
}

export function platformColor(p: Platform): string {
	return PLATFORMS[p].color
}
