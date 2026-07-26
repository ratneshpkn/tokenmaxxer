import { TableCell, TableRow } from "@/components/ui/table"

interface TableStateRowProps {
	colSpan: number
	isLoading?: boolean
	loadingText?: string
	emptyText?: string
}

export function TableStateRow({
	colSpan,
	isLoading = false,
	loadingText = "scanning…",
	emptyText = "no data in window",
}: TableStateRowProps): React.JSX.Element {
	return (
		<TableRow>
			<TableCell colSpan={colSpan} className="text-center text-fg-dim py-8 text-xs tabular">
				── {isLoading ? loadingText : emptyText} ──
			</TableCell>
		</TableRow>
	)
}
