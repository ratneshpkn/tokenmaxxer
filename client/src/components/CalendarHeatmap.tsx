import type { GithubHeatmapItem } from "@shared/api-types"
import type { ReactNode } from "react"
import { Cost } from "@/components/Cost"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { typographyVariants } from "@/components/ui/typography"
import { cn, formatCompact, formatNumber } from "@/lib/utils"

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
		if (!(v > 0)) return 0
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
 * Compute an opaque color string for an activity bucket.
 * Mixing in `oklab` (Cartesian) against `var(--bg-elev)` (a=0, b=0) keeps the
 * OKLCH hue mathematically constant — avoiding `oklch`'s polar hue-0 drift
 * (which pulls mint toward olive/brown when mixing with `oklch(L 0 0)`).
 */
export function getHeatmapColor(
	bucket: number,
	accentVar: "--amber" | "--mint" = "--amber",
	numBuckets = 10,
): string {
	if (bucket <= 0) {
		return "color-mix(in oklab, var(--line) 45%, var(--bg-elev))"
	}
	const clamped = Math.min(bucket, numBuckets)
	const minPct = 20
	const maxPct = 100
	const pct =
		numBuckets <= 1
			? maxPct
			: Math.round(minPct + ((clamped - 1) / (numBuckets - 1)) * (maxPct - minPct))
	return `color-mix(in oklab, var(${accentVar}) ${pct}%, var(--bg-elev))`
}

function formatDateLabel(ymd: string): string {
	const d = new Date(`${ymd}T00:00:00Z`)
	return d
		.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" })
		.toUpperCase()
}

function formatMonth(ymd: string): string {
	const d = new Date(`${ymd}T00:00:00Z`)
	return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()
}

const DAY_LABELS = [
	{ id: "sun", label: "" },
	{ id: "mon", label: "M" },
	{ id: "tue", label: "" },
	{ id: "wed", label: "W" },
	{ id: "thu", label: "" },
	{ id: "fri", label: "F" },
	{ id: "sat", label: "" },
] as const

interface CalendarHeatmapProps<T extends { date: string }> {
	/** One entry per day, ascending by date. */
	days: T[]
	/** Extract the scalar intensity used to compute quantile buckets. */
	getValue: (day: T) => number
	accentVar: "--amber" | "--mint"
	getAriaLabel: (day: T, dateLabel: string) => string
	renderTooltip: (day: T, dateLabel: string) => ReactNode
}

