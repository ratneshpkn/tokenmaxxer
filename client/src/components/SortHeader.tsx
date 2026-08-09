import { ChevronDown, ChevronUp } from "lucide-react"
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
	return (
		<TableHead
			onClick={onClick}
			className={cn(
				"select-none cursor-pointer group",
				align === "right" ? "text-right" : "text-left",
				active ? "text-amber" : "hover:text-fg",
				className,
			)}
		>
			<span className="inline-flex items-center gap-1">
				<span>{label}</span>
				{active ? (
					dir === "asc" ? (
						<ChevronUp className="size-3 text-amber shrink-0" />
					) : (
						<ChevronDown className="size-3 text-amber shrink-0" />
					)
				) : (
					<ChevronUp className="size-3 text-fg-subtle group-hover:text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
				)}
			</span>
		</TableHead>
	)
}
