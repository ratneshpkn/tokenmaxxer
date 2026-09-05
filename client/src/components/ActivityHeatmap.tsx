import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { typographyVariants } from "@/components/ui/typography"
import { cn, formatCompact } from "@/lib/utils"

export interface ActivityDay {
	date: string // YYYY-MM-DD
	cc_cents: number | null
	cu_cents: number | null
	cc_tokens: number
	cu_tokens: number
}

/**
 * Compute a 0..N bucket index per day. Bucket 0 = no activity. Buckets 1..N
 * are quantiles (default deciles 1..10) computed over the *non-zero* days only,
 * so a light user's peak day and a heavy user's peak day both render as the
 * brightest shade.
 *
 * Exported for unit testing — pure function.
 */
export function computeBuckets(values: number[], numBuckets = 10): number[] {
	if (numBuckets <= 0) return values.map(() => 0)
	const nonZero = values
		.filter((v) => v > 0)
		.slice()
		.sort((a, b) => a - b)
	if (nonZero.length === 0) return values.map(() => 0)

	// Quantile cut points using linear interpolation (Type 7 / Excel-default).
	const q = (p: number): number => {
		const idx = (nonZero.length - 1) * p
		const lo = Math.floor(idx)
		const hi = Math.ceil(idx)
		if (lo === hi) return nonZero[lo]
		return nonZero[lo] + (nonZero[hi] - nonZero[lo]) * (idx - lo)
	}

	const cuts: number[] = []
	for (let i = 1; i < numBuckets; i++) {
		cuts.push(q(i / numBuckets))
	}

	// Degenerate distribution: every non-zero day has the same value, so all
	// cut points collapse onto the same number. Treat every active day as
	// peak (numBuckets) rather than crushing it to bucket 1.
	const degenerate = cuts.length > 0 && cuts[0] === cuts[cuts.length - 1]

	return values.map((v) => {
		if (v <= 0) return 0
		if (degenerate) return numBuckets
		for (let b = 0; b < cuts.length; b++) {
			if (v <= cuts[b]) return b + 1
		}
		return numBuckets
	})
}

/** Legacy alias for 4-tier quartile buckets. */
export function computeQuartileBuckets(values: number[]): number[] {
	return computeBuckets(values, 4)
}

/**
 * Mathematically compute an OKLCH color string for an activity bucket.
 * Bucket 0 returns the empty cell surface color.
 * Buckets 1..numBuckets scale smoothly from 18% to 100% in OKLCH.
 */
export function getHeatmapColor(
	bucket: number,
	accentVar: "--amber" | "--mint" = "--amber",
	numBuckets = 10,
): string {
	if (bucket <= 0) {
		return "color-mix(in oklch, var(--line) 45%, transparent)"
	}
	if (bucket >= numBuckets && accentVar === "--amber") {
		return "var(--amber-hot)"
	}
	const minPct = 18
	const maxPct = 100
	const pct = Math.round(minPct + ((bucket - 1) / (numBuckets - 1)) * (maxPct - minPct))
	return `color-mix(in oklch, var(${accentVar}) ${pct}%, transparent)`
}

function formatLabel(ymd: string): string {
	// "2026-05-21" → "MAY 21"
	const d = new Date(`${ymd}T00:00:00Z`)
	return d
		.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" })
		.toUpperCase()
}