export function CalendarHeatmap<T extends { date: string }>({
	days,
	getValue,
	accentVar,
	getAriaLabel,
	renderTooltip,
}: CalendarHeatmapProps<T>): React.JSX.Element {
	const buckets = computeBuckets(days.map(getValue), 10)

	// Reshape into columns-of-weeks (Sun..Sat), right-aligned so the rightmost column ends on Sat.
	const padded: Array<{ day: T; bucket: number } | null> = days.map((day, i) => ({
		day,
		bucket: buckets[i],
	}))
	const lastDate = days[days.length - 1]?.date
	if (lastDate) {
		const lastDow = new Date(`${lastDate}T00:00:00Z`).getUTCDay()
		for (let i = 0; i < 6 - lastDow; i++) padded.push(null)
	}
	while (padded.length % 7 !== 0) padded.unshift(null)

	const weeks: Array<Array<{ day: T; bucket: number } | null>> = []
	for (let i = 0; i < padded.length; i += 7) {
		weeks.push(padded.slice(i, i + 7))
	}

	const monthLabels = weeks.map((week, wi) => {
		const firstActive = week.find((cell) => cell !== null)?.day
		if (!firstActive) return null
		const month = formatMonth(firstActive.date)
		if (wi === 0) return month
		const prevFirstActive = weeks[wi - 1].find((cell) => cell !== null)?.day
		if (prevFirstActive && month !== formatMonth(prevFirstActive.date)) return month
		return null
	})

	const hoverRing = accentVar === "--amber" ? "hover:ring-amber/50" : "hover:ring-mint/50"

	return (
		<div className="flex flex-col select-none mx-auto">
			<div
				className="flex mb-2 text-[9px] font-mono text-fg-subtle"
				style={{ paddingLeft: "24px" }}
			>
				{weeks.map((week, wi) => {
					const firstActive = week.find((cell) => cell !== null)?.day
					const weekKey = firstActive ? `month-label-${firstActive.date}` : `empty-month-${wi}`
					return (
						<div
							key={weekKey}
							className="w-[20px] text-left overflow-visible whitespace-nowrap text-[9px]"
							style={{ marginRight: wi < weeks.length - 1 ? "3px" : 0 }}
						>
							{monthLabels[wi] || ""}
						</div>
					)
				})}
			</div>

			<div className="flex items-start">
				<div className="flex flex-col gap-[3px] text-[9px] font-mono text-fg-subtle pr-2 pt-[1px]">
					{DAY_LABELS.map((item) => (
						<div key={item.id} className="h-[20px] flex items-center justify-end w-4 leading-none">
							{item.label}
						</div>
					))}
				</div>

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
									const dateLabel = formatDateLabel(day.date)
									return (
										<Tooltip key={keyVal}>
											<TooltipTrigger asChild>
												<button
													type="button"
													className={cn(
														"w-[20px] h-[20px] p-0 block rounded-[2px] hover:scale-[1.08] hover:ring-1 transition-all duration-150 ease-out cursor-pointer",
														hoverRing,
													)}
													style={{ backgroundColor: getHeatmapColor(bucket, accentVar) }}
													aria-label={getAriaLabel(day, dateLabel)}
												/>
											</TooltipTrigger>
											<TooltipContent
												className={cn(
													typographyVariants({ variant: "label" }),
													"bg-bg border border-line-strong px-2.5 py-1.5 shadow-md",
												)}
											>
												{renderTooltip(day, dateLabel)}
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

export function ActivityHeatmap({
	days,
	trendMode,
}: {
	days: ActivityDay[]
	trendMode: "usd" | "tokens"
}): React.JSX.Element {
	return (
		<CalendarHeatmap
			days={days}
			accentVar="--amber"
			getValue={(d) =>
				trendMode === "tokens" ? d.cc_tokens + d.cu_tokens : (d.cc_cents ?? 0) + (d.cu_cents ?? 0)
			}
			getAriaLabel={(day, dateLabel) =>
				`${dateLabel} — ${formatCompact(day.cc_tokens + day.cu_tokens)} tokens`
			}
			renderTooltip={(day, dateLabel) => {
				const totalCents = (day.cc_cents ?? 0) + (day.cu_cents ?? 0)
				const totalTokens = day.cc_tokens + day.cu_tokens
				return (
					<>
						<div className="font-semibold text-fg">{dateLabel}</div>
						{trendMode === "usd" ? (
							<div className="text-fg-muted font-medium">
								<Cost cents={totalCents} digits={2} /> · {formatCompact(totalTokens)} tok
							</div>
						) : (
							<div className="text-fg-muted font-medium">{formatCompact(totalTokens)} tok</div>
						)}
						{trendMode === "usd" ? (
							<div className="text-fg-muted text-[9px] mt-0.5">
								CC <Cost cents={day.cc_cents ?? 0} digits={2} /> · Cursor{" "}
								<Cost cents={day.cu_cents ?? 0} digits={2} />
							</div>
						) : (
							<div className="text-fg-muted text-[9px] mt-0.5">
								CC {formatCompact(day.cc_tokens)} · Cursor {formatCompact(day.cu_tokens)}
							</div>
						)}
					</>
				)
			}}
		/>
	)
}

export function GithubHeatmap({ days }: { days: GithubHeatmapItem[] }): React.JSX.Element {
	return (
		<CalendarHeatmap
			days={days}
			accentVar="--mint"
			getValue={(d) => (d.prs_opened + d.prs_merged) * 100000 + d.additions + d.deletions}
			getAriaLabel={(day, dateLabel) => {
				const prCount = day.prs_opened + day.prs_merged
				const linesChanged = day.additions + day.deletions
				return `${dateLabel} — ${prCount} PRs, ${linesChanged} lines`
			}}
			renderTooltip={(day, dateLabel) => {
				const prCount = day.prs_opened + day.prs_merged
				const linesChanged = day.additions + day.deletions
				return (
					<>
						<div className="font-semibold text-fg">{dateLabel}</div>
						<div className="text-fg-muted font-medium mt-1">
							{prCount} {prCount === 1 ? "PR" : "PRs"} ({day.prs_opened} opened, {day.prs_merged}{" "}
							merged)
						</div>
						<div className="text-fg-muted text-[9px] mt-0.5">
							{formatNumber(linesChanged)} lines (+{formatNumber(day.additions)} / -
							{formatNumber(day.deletions)})
						</div>
					</>
				)
			}}
		/>
	)
}
