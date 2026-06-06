import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

interface SortHeaderProps {
	label: string
	active: boolean
	dir: "asc" | "desc"
	align?: "left" | "right"
	onClick: () => void
	className?: string
}

export function SortHeader({
	label,
	active,
	dir,
	align = "left",
	onClick,
	className,
}: SortHeaderProps): React.JSX.Element {
	const arrow = !active ? "" : dir === "asc" ? " ▲" : " ▼"
	return (
		<TableHead
			onClick={onClick}
			className={cn(
				"h-9 px-3 text-[10px] tracked font-medium select-none cursor-pointer",
				align === "right" ? "text-right" : "text-left",
				active ? "text-amber" : "text-fg-dim hover:text-fg",
				className,
			)}
		>
			{label}
			{arrow}
		</TableHead>
	)
}
