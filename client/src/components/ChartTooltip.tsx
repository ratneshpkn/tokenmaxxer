import type { ReactNode } from "react"
import type { TooltipPayloadEntry } from "recharts"

interface ChartTooltipProps {
	active?: boolean
	payload?: readonly TooltipPayloadEntry[]
	formatValue: (value: number, dataKey: string) => ReactNode
}

export function ChartTooltip({
	active,
	payload,
	formatValue,
}: ChartTooltipProps): React.JSX.Element | null {
	if (!active || !payload?.length) return null
	return (
		<div className="bg-bg/95 border border-line-strong px-3 py-2 text-xs tabular">
			<div className="text-fg-muted tracked-sm text-[9px] mb-1">
				{payload[0].payload?.date ?? ""}
			</div>
			{payload.map((p) => {
				const key = typeof p.dataKey === "function" ? "" : String(p.dataKey ?? "")
				return (
					<div key={key} className="flex items-center justify-between gap-4">
						<span className="flex items-center gap-1.5">
							<span className="w-2 h-2" style={{ background: p.color || (p.fill as string) }} />
							<span className="text-fg-muted">{key}</span>
						</span>
						<span className="text-fg">{formatValue(Number(p.value), key)}</span>
					</div>
				)
			})}
		</div>
	)
}
