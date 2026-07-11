import type { GithubHeatmapItem } from "@shared/api-types"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatNumber } from "@/lib/utils"
import { computeQuartileBuckets } from "./ActivityHeatmap"

const BUCKET_CLASS: Record<number, string> = {
	0: "bg-line/20 dark:bg-line/15",
	1: "bg-mint/20 dark:bg-mint/25",
	2: "bg-mint/45 dark:bg-mint/50",
	3: "bg-mint/75 dark:bg-mint/80",
	4: "bg-mint",
}

function formatLabel(ymd: string): string {
	const d = new Date(`${ymd}T00:00:00Z`)
	return d
		.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" })
		.toUpperCase()
}

interface GithubHeatmapProps {
	days: GithubHeatmapItem[]
}

export function GithubHeatmap({ days }: GithubHeatmapProps): React.JSX.Element {
	// The user requested PR count over lines changed for coloring.
	// We use PRs as the dominant factor, but include lines changed so that days with
	// commits but 0 PRs still show some heat (and don't render as entirely empty).
	const values = days.map((d) => {
		const prs = d.prs_opened + d.prs_merged
		const lines = d.additions + d.deletions
		return prs * 100000 + lines
	})
	const buckets = computeQuartileBuckets(values)

	const padded: Array<{ day: GithubHeatmapItem; bucket: number } | null> = days.map((d, i) => ({
		day: d,
		bucket: buckets[i],
	}))

	const lastDate = days[days.length - 1]?.date
	if (lastDate) {
		const lastDow = new Date(`${lastDate}T00:00:00Z`).getUTCDay()
		const trailingNullCount = 6 - lastDow
		for (let i = 0; i < trailingNullCount; i++) padded.push(null)
	}

	while (padded.length % 7 !== 0) padded.unshift(null)
	const weeks: Array<Array<{ day: GithubHeatmapItem; bucket: number } | null>> = []
	for (let i = 0; i < padded.length; i += 7) {
		weeks.push(padded.slice(i, i + 7))
	}

	const monthLabels = weeks.map((week, wi) => {
		const firstActive = week.find((cell) => cell !== null)?.day
		if (!firstActive) return null

		const d = new Date(`${firstActive.date}T00:00:00Z`)
		const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()

		if (wi === 0) return month
		const prevFirstActive = weeks[wi - 1].find((cell) => cell !== null)?.day
		if (prevFirstActive) {
			const prevD = new Date(`${prevFirstActive.date}T00:00:00Z`)
			const prevMonth = prevD
				.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
				.toUpperCase()
			if (month !== prevMonth) return month
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
			<div
				className="flex mb-2 text-[9px] font-mono text-fg-dim/80"
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

			<div className="flex items-start">
				<div className="flex flex-col gap-[3px] text-[9px] font-mono text-fg-dim/80 pr-2 pt-[1px]">
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
									const prCount = day.prs_opened + day.prs_merged
									const linesChanged = day.additions + day.deletions

									return (
										<Tooltip key={keyVal}>
											<TooltipTrigger asChild>
												<button
													type="button"
													className={`w-[20px] h-[20px] border-0 p-0 block rounded-none ${BUCKET_CLASS[bucket]} hover:scale-[1.08] hover:ring-1 hover:ring-mint/50 transition-all duration-150 ease-out cursor-pointer`}
													aria-label={`${formatLabel(day.date)} — ${prCount} PRs, ${linesChanged} lines`}
												/>
											</TooltipTrigger>
											<TooltipContent className="font-mono text-[10px] tracked bg-bg border border-line-strong px-2.5 py-1.5 shadow-md">
												<div className="font-semibold text-fg">{formatLabel(day.date)}</div>
												<div className="text-fg-mid font-medium mt-1">
													{prCount} {prCount === 1 ? "PR" : "PRs"} ({day.prs_opened} opened,{" "}
													{day.prs_merged} merged)
												</div>
												<div className="text-fg-dim text-[9px] mt-0.5">
													{formatNumber(linesChanged)} lines (+{formatNumber(day.additions)} / -
													{formatNumber(day.deletions)})
												</div>
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
