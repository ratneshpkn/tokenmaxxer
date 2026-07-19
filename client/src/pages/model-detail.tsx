import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"
import {
	Area,
	AreaChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	type TooltipValueType,
	XAxis,
	YAxis,
} from "recharts"
import { Link, useSearch } from "wouter"
import { DateRangeBar } from "@/components/DateRangeBar"
import { MetricPair } from "@/components/MetricPair"
import { SortHeader } from "@/components/SortHeader"
import { Sparkline } from "@/components/Sparkline"
import { Badge } from "@/components/ui/badge"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { useDateRange } from "@/lib/use-date-range"
import { useFirstRenderAnimation } from "@/lib/use-first-render-animation"
import { useMetricMode } from "@/lib/use-metric-mode"
import { usePrivacyMode } from "@/lib/use-privacy-mode"
import { formatCompact, formatNumber } from "@/lib/utils"

type SortKey = "email" | "cents" | "tokens" | "share"
type RawSortKey = "raw_model" | "cents" | "tokens" | "share"

export function ModelDetailPage({ model }: { model: string }): React.JSX.Element {
	const searchString = useSearch()
	const searchParams = new URLSearchParams(searchString)
	const urlPlatform = searchParams.get("platform")
	const platformFilter: "all" | "claude_code" | "cursor" =
		urlPlatform === "claude_code" || urlPlatform === "cursor" ? urlPlatform : "all"

	const [privacyOn] = usePrivacyMode()
	const [metricMode] = useMetricMode()
	const animating = useFirstRenderAnimation()
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isViewer = me ? me.role !== "admin" : true
	const trendMode = isViewer || metricMode === "tokens" ? "tokens" : "cost"

	const { from, to, winLabel } = useDateRange()

	const profileQuery = useQuery({
		queryKey: ["models.profile", model, from, to, platformFilter],
		queryFn: () => api.models.profile(model, from, to, platformFilter),
	})

	const topUsersQuery = useQuery({
		queryKey: ["models.topUsers", model, from, to, platformFilter, metricMode],
		queryFn: () => api.models.topUsers(model, from, to, platformFilter, 200, metricMode),
	})

	const trendQuery = useQuery({
		queryKey: ["models.trend", model, from, to, platformFilter],
		queryFn: () => api.models.trend(model, from, to, platformFilter),
	})

	const rawModelsQuery = useQuery({
		queryKey: ["models.rawModels", model, from, to, platformFilter],
		queryFn: () => api.models.rawModels(model, from, to, platformFilter),
	})

	const profile = profileQuery.data
	const topUsers = topUsersQuery.data ?? []
	const trendData = trendQuery.data ?? []
	const rawModels = rawModelsQuery.data ?? []

	const [filter, setFilter] = useState("")
	const [sortKey, setSortKey] = useState<SortKey>(isViewer ? "tokens" : "cents")
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

	const [rawFilter, setRawFilter] = useState("")
	const [rawSortKey, setRawSortKey] = useState<RawSortKey>(isViewer ? "tokens" : "cents")
	const [rawSortDir, setRawSortDir] = useState<"asc" | "desc">("desc")

	const rows = useMemo(() => {
		const f = filter.trim().toLowerCase()
		const filtered = f
			? topUsers.filter(
					(u) => u.email.toLowerCase().includes(f) || u.name?.toLowerCase().includes(f),
				)
			: topUsers

		const sortVal = (u: (typeof filtered)[number]): string | number => {
			switch (sortKey) {
				case "email":
					return u.name || u.email
				case "cents":
					return Number(u.cents ?? 0)
				case "tokens":
					return Number(u.tokens)
				case "share":
					return Number(u.share_pct)
			}
		}

		return [...filtered].sort((a, b) => {
			const av = sortVal(a)
			const bv = sortVal(b)
			const cmp =
				typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number)
			return sortDir === "asc" ? cmp : -cmp
		})
	}, [topUsers, filter, sortKey, sortDir])

	function toggle(k: SortKey): void {
		if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setSortKey(k)
			setSortDir(k === "email" ? "asc" : "desc")
		}
	}

	const rawModelRows = useMemo(() => {
		const f = rawFilter.trim().toLowerCase()
		const filtered = f ? rawModels.filter((u) => u.raw_model.toLowerCase().includes(f)) : rawModels

		const sortVal = (u: (typeof filtered)[number]): string | number => {
			switch (rawSortKey) {
				case "raw_model":
					return u.raw_model
				case "cents":
					return Number(u.cents ?? 0)
				case "tokens":
					return Number(u.tokens)
				case "share":
					return Number(u.share_pct)
			}
		}

		return [...filtered].sort((a, b) => {
			const av = sortVal(a)
			const bv = sortVal(b)
			const cmp =
				typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number)
			return rawSortDir === "asc" ? cmp : -cmp
		})
	}, [rawModels, rawFilter, rawSortKey, rawSortDir])

	function toggleRawSort(k: RawSortKey): void {
		if (rawSortKey === k) setRawSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setRawSortKey(k)
			setRawSortDir(k === "raw_model" ? "asc" : "desc")
		}
	}

	const chartData = useMemo(() => {
		return trendData.map((d) => {
			let val = 0
			if (trendMode === "cost") {
				val = (d.cc_cents ?? 0) + (d.cu_cents ?? 0)
			} else {
				val = d.cc_tokens + d.cu_tokens
			}
			return {
				date: d.date,
				value: val,
				cc_value: trendMode === "cost" ? (d.cc_cents ?? 0) : d.cc_tokens,
				cu_value: trendMode === "cost" ? (d.cu_cents ?? 0) : d.cu_tokens,
			}
		})
	}, [trendData, trendMode])

	const isSinglePlatform = platformFilter !== "all" || profile?.platforms.length === 1
	const primaryPlatform =
		platformFilter !== "all" ? platformFilter : profile?.platforms[0] || "claude_code"
	const chartColor = primaryPlatform === "claude_code" ? "var(--amber)" : "var(--sky)"

	return (
		<div className="space-y-6 fade-rise">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3 text-[10px] tracked text-fg-dim">
					<Link href="/models" className="hover:text-amber">
						◀ MODELS
					</Link>
					<span>/</span>
					<span className="text-fg flex items-center gap-2">
						{platformFilter === "all" ? (
							<>
								{profile?.platforms.includes("claude_code") && (
									<span className="w-1.5 h-1.5 bg-amber" />
								)}
								{profile?.platforms.includes("cursor") && <span className="w-1.5 h-1.5 bg-sky" />}
							</>
						) : (
							<span
								className={`w-1.5 h-1.5 ${platformFilter === "claude_code" ? "bg-amber" : "bg-sky"}`}
							/>
						)}
						{model}
					</span>
				</div>
			</div>

			{profile?.raw_models && profile.raw_models.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{profile.raw_models.map((rm) => (
						<Badge key={rm} variant="secondary" className="font-mono text-[10px]">
							{rm}
						</Badge>
					))}
				</div>
			)}

			<DateRangeBar updatedAt={profileQuery.dataUpdatedAt} />

			{/* Headline strip */}
			<section className="grid grid-cols-12 gap-px bg-line/60 border border-line">
				<div className="col-span-12 md:col-span-4 bg-bg p-6">
					<div className="text-[10px] tracked text-fg-dim mb-3">MODEL · {winLabel} TOTAL</div>
					<MetricPair
						cents={isViewer ? null : (profile?.total_cents ?? 0)}
						tokens={profile?.total_tokens ?? 0}
						digits={2}
						primaryClassName="font-display text-[72px] leading-none tracking-tight text-fg"
						secondaryClassName="mt-3 text-[11px] tracked text-fg-mid"
					/>
					<div className="mt-2 text-[11px] tracked text-fg-mid flex items-center gap-3">
						<span className="text-mint">●</span>
						<span>{profile?.active_users ?? 0} ACTIVE USERS</span>
					</div>
				</div>

				<div
					className={`col-span-6 md:col-span-4 bg-bg p-6 flex flex-col justify-between ${platformFilter === "cursor" ? "opacity-50" : ""}`}
				>
					<div className="text-[10px] tracked text-fg-dim flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-amber" /> CLAUDE CODE
					</div>
					<div>
						<MetricPair
							cents={isViewer ? null : (profile?.cc_cents ?? 0)}
							tokens={profile?.cc_tokens ?? 0}
							digits={2}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="text-[10px] tracked text-fg-dim mt-2"
						/>
					</div>
				</div>

				<div
					className={`col-span-6 md:col-span-4 bg-bg p-6 flex flex-col justify-between ${platformFilter === "claude_code" ? "opacity-50" : ""}`}
				>
					<div className="text-[10px] tracked text-fg-dim flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-sky" /> CURSOR
					</div>
					<div>
						<MetricPair
							cents={isViewer ? null : (profile?.cu_cents ?? 0)}
							tokens={profile?.cu_tokens ?? 0}
							digits={2}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="text-[10px] tracked text-fg-dim mt-2"
						/>
					</div>
				</div>
			</section>

			{/* Trend chart */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line">
					<span className="text-[11px] tracked text-fg">
						USAGE TREND · {winLabel} · {trendMode === "cost" ? "USD" : "TOKENS"}
					</span>
				</div>
				<div
					className="p-4"
					style={{
						height: 240,
						filter: privacyOn && trendMode === "cost" ? "blur(6px)" : undefined,
					}}
				>
					{chartData.length === 0 ? (
						<div className="h-full flex items-center justify-center text-xs text-fg-dim">
							── no trend data ──
						</div>
					) : (
						<ResponsiveContainer width="100%" height="100%">
							{isSinglePlatform ? (
								<AreaChart data={chartData} margin={{ top: 6, right: 8, bottom: 8, left: 0 }}>
									<CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
									<XAxis
										dataKey="date"
										axisLine={false}
										tickLine={false}
										tick={{ fill: "var(--fg-dim)", fontSize: 10 }}
									/>
									<YAxis
										axisLine={false}
										tickLine={false}
										tick={{ fill: "var(--fg-dim)", fontSize: 10 }}
										tickFormatter={(v: number) =>
											trendMode === "cost" ? `$${Math.round(v / 100)}` : formatCompact(v)
										}
										width={56}
									/>
									<Tooltip
										cursor={{ stroke: "var(--amber)", strokeDasharray: "2 2" }}
										contentStyle={{
											background: "var(--bg)",
											border: "1px solid var(--line-strong)",
											fontFamily: "JetBrains Mono",
											fontSize: 11,
										}}
										formatter={(v: TooltipValueType | undefined) =>
											trendMode === "cost"
												? `$${(Number(v ?? 0) / 100).toFixed(2)}`
												: formatNumber(Number(v ?? 0))
										}
									/>
									<Area
										type="monotone"
										dataKey="value"
										stroke={chartColor}
										fill={chartColor}
										fillOpacity={0.1}
										strokeWidth={1.5}
										isAnimationActive={animating}
									/>
								</AreaChart>
							) : (
								<LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 8, left: 0 }}>
									<CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
									<XAxis
										dataKey="date"
										axisLine={false}
										tickLine={false}
										tick={{ fill: "var(--fg-dim)", fontSize: 10 }}
									/>
									<YAxis
										axisLine={false}
										tickLine={false}
										tick={{ fill: "var(--fg-dim)", fontSize: 10 }}
										tickFormatter={(v: number) =>
											trendMode === "cost" ? `$${Math.round(v / 100)}` : formatCompact(v)
										}
										width={56}
									/>
									<Tooltip
										cursor={{ stroke: "var(--amber)", strokeDasharray: "2 2" }}
										contentStyle={{
											background: "var(--bg)",
											border: "1px solid var(--line-strong)",
											fontFamily: "JetBrains Mono",
											fontSize: 11,
										}}
										formatter={(v: TooltipValueType | undefined) =>
											trendMode === "cost"
												? `$${(Number(v ?? 0) / 100).toFixed(2)}`
												: formatNumber(Number(v ?? 0))
										}
									/>
									<Line
										type="monotone"
										dataKey="cc_value"
										name="Claude Code"
										stroke="var(--amber)"
										strokeWidth={1.5}
										dot={false}
										activeDot={{ r: 3 }}
										isAnimationActive={animating}
									/>
									<Line
										type="monotone"
										dataKey="cu_value"
										name="Cursor"
										stroke="var(--sky)"
										strokeWidth={1.5}
										dot={false}
										activeDot={{ r: 3 }}
										isAnimationActive={animating}
									/>
								</LineChart>
							)}
						</ResponsiveContainer>
					)}
				</div>
			</section>

			{/* Top Users table */}
			<section className="panel overflow-hidden">
				<div className="px-5 py-3 border-b border-line flex items-center justify-between">
					<span className="text-[11px] tracked text-fg">TOP USERS · {winLabel}</span>
					<div className="flex items-center gap-2 w-48">
						<Search className="w-3.5 h-3.5 text-fg-dim" />
						<input
							type="text"
							placeholder="filter..."
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							className="bg-transparent text-[11px] outline-none text-fg placeholder:text-fg-very-dim w-full"
						/>
					</div>
				</div>
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="h-9 w-10 px-3 text-[10px] tracked text-fg-very-dim text-right">
								#
							</TableHead>
							<SortHeader
								label="USER"
								active={sortKey === "email"}
								dir={sortDir}
								onClick={() => toggle("email")}
							/>
							<SortHeader
								label={`VALUE · ${winLabel}`}
								active={sortKey === "cents" || sortKey === "tokens"}
								dir={sortDir}
								onClick={() => toggle(trendMode === "cost" ? "cents" : "tokens")}
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
						{topUsersQuery.isLoading ? (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-fg-dim py-8 text-xs">
									── loading ──
								</TableCell>
							</TableRow>
						) : rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-fg-dim py-8 text-xs">
									── no users in window ──
								</TableCell>
							</TableRow>
						) : (
							rows.map((u, i) => {
								return (
									<TableRow key={u.email}>
										<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-very-dim">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Link
												href={`/users/${encodeURIComponent(u.email)}`}
												className="flex items-center min-w-0 group"
											>
												<span className="text-fg truncate group-hover:text-amber transition-colors">
													{u.name || u.email}
												</span>
											</Link>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg">
											<MetricPair
												cents={isViewer ? null : u.cents}
												tokens={u.tokens}
												digits={2}
												secondaryClassName="text-[10px] text-fg-dim"
											/>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg-dim text-[11px]">
											{Number(u.share_pct).toFixed(1)}%
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Sparkline
												data={
													isViewer
														? u.trend_tokens
														: metricMode === "cost"
															? (u.trend_cents ?? u.trend_tokens)
															: u.trend_tokens
												}
												color="var(--fg-mid)"
												height={22}
											/>
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</section>

			{/* Raw Models Breakdown table */}
			<section className="panel overflow-hidden">
				<div className="px-5 py-3 border-b border-line flex items-center justify-between">
					<span className="text-[11px] tracked text-fg">RAW MODELS BREAKDOWN · {winLabel}</span>
					<div className="flex items-center gap-2 w-48">
						<Search className="w-3.5 h-3.5 text-fg-dim" />
						<input
							type="text"
							placeholder="filter..."
							value={rawFilter}
							onChange={(e) => setRawFilter(e.target.value)}
							className="bg-transparent text-[11px] outline-none text-fg placeholder:text-fg-very-dim w-full"
						/>
					</div>
				</div>
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="h-9 w-10 px-3 text-[10px] tracked text-fg-very-dim text-right">
								#
							</TableHead>
							<SortHeader
								label="RAW MODEL"
								active={rawSortKey === "raw_model"}
								dir={rawSortDir}
								onClick={() => toggleRawSort("raw_model")}
							/>
							<SortHeader
								label={`VALUE · ${winLabel}`}
								active={rawSortKey === "cents" || rawSortKey === "tokens"}
								dir={rawSortDir}
								onClick={() => toggleRawSort(trendMode === "cost" ? "cents" : "tokens")}
								align="right"
							/>
							<SortHeader
								label="SHARE"
								active={rawSortKey === "share"}
								dir={rawSortDir}
								onClick={() => toggleRawSort("share")}
								align="right"
							/>
							<TableHead className="h-9 px-3 w-[140px] text-[10px] tracked text-fg-dim text-left">
								TREND · {winLabel}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rawModelsQuery.isLoading ? (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-fg-dim py-8 text-xs">
									── loading ──
								</TableCell>
							</TableRow>
						) : rawModelRows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-fg-dim py-8 text-xs">
									── no raw models in window ──
								</TableCell>
							</TableRow>
						) : (
							rawModelRows.map((u, i) => {
								return (
									<TableRow key={u.raw_model}>
										<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-very-dim">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<div className="flex items-center min-w-0">
												<span className="text-fg truncate font-mono">{u.raw_model}</span>
											</div>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg">
											<MetricPair
												cents={isViewer ? null : u.cents}
												tokens={u.tokens}
												digits={2}
												secondaryClassName="text-[10px] text-fg-dim"
											/>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg-dim text-[11px]">
											{Number(u.share_pct).toFixed(1)}%
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Sparkline
												data={
													isViewer
														? u.trend_tokens
														: metricMode === "cost"
															? (u.trend_cents ?? u.trend_tokens)
															: u.trend_tokens
												}
												color="var(--fg-mid)"
												height={22}
											/>
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</section>
		</div>
	)
}
