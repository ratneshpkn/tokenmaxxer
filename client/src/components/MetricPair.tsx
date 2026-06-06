import { Cost } from "@/components/Cost"
import { useMetricMode } from "@/lib/use-metric-mode"
import { cn, formatCompact } from "@/lib/utils"

interface MetricPairProps {
	/** Cost in cents (nullable — viewer mode has `null`). */
	cents: number | string | null | undefined
	/** Token count (number, never null). */
	tokens: number | string | null | undefined
	/** Decimal places for the cost rendering. Defaults to 2. */
	digits?: number
	/** Class applied to the wrapper. */
	className?: string
	/** Class applied to the primary line (the big text). */
	primaryClassName?: string
	/** Class applied to the secondary line (the subtext). */
	secondaryClassName?: string
}

/** Renders a cost/tokens pair with the active metric primary and the other as
 *  subtext. When cents is null (viewer), tokens is always primary and no
 *  secondary subtext renders. The privacy eye still blurs the cost value
 *  whether it's primary or subtext — handled inside <Cost>. */
export function MetricPair({
	cents,
	tokens,
	digits = 2,
	className,
	primaryClassName,
	secondaryClassName,
}: MetricPairProps): React.JSX.Element {
	const [mode] = useMetricMode()
	const tokenStr = `${formatCompact(Number(tokens ?? 0))} tok`

	// Viewer: cents is null. Tokens is the only metric, no secondary.
	if (cents === null || cents === undefined) {
		return <span className={cn(className, primaryClassName)}>{tokenStr}</span>
	}

	const showCostPrimary = mode === "cost"
	return (
		<span className={className}>
			<span className={primaryClassName}>
				{showCostPrimary ? <Cost cents={cents} digits={digits} /> : tokenStr}
			</span>
			<span className={cn("block", secondaryClassName)}>
				{showCostPrimary ? tokenStr : <Cost cents={cents} digits={digits} />}
			</span>
		</span>
	)
}
