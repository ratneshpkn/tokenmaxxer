import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"
import { cn } from "@/lib/utils"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

export function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	...props
}: CalendarProps): React.JSX.Element {
	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			className={cn("p-3 font-mono text-xs", className)}
			classNames={{
				months: "flex flex-col sm:flex-row gap-4",
				month: "space-y-3",
				caption: "flex justify-center relative items-center text-[11px] tracked",
				caption_label: "text-fg",
				nav: "space-x-1 flex items-center",
				nav_button: cn(
					"h-6 w-6 inline-flex items-center justify-center border border-line text-fg-mid",
					"hover:border-amber hover:text-amber transition-colors",
				),
				nav_button_previous: "absolute left-1",
				nav_button_next: "absolute right-1",
				table: "w-full border-collapse",
				head_row: "flex",
				head_cell: "text-fg-very-dim w-8 text-[9px] tracked font-normal text-center py-1",
				row: "flex w-full mt-1",
				cell: cn(
					"relative h-8 w-8 text-center p-0",
					"[&:has([aria-selected])]:bg-amber/10",
					"[&:has([aria-selected].day-range-end)]:bg-amber/20",
				),
				day: cn(
					"h-8 w-8 inline-flex items-center justify-center font-mono text-[11px] tabular",
					"hover:bg-amber/20 hover:text-fg transition-colors outline-none",
					"aria-selected:bg-amber aria-selected:text-black",
					"focus-visible:ring-1 focus-visible:ring-amber",
				),
				day_range_start: "day-range-start aria-selected:bg-amber",
				day_range_end: "day-range-end aria-selected:bg-amber",
				day_range_middle: "aria-selected:bg-amber/20 aria-selected:text-fg",
				day_selected: "bg-amber text-black hover:bg-amber",
				day_today: "border border-line-strong",
				day_outside: "text-fg-very-dim",
				day_disabled: "text-fg-very-dim opacity-40 pointer-events-none",
				...classNames,
			}}
			components={{
				IconLeft: () => <ChevronLeft className="h-3 w-3" strokeWidth={1.5} />,
				IconRight: () => <ChevronRight className="h-3 w-3" strokeWidth={1.5} />,
			}}
			{...props}
		/>
	)
}
