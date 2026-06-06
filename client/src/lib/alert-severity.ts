/**
 * Severity classifier for alert rows. `ratio` is `amountCents / thresholdCents`
 * — how far past the daily threshold the user landed. Returns Tailwind class
 * names for the three visual slots used in the table: text color, row background,
 * and status pip.
 *
 * Tiers (closed-open semantics):
 *   ratio < 1.5 → faint (above threshold but not by much)
 *   1.5 ≤ ratio < 3 → standard amber
 *   3 ≤ ratio < 5 → hot amber with tinted row
 *   5 ≤ ratio     → peak — stronger row tint
 */
export function severity(ratio: number): { text: string; row: string; pip: string } {
	if (ratio >= 5) return { text: "text-amber-hot", row: "bg-amber-hot/[0.06]", pip: "bg-amber-hot" }
	if (ratio >= 3) return { text: "text-amber-hot", row: "bg-amber/[0.04]", pip: "bg-amber-hot" }
	if (ratio >= 1.5) return { text: "text-amber", row: "", pip: "bg-amber" }
	return { text: "text-amber/70", row: "", pip: "bg-amber/60" }
}
