import { useQuery } from "@tanstack/react-query"
import { Filter } from "lucide-react"
import { useMemo, useState } from "react"
import { Link } from "wouter"
import { DateRangeBar } from "@/components/DateRangeBar"
import { MetricPair } from "@/components/MetricPair"
import { SortHeader } from "@/components/SortHeader"
import { Sparkline } from "@/components/Sparkline"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { platformColor, platformLabel } from "@/lib/platform"
import { useDateRange } from "@/lib/use-date-range"
import { useMetricMode } from "@/lib/use-metric-mode"

type SortKey = "model" | "platform" | "cents" | "tokens" | "share"

export function ModelsPage(): React.JSX.Element {
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isViewer = me ? me.role !== "admin" : false
	const [metricMode] = useMetricMode()
	const effectiveMode = isViewer ? "tokens" : metricMode

	const { from, to, winLabel } = useDateRange()
	const modelsQuery = useQuery({
		queryKey: ["models.list", from, to, metricMode],
		queryFn: () => api.dashboard.modelMix({ from, to }, 200, metricMode),
	})
	const data = modelsQuery.data ?? []
	const isLoading = modelsQuery.isLoading

	const [filter, setFilter] = useState("")
	const [platformFilter, setPlatformFilter] = useState<"all" | "claude_code" | "cursor">("all")
	const [sortKey, setSortKey] = useState<SortKey>(isViewer ? "tokens" : "cents")
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

	// Window totals for share %.
	const totalCents = useMemo(() => data.reduce((acc, m) => acc + Number(m.cents ?? 0), 0), [data])
	const totalTokens = useMemo(() => data.reduce((acc, m) => acc + Number(m.tokens), 0), [data])
	const denom = effectiveMode === "cost" ? totalCents : totalTokens

	const rows = useMemo(() => {
		const f = filter.trim().toLowerCase()
		let filtered = f
			? data.filter((m) => m.model.toLowerCase().includes(f) || m.platform.includes(f))
			: data
		if (platformFilter !== "all") {
			filtered = filtered.filter((m) => m.platform === platformFilter)
		}
		const sortVal = (m: (typeof filtered)[number]): string | number => {
			switch (sortKey) {
				case "model":
					return m.model
				case "platform":
					return m.platform
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
	}, [data, filter, platformFilter, sortKey, sortDir, isViewer])

	function toggle(k: SortKey): void {
		if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setSortKey(k)
			setSortDir(k === "model" || k === "platform" ? "asc" : "desc")
		}
	}

	return (
		<div className="space-y-4 fade-rise">
			<DateRangeBar updatedAt={modelsQuery.dataUpdatedAt} />
			<div className="flex items-end justify-between gap-4">
				<div className="text-[11px] tracked text-fg-dim leading-relaxed max-w-xl">
					{data.length} MODELS TRACKED · sorted by{" "}
					<span className="text-fg">{sortKey.toUpperCase()}</span>
				</div>
				<div className="flex items-center gap-2 max-w-xs w-full">
					<Input
						placeholder="filter by model name or platform…"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						className="flex-1"
					/>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="icon" className="shrink-0 h-9 w-9 bg-bg border-line">
								<Filter className="w-4 h-4 text-fg-dim" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent className="w-48" align="end">
							<DropdownMenuLabel>Filter by Platform</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem
								checked={platformFilter === "all"}
								onCheckedChange={() => setPlatformFilter("all")}
							>
								All Platforms
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem
								checked={platformFilter === "claude_code"}
								onCheckedChange={() => setPlatformFilter("claude_code")}
							>
								Claude Code
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem
								checked={platformFilter === "cursor"}
								onCheckedChange={() => setPlatformFilter("cursor")}
							>
								Cursor
							</DropdownMenuCheckboxItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			<div className="panel overflow-hidden">
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="h-9 w-10 px-3 text-[10px] tracked text-fg-very-dim text-right">
								#
							</TableHead>
							<SortHeader
								label="MODEL"
								active={sortKey === "model"}
								dir={sortDir}
								onClick={() => toggle("model")}
							/>
							<SortHeader
								label="PLATFORM"
								active={sortKey === "platform"}
								dir={sortDir}
								onClick={() => toggle("platform")}
							/>
							<SortHeader
								label={`VALUE · ${winLabel}`}
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
							<TableHead className="h-9 px-3 w-[140px] text-[10px] tracked text-fg-dim text-left">
								TREND · {winLabel}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell colSpan={7} className="text-center text-fg-dim py-8 text-xs">
									── loading ──
								</TableCell>
							</TableRow>
						) : rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={7} className="text-center text-fg-dim py-8 text-xs">
									── no models in window ──
								</TableCell>
							</TableRow>
						) : (
							rows.map((m, i) => {
								const value = effectiveMode === "cost" ? Number(m.cents ?? 0) : Number(m.tokens)
								const pct = denom > 0 ? (value / denom) * 100 : 0
								const pipColor = m.platform === "claude_code" ? "bg-amber" : "bg-sky"
								const sparkColor = platformColor(m.platform)
								return (
									<TableRow key={`${m.platform}-${m.model}`}>
										<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-very-dim">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Link
												href={`/models/${encodeURIComponent(m.model)}?platform=${m.platform}`}
												className="flex items-center gap-2 min-w-0 group"
											>
												<span className={`inline-block w-2 h-2 shrink-0 ${pipColor}`} />
												<span className="text-fg truncate group-hover:text-amber transition-colors">
													{m.model}
												</span>
											</Link>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-[10px] tracked text-fg-mid">
											{platformLabel(m.platform)}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg">
											<MetricPair
												cents={isViewer ? null : m.cents}
												tokens={m.tokens}
												digits={2}
												secondaryClassName="text-[10px] text-fg-dim"
											/>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg-dim text-[11px]">
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
												color={sparkColor}
												height={22}
											/>
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}
