import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Link } from "wouter"
import { DateRangeBar } from "@/components/DateRangeBar"
import { MetricPair } from "@/components/MetricPair"
import { SearchInput } from "@/components/SearchInput"
import { SortHeader } from "@/components/SortHeader"
import { Sparkline } from "@/components/Sparkline"
import { TableStateRow } from "@/components/TableStateRow"
import { Card } from "@/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { Typography } from "@/components/ui/typography"
import { api } from "@/lib/api"
import { colorForModelInMix } from "@/lib/model-color"
import { useDateRange } from "@/lib/use-date-range"
import { useMetricMode } from "@/lib/use-metric-mode"

type SortKey = "model" | "cents" | "tokens" | "share"

export function ModelsPage(): React.JSX.Element {
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isViewer = me ? me.role !== "admin" : false
	const [metricMode] = useMetricMode()
	const effectiveMode = isViewer ? "tokens" : metricMode

	const { from, to } = useDateRange()
	const modelsQuery = useQuery({
		queryKey: ["models.list", from, to, metricMode],
		queryFn: () => api.dashboard.modelMix({ from, to }, 200, metricMode),
	})
	const data = modelsQuery.data ?? []
	const isLoading = modelsQuery.isLoading

	const [filter, setFilter] = useState("")

	const [sortKey, setSortKey] = useState<SortKey>(isViewer ? "tokens" : "cents")
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

	// Window totals for share %.
	const totalCents = useMemo(() => data.reduce((acc, m) => acc + Number(m.cents ?? 0), 0), [data])
	const totalTokens = useMemo(() => data.reduce((acc, m) => acc + Number(m.tokens), 0), [data])
	const denom = effectiveMode === "cost" ? totalCents : totalTokens

	const rows = useMemo(() => {
		const f = filter.trim().toLowerCase()
		const filtered = f ? data.filter((m) => m.model.toLowerCase().includes(f)) : data
		const sortVal = (m: (typeof filtered)[number]): string | number => {
			switch (sortKey) {
				case "model":
					return m.model

				case "cents":
					return Number(m.cents ?? 0)
				case "tokens":
					return Number(m.tokens)
				case "share":
					return isViewer ? Number(m.tokens) : Number(m.cents ?? 0)
			}
		}
		return [...filtered].sort((a, b) => {
			const av = sortVal(a)
			const bv = sortVal(b)
			const cmp =
				typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number)
			return sortDir === "asc" ? cmp : -cmp
		})
	}, [data, filter, sortKey, sortDir, isViewer])

	function toggle(k: SortKey): void {
		if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setSortKey(k)
			setSortDir(k === "model" ? "asc" : "desc")
		}
	}

	return (
		<div className="space-y-4 fade-rise">
			<DateRangeBar updatedAt={modelsQuery.dataUpdatedAt} />
			<div className="flex items-end justify-between gap-4">
				<Typography variant="label" className="max-w-xl">
					{data.length} MODELS TRACKED · sorted by{" "}
					<span className="text-fg">{sortKey.toUpperCase()}</span>
				</Typography>
				<SearchInput
					placeholder="filter by model name…"
					value={filter}
					onChange={setFilter}
					className="max-w-xs w-full"
				/>
			</div>

			<Card className="overflow-hidden">
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="w-14 text-right">#</TableHead>
							<SortHeader
								label="MODEL"
								active={sortKey === "model"}
								dir={sortDir}
								onClick={() => toggle("model")}
							/>

							<SortHeader
								label="VALUE"
								active={sortKey === "cents" || sortKey === "tokens"}
								dir={sortDir}
								onClick={() => toggle(effectiveMode === "cost" ? "cents" : "tokens")}
								align="right"
							/>
							<SortHeader
								label="SHARE"
								active={sortKey === "share"}
								dir={sortDir}
								onClick={() => toggle("share")}
								align="right"
							/>
							<TableHead className="w-[140px]">TREND</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading || rows.length === 0 ? (
							<TableStateRow colSpan={5} isLoading={isLoading} emptyText="no models in window" />
						) : (
							rows.map((m, i) => {
								const value = effectiveMode === "cost" ? Number(m.cents ?? 0) : Number(m.tokens)
								const pct = denom > 0 ? (value / denom) * 100 : 0
								const rowColor = colorForModelInMix(i)
								return (
									<TableRow key={m.model}>
										<TableCell className="px-3 py-2.5 text-right text-xs tabular text-fg-subtle">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Link
												href={`/models/${encodeURIComponent(m.model)}`}
												className="flex items-center gap-2 min-w-0 group"
											>
												<span
													className="inline-block w-2 h-2 shrink-0"
													style={{ background: rowColor }}
												/>
												<span className="text-fg truncate group-hover:text-amber transition-colors">
													{m.model}
												</span>
											</Link>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg">
											<MetricPair cents={isViewer ? null : m.cents} tokens={m.tokens} digits={2} />
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg-muted text-xs">
											{pct.toFixed(1)}%
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Sparkline
												data={
													isViewer
														? m.trend_tokens
														: metricMode === "cost"
															? (m.trend_cents ?? m.trend_tokens)
															: m.trend_tokens
												}
												color={rowColor}
												height={22}
											/>
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</Card>
		</div>
	)
}
