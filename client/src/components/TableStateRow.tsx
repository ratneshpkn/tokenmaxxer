import { TableCell, TableRow } from "@/components/ui/table"
import { Typography } from "@/components/ui/typography"

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
			<TableCell colSpan={colSpan} className="text-center py-8">
				<Typography variant="subtle" className="tabular">
					── {isLoading ? loadingText : emptyText} ──
				</Typography>
			</TableCell>
		</TableRow>
	)
}
