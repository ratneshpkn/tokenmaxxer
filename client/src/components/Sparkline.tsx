import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts"
import { useFirstRenderAnimation } from "@/lib/use-first-render-animation"

interface SparklineProps {
	/** Sequence of per-day values across the requested window. */
	data: Array<number | string | null | undefined> | null | undefined
	/** Stroke color. Defaults to amber. */
	color?: string
	/** Height in px. Default 24. */
	height?: number
	className?: string
}

/** Inline trend line backed by Recharts for visual consistency with the rest of
 *  the app's charts. Returns null for empty data. */
export function Sparkline({
	data,
	color = "var(--amber)",
	height = 24,
	className,
}: SparklineProps): React.JSX.Element | null {
	const animating = useFirstRenderAnimation()
	if (!data || data.length === 0) return null
	const series = data.map((v, i) => ({
		i,
		v: Number.isFinite(Number(v)) ? Number(v) : 0,
	}))

	return (
		<div className={className} style={{ width: "100%", height }}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={series} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
					{/* YAxis hidden but used to set a domain that pads vertically a bit */}
					<YAxis hide domain={["dataMin", "dataMax"]} />
					<Line
						type="monotone"
						dataKey="v"
						stroke={color}
						strokeWidth={1.5}
						dot={false}
						isAnimationActive={animating}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	)
}
