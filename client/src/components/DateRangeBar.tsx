import { Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { useState } from "react"
import type { DateRange as DayPickerRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Typography } from "@/components/ui/typography"
import { useIsMobile } from "@/hooks/use-mobile"
import { daysBetween, type Preset } from "@/lib/date-range"
import { useDateRange } from "@/lib/use-date-range"
import { cn } from "@/lib/utils"

interface DateRangeBarProps {
	className?: string
}

const PRESET_LABELS: Record<Preset, string> = {
	"7d": "7D",
	"30d": "30D",
	"90d": "90D",
	mtd: "MTD",
	"6m": "6M",
}

function formatLabelDate(ymd: string): string {
	const d = new Date(`${ymd}T00:00:00Z`)
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "2-digit",
		timeZone: "UTC",
	})
}

function localYmd(d: Date): string {
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, "0")
	const day = String(d.getDate()).padStart(2, "0")
	return `${y}-${m}-${day}`
}

function draftFromUrl(preset: string, from: string, to: string): DayPickerRange | undefined {
	if (preset !== "custom") return undefined
	const [fy, fm, fd] = from.split("-").map(Number)
	const [ty, tm, td] = to.split("-").map(Number)
	return { from: new Date(fy, fm - 1, fd), to: new Date(ty, tm - 1, td) }
}

export function DateRangeBar({ className }: DateRangeBarProps): React.JSX.Element {
	const { from, to, preset, setPreset, setCustom } = useDateRange()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState<DayPickerRange | undefined>(() =>
		draftFromUrl(preset, from, to),
	)
	const isMobile = useIsMobile()

	const days = daysBetween(from, to)
	const isCustom = preset === "custom"

	function handleOpenChange(next: boolean): void {
		if (next) setDraft(draftFromUrl(preset, from, to))
		setOpen(next)
	}

	function handleApply(): void {
		if (!draft?.from || !draft?.to) return
		setCustom(localYmd(draft.from), localYmd(draft.to))
		setOpen(false)
	}

	function handleCancel(): void {
		setDraft(draftFromUrl(preset, from, to))
		setOpen(false)
	}

	const today = new Date()
	today.setHours(23, 59, 59, 999)

	const labelPreset = isCustom ? "CUSTOM" : PRESET_LABELS[preset]

	return (
		<div className={cn("flex items-center", className)}>
			<Popover open={open} onOpenChange={handleOpenChange}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						className="h-8 px-2.5 gap-2 text-xs font-mono border-line bg-bg hover:bg-elev2 transition-colors"
						aria-label="Select date range"
					>
						<CalendarIcon className="size-3.5 text-fg-muted shrink-0" strokeWidth={1.5} />
						<span className="font-semibold text-fg">{labelPreset}</span>
						<span className="text-fg-subtle hidden sm:inline">·</span>
						<span className="hidden sm:inline text-fg-muted">
							{formatLabelDate(from)} – {formatLabelDate(to)}
						</span>
						{isCustom ? (
							<>
								<span className="hidden md:inline text-fg-subtle">·</span>
								<span className="hidden md:inline text-fg-subtle">{days}D</span>
							</>
						) : null}
						<ChevronDown className="size-3 text-fg-subtle shrink-0" strokeWidth={1.5} />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-auto p-3 space-y-3 bg-bg border-line shadow-lg" align="start">
					{/* Preset buttons bar */}
					<div className="flex items-center gap-1 pb-2 border-b border-line">
						{(Object.keys(PRESET_LABELS) as Preset[]).map((p) => {
							const isActive = !isCustom && preset === p
							return (
								<Button
									key={p}
									variant={isActive ? "amber" : "ghost"}
									size="sm"
									aria-pressed={isActive}
									className={cn(
										"h-7 px-2.5 text-xs font-mono transition-colors",
										isActive ? "font-bold" : "text-fg-muted hover:text-fg",
									)}
									onClick={() => {
										setPreset(p)
										setOpen(false)
									}}
								>
									{PRESET_LABELS[p]}
								</Button>
							)
						})}
					</div>

					{/* Custom Calendar Picker */}
					<div className="overflow-x-auto">
						<Calendar
							mode="range"
							numberOfMonths={isMobile ? 1 : 2}
							defaultMonth={draft?.from ?? new Date()}
							selected={draft}
							onSelect={setDraft}
							disabled={{ after: today }}
						/>
					</div>

					{/* Footer info & action buttons */}
					<div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line">
						<Typography variant="label" className="text-fg-muted text-[11px]">
							{draft?.from && draft?.to ? (
								<>
									{formatLabelDate(localYmd(draft.from))} → {formatLabelDate(localYmd(draft.to))} ·{" "}
									{daysBetween(localYmd(draft.from), localYmd(draft.to))} DAYS
								</>
							) : (
								<>SELECT CUSTOM RANGE</>
							)}
						</Typography>
						<div className="flex items-center gap-2 ml-auto">
							<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancel}>
								CANCEL
							</Button>
							<Button
								size="sm"
								className="h-7 text-xs"
								disabled={!draft?.from || !draft?.to}
								onClick={handleApply}
							>
								APPLY
							</Button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)
}
