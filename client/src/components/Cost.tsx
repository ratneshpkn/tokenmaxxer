import { usePrivacyMode } from "@/lib/use-privacy-mode"
import { formatCents, formatDollars } from "@/lib/utils"

interface CostProps {
	/** Cents from the API. `null` means "not provided" (viewer role — backend stripped it). */
	cents: number | string | null | undefined
	/** Decimal places for the formatted dollar string. Default 2. Use 0 on dense KPI cards. */
	digits?: number
	/** Format flavor: "dollars" (e.g. "$1,234.56") or "compact" (e.g. "$1.2K"). */
	format?: "dollars" | "compact"
	/** Tailwind classes applied to the wrapper. */
	className?: string
}

/** Single rendering primitive for any cost value in the UI.
 *
 *  Three states:
 *   - `cents == null` → "—" (viewer role; backend stripped cost from response)
 *   - privacy mode on → formatted number with blur filter (admin opt-in screen-share mode)
 *   - default → formatted number, plain
 *
 *  Because viewers always hit the "null" branch, the same component does double duty
 *  for role-based hiding and admin-toggled blurring. */
export function Cost({
	cents,
	digits = 2,
	format = "dollars",
	className,
}: CostProps): React.JSX.Element {
	const [privacyOn] = usePrivacyMode()

	if (cents === null || cents === undefined) {
		return <span className={className ? `${className} text-fg-subtle` : "text-fg-subtle"}>—</span>
	}

	const n = typeof cents === "string" ? Number(cents) : cents
	const text = format === "compact" ? formatCompactDollars(n) : formatDollars(n, digits)

	if (privacyOn) {
		return (
			<span
				className={className}
				style={{ filter: "blur(6px)", userSelect: "none" }}
				role="img"
				aria-label="Cost hidden"
				title="Cost hidden — toggle privacy off in the top bar to reveal"
			>
				<span aria-hidden="true">{text}</span>
			</span>
		)
	}
	return <span className={className}>{text}</span>
}

/** "$1.2K" / "$345.7M" — for dense KPI cards. Uses the same Compact rules as formatCents/Compact. */
function formatCompactDollars(cents: number): string {
	const dollars = cents / 100
	const abs = Math.abs(dollars)
	if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
	if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
	return formatDollars(cents, 0)
}

/** Re-export for callers that want the inner formatters without the React layer. */
export { formatCents, formatDollars }
