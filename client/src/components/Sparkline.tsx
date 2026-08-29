import { useMemo } from "react"

interface SparklineProps {
	/** Sequence of per-day values across the requested window. */
	data: Array<number | string | null | undefined> | null | undefined
	/** Stroke color. Defaults to amber. */
	color?: string
	/** Height in px. Default 24. */
	height?: number
	className?: string
	/** Delay in ms before entrance animation starts. Default 250ms. */
	delayMs?: number
}

function computeMonotonePath(points: Array<[number, number]>): string {
	if (points.length === 0) return ""
	if (points.length === 1) return `M ${points[0][0]},${points[0][1]}`
	if (points.length === 2) {
		return `M ${points[0][0]},${points[0][1]} L ${points[1][0]},${points[1][1]}`
	}

	const n = points.length
	const slopes: number[] = new Array(n)

	// Interior tangents via Steffen's method (identical to d3.curveMonotoneX)
	for (let i = 1; i < n - 1; i++) {
		const h0 = points[i][0] - points[i - 1][0]
		const h1 = points[i + 1][0] - points[i][0]
		const s0 = (points[i][1] - points[i - 1][1]) / (h0 || 1e-6)
		const s1 = (points[i + 1][1] - points[i][1]) / (h1 || 1e-6)
		const p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1e-6)

		const signS0 = s0 < 0 ? -1 : 1
		const signS1 = s1 < 0 ? -1 : 1
		slopes[i] =
			signS0 + signS1 === 0
				? 0
				: (signS0 + signS1) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
	}

	// Endpoints one-sided slopes (identical to d3.curveMonotoneX)
	const hStart = points[1][0] - points[0][0]
	slopes[0] = hStart ? ((3 * (points[1][1] - points[0][1])) / hStart - slopes[1]) / 2 : slopes[1]

	const hEnd = points[n - 1][0] - points[n - 2][0]
	slopes[n - 1] = hEnd
		? ((3 * (points[n - 1][1] - points[n - 2][1])) / hEnd - slopes[n - 2]) / 2
		: slopes[n - 2]

	let d = `M ${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`
	for (let i = 0; i < n - 1; i++) {
		const x0 = points[i][0]
		const y0 = points[i][1]
		const x1 = points[i + 1][0]
		const y1 = points[i + 1][1]
		const dx = (x1 - x0) / 3

		const cp1x = x0 + dx
		const cp1y = y0 + dx * slopes[i]
		const cp2x = x1 - dx
		const cp2y = y1 - dx * slopes[i + 1]

		d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`
	}
	return d
}

function computePath(
	data: Array<number | string | null | undefined>,
	width: number,
	height: number,
): string {
	const values = data.map((v) => {
		const n = Number(v)
		return Number.isFinite(n) && n >= 0 ? n : 0
	})
	if (values.length === 0) return ""
	if (values.length === 1) return `M 0,${height / 2} L ${width},${height / 2}`

	const min = 0
	const max = Math.max(1, ...values)
	const range = max - min
	const padY = 2
	const usableHeight = Math.max(1, height - padY * 2)

	const points: Array<[number, number]> = values.map((v, i) => {
		const x = (i / (values.length - 1)) * width
		const y = height - padY - ((v - min) / range) * usableHeight
		return [x, y]
	})

	return computeMonotonePath(points)
}

/** Lightweight native SVG sparkline with GPU-accelerated entrance animation.
 *  Returns null for empty data. */
export function Sparkline({
	data,
	color = "var(--amber)",
	height = 24,
	className,
	delayMs = 250,
}: SparklineProps): React.JSX.Element | null {
	const width = 100

	const pathD = useMemo(() => {
		if (!data || data.length === 0) return ""
		return computePath(data, width, height)
	}, [data, height])

	if (!data || data.length === 0 || !pathD) return null

	return (
		<div
			className={className}
			style={{
				width: "100%",
				height,
				animation: `sparkline-reveal 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms both`,
			}}
		>
			<svg
				aria-hidden="true"
				viewBox={`0 0 ${width} ${height}`}
				preserveAspectRatio="none"
				className="w-full h-full overflow-visible"
			>
				<path
					vectorEffect="non-scaling-stroke"
					d={pathD}
					fill="none"
					stroke={color}
					strokeWidth={1.5}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</div>
	)
}
