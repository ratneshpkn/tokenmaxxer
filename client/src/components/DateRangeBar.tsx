import { ChevronDown } from "lucide-react"
import { useState } from "react"
import type { DateRange as DayPickerRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { daysBetween, type Preset } from "@/lib/date-range"
import { useDateRange } from "@/lib/use-date-range"

interface DateRangeBarProps {
	/** Optional last-refetched timestamp (React Query's dataUpdatedAt). */
	updatedAt?: number
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

function formatTime(ms: number): string {
	const d = new Date(ms)
	return d.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "America/Los_Angeles",
		hour12: false,
	})
}

/** Format a Date as YYYY-MM-DD using its *local* components (so a JST or PT user
 * picking "April 1" in the calendar gets "2026-04-01", not the UTC-rolled-back day). */
function localYmd(d: Date): string {
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, "0")
	const day = String(d.getDate()).padStart(2, "0")
	return `${y}-${m}-${day}`
}

/** Build a draft DayPickerRange from the current resolved {from, to} when in custom mode. */
function draftFromUrl(preset: string, from: string, to: string): DayPickerRange | undefined {
	if (preset !== "custom") return undefined
	return { from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T00:00:00Z`) }
}

export function DateRangeBar({ updatedAt }: DateRangeBarProps): React.JSX.Element {
	const { from, to, preset, setPreset, setCustom } = useDateRange()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState<DayPickerRange | undefined>(() =>
		draftFromUrl(preset, from, to),
	)

	const days = daysBetween(from, to)
	const isCustom = preset === "custom"

	// When the popover opens, sync the draft with whatever the URL currently says.
	// Without this, going custom→preset→custom would pre-select the stale prior dates.
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

	// Disallow future dates in the picker
	const today = new Date()
	today.setHours(23, 59, 59, 999)

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2 flex-wrap">
				<Tabs value={isCustom ? "" : preset} onValueChange={(v) => v && setPreset(v as Preset)}>
					<TabsList>
						{(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
							<TabsTrigger key={p} value={p}>
								{PRESET_LABELS[p]}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>

				<Popover open={open} onOpenChange={handleOpenChange}>
					<PopoverTrigger asChild>
						<Button variant={isCustom ? "default" : "outline"} size="sm">
							<span>CUSTOM</span>
							{isCustom ? (
								<span className="font-mono">
									{formatLabelDate(from)} → {formatLabelDate(to)}
								</span>
							) : null}
							<ChevronDown className="size-3" strokeWidth={1.5} />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-auto p-0">
						<Calendar
							mode="range"
							numberOfMonths={2}
							defaultMonth={draft?.from ?? new Date()}
							selected={draft}
							onSelect={setDraft}
							disabled={{ after: today }}
						/>
						<div className="flex items-center justify-end gap-2 p-2 border-t border-line">
							<Button variant="ghost" size="sm" onClick={handleCancel}>
								CANCEL
							</Button>
							<Button size="sm" disabled={!draft?.from || !draft?.to} onClick={handleApply}>
								APPLY
							</Button>
						</div>
					</PopoverContent>
				</Popover>
			</div>

			<div className="flex items-center justify-between text-[10px] tracked text-fg-dim">
				<span>
					<span className="text-fg">{formatLabelDate(from).toUpperCase()}</span>
					<span className="mx-2 text-fg-very-dim">→</span>
					<span className="text-fg">{formatLabelDate(to).toUpperCase()}</span>
					<span className="mx-2 text-fg-very-dim">·</span>
					<span>
						{days} DAY{days === 1 ? "" : "S"}
					</span>
					<span className="mx-2 text-fg-very-dim">·</span>
					<span className="text-fg-very-dim">PT</span>
				</span>
				{updatedAt ? <span>AS OF {formatTime(updatedAt)} PT</span> : null}
			</div>
		</div>
	)
}