function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`
}

interface ActivityHeatmapProps {
	/** One entry per day, ascending by date. */
	days: ActivityDay[]
	/** Drives color buckets and tooltip format — same trendMode used across the page. */
	trendMode: "usd" | "tokens"
}

export function ActivityHeatmap({ days, trendMode }: ActivityHeatmapProps): React.JSX.Element {
	const values = days.map((d) =>
		trendMode === "tokens" ? d.cc_tokens + d.cu_tokens : (d.cc_cents ?? 0) + (d.cu_cents ?? 0),
	)
	const buckets = computeBuckets(values, 10)

	// Reshape into columns-of-weeks. Right-most column = most recent week.
	// Each column has 7 cells (Sun..Sat).
	const padded: Array<{ day: ActivityDay; bucket: number } | null> = days.map((d, i) => ({
		day: d,
		bucket: buckets[i],
	}))
	// Pad the RIGHT so the rightmost column ends on Saturday (the way GitHub
	// does it). If `days` ends on Wednesday (UTC dow 3), pad with 3 nulls to
	// push the rightmost column to Sat.
	const lastDate = days[days.length - 1]?.date
	if (lastDate) {
		const lastDow = new Date(`${lastDate}T00:00:00Z`).getUTCDay() // 0=Sun..6=Sat
		const trailingNullCount = 6 - lastDow
		for (let i = 0; i < trailingNullCount; i++) padded.push(null)
	}
	// Pad the LEFT so the total cell count is a multiple of 7.
	while (padded.length % 7 !== 0) padded.unshift(null)
	const weeks: Array<Array<{ day: ActivityDay; bucket: number } | null>> = []
	for (let i = 0; i < padded.length; i += 7) {
		weeks.push(padded.slice(i, i + 7))
	}

	// Generate month labels: place a label above the week column where the month changes
	const monthLabels = weeks.map((week, wi) => {
		const firstActive = week.find((cell) => cell !== null)?.day
		if (!firstActive) return null

		const d = new Date(`${firstActive.date}T00:00:00Z`)
		const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()

		if (wi === 0) {
			return month
		}
		const prevFirstActive = weeks[wi - 1].find((cell) => cell !== null)?.day
		if (prevFirstActive) {
			const prevD = new Date(`${prevFirstActive.date}T00:00:00Z`)
			const prevMonth = prevD
				.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
				.toUpperCase()
			if (month !== prevMonth) {
				return month
			}
		}
		return null
	})

	const DAY_LABELS = [
		{ id: "sun", label: "" },
		{ id: "mon", label: "M" },
		{ id: "tue", label: "" },
		{ id: "wed", label: "W" },
		{ id: "thu", label: "" },
		{ id: "fri", label: "F" },
		{ id: "sat", label: "" },
	]

	return (
		<div className="flex flex-col select-none mx-auto">
			{/* Month Labels Header */}
			<div
				className="flex mb-2 text-[9px] font-mono text-fg-subtle"
				style={{ paddingLeft: "24px" }}
			>
				{weeks.map((week, wi) => {
					const label = monthLabels[wi]
					const firstActive = week.find((cell) => cell !== null)?.day
					const weekKey = firstActive ? `month-label-${firstActive.date}` : `empty-month-${wi}`
					return (
						<div
							key={weekKey}
							className="w-[20px] text-left overflow-visible whitespace-nowrap text-[9px]"
							style={{ marginRight: wi < weeks.length - 1 ? "3px" : 0 }}
						>
							{label || ""}
						</div>
					)
				})}
			</div>

			{/* Grid Row (Days + Heatmap) */}
			<div className="flex items-start">
				{/* Day Labels Column */}
				<div className="flex flex-col gap-[3px] text-[9px] font-mono text-fg-subtle pr-2 pt-[1px]">
					{DAY_LABELS.map((item) => (
						<div key={item.id} className="h-[20px] flex items-center justify-end w-4 leading-none">
							{item.label}
						</div>
					))}
				</div>

				{/* Heatmap Columns */}
				<div className="flex gap-[3px]">
					{weeks.map((week, wi) => {
						const firstActive = week.find((cell) => cell !== null)?.day
						const weekKey = firstActive ? `week-${firstActive.date}` : `empty-week-${wi}`
						return (
							<div key={weekKey} className="flex flex-col gap-[3px]">
								{week.map((cell, di) => {
									const keyVal = cell ? cell.day.date : `empty-${di}`
									if (!cell) {
										return (
											<div key={keyVal} className="w-[20px] h-[20px] bg-transparent" aria-hidden />
										)
									}
									const { day, bucket } = cell
									const totalCents = (day.cc_cents ?? 0) + (day.cu_cents ?? 0)
									const totalTokens = day.cc_tokens + day.cu_tokens
									return (
										<Tooltip key={keyVal}>
											<TooltipTrigger asChild>
												<button
													type="button"
													className="w-[20px] h-[20px] p-0 block rounded-[2px] border border-line/40 hover:scale-[1.08] hover:ring-1 hover:ring-amber/50 transition-all duration-150 ease-out cursor-pointer"
													style={{ backgroundColor: getHeatmapColor(bucket, "--amber") }}
													aria-label={`${formatLabel(day.date)} — ${formatCompact(totalTokens)} tokens`}
												/>
											</TooltipTrigger>
											<TooltipContent
												className={cn(
													typographyVariants({ variant: "label" }),
													"bg-bg border border-line-strong px-2.5 py-1.5 shadow-md",
												)}
											>
												<div className="font-semibold text-fg">{formatLabel(day.date)}</div>
												{trendMode === "usd" ? (
													<div className="text-fg-muted font-medium">
														{formatCents(totalCents)} · {formatCompact(totalTokens)} tok
													</div>
												) : (
													<div className="text-fg-muted font-medium">
														{formatCompact(totalTokens)} tok
													</div>
												)}
												{trendMode === "usd" ? (
													<div className="text-fg-muted text-[9px] mt-0.5">
														CC {formatCents(day.cc_cents ?? 0)} · Cursor{" "}
														{formatCents(day.cu_cents ?? 0)}
													</div>
												) : (
													<div className="text-fg-muted text-[9px] mt-0.5">
														CC {formatCompact(day.cc_tokens)} · Cursor{" "}
														{formatCompact(day.cu_tokens)}
													</div>
												)}
											</TooltipContent>
										</Tooltip>
									)
								})}
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}
