import { useQuery } from "@tanstack/react-query"
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
import { MetricPair } from "@/components/MetricPair"
import { SearchInput } from "@/components/SearchInput"
import { SectionHeader } from "@/components/SectionHeader"
import { SortHeader } from "@/components/SortHeader"
import { Sparkline } from "@/components/Sparkline"
import { TableStateRow } from "@/components/TableStateRow"
import { UserLink } from "@/components/UserLink"
import { Badge } from "@/components/ui/badge"
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
				<Typography variant="label" as="div" className="flex items-center gap-3">
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
				</Typography>
			</div>

			{profile?.raw_models && profile.raw_models.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{profile.raw_models.map((rm) => (
						<Badge key={rm} variant="secondary" className="font-mono text-xs">
							{rm}
						</Badge>
					))}
				</div>
			)}

			{/* Headline strip */}
			<section className="grid grid-cols-12 gap-px bg-line/60 border border-line">
				<div className="col-span-12 md:col-span-4 bg-bg p-6">
					<Typography variant="label" as="div" className="mb-3">
						MODEL · {winLabel} TOTAL
					</Typography>
					<MetricPair
						cents={isViewer ? null : (profile?.total_cents ?? 0)}
						tokens={profile?.total_tokens ?? 0}
						digits={2}
						primaryClassName="font-display text-4xl sm:text-5xl md:text-[72px] leading-none tracking-tight text-fg"
						secondaryClassName="mt-3"
					/>
					<div className="mt-2 flex items-center gap-3">
						<span className="text-mint">●</span>
						<Typography variant="label">{profile?.active_users ?? 0} ACTIVE USERS</Typography>
					</div>
				</div>

				<div
					className={`col-span-6 md:col-span-4 bg-bg p-6 flex flex-col justify-between ${platformFilter === "cursor" ? "opacity-50" : ""}`}
				>
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-amber" /> CLAUDE CODE
					</Typography>
					<div>
						<MetricPair
							cents={isViewer ? null : (profile?.cc_cents ?? 0)}
							tokens={profile?.cc_tokens ?? 0}
							digits={2}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="mt-2"
						/>
					</div>
				</div>

				<div
					className={`col-span-6 md:col-span-4 bg-bg p-6 flex flex-col justify-between ${platformFilter === "claude_code" ? "opacity-50" : ""}`}
				>
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-sky" /> CURSOR
					</Typography>
					<div>
						<MetricPair
							cents={isViewer ? null : (profile?.cu_cents ?? 0)}
							tokens={profile?.cu_tokens ?? 0}
							digits={2}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="mt-2"
						/>
					</div>
				</div>
			</section>

			{/* Trend chart */}
			<Card>
				<SectionHeader
					title="USAGE TREND"
					subtitle={`${winLabel} · ${trendMode === "cost" ? "USD" : "TOKENS"}`}
				/>
				<div
					className="p-4"
					style={{
						height: 240,
						filter: privacyOn && trendMode === "cost" ? "blur(6px)" : undefined,
					}}
				>
					{chartData.length === 0 ? (
						<div className="h-full flex items-center justify-center text-xs text-fg-muted">
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
										tick={{ fill: "var(--fg-muted)", fontSize: 10 }}
									/>
									<YAxis
										axisLine={false}
										tickLine={false}
										tick={{ fill: "var(--fg-muted)", fontSize: 10 }}
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
										tick={{ fill: "var(--fg-muted)", fontSize: 10 }}
									/>
									<YAxis
										axisLine={false}
										tickLine={false}
										tick={{ fill: "var(--fg-muted)", fontSize: 10 }}
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
			</Card>

			{/* Top Users table */}
			<Card className="overflow-hidden">
				<SectionHeader
					title="TOP USERS"
					subtitle={winLabel}
					action={<SearchInput value={filter} onChange={setFilter} placeholder="filter…" />}
				/>
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="w-14 text-right">#</TableHead>
							<SortHeader
								label="USER"
								active={sortKey === "email"}
								dir={sortDir}
								onClick={() => toggle("email")}
							/>
							<SortHeader
								label="VALUE"
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
							<TableHead className="w-[140px]">TREND</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{topUsersQuery.isLoading || rows.length === 0 ? (
							<TableStateRow
								colSpan={5}
								isLoading={topUsersQuery.isLoading}
								emptyText="no users in window"
							/>
						) : (
							rows.map((u, i) => {
								return (
									<TableRow key={u.email}>
										<TableCell className="px-3 py-2.5 text-right text-xs tabular text-fg-subtle">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<UserLink email={u.email} name={u.name} />
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg">
											<MetricPair cents={isViewer ? null : u.cents} tokens={u.tokens} digits={2} />
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg-muted text-xs">
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
												color="var(--fg-muted)"
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

			{/* Raw Models Breakdown table */}
			<Card className="overflow-hidden">
				<SectionHeader
					title="RAW MODELS BREAKDOWN"
					subtitle={winLabel}
					action={<SearchInput value={rawFilter} onChange={setRawFilter} placeholder="filter…" />}
				/>
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="w-14 text-right">#</TableHead>
							<SortHeader
								label="RAW MODEL"
								active={rawSortKey === "raw_model"}
								dir={rawSortDir}
								onClick={() => toggleRawSort("raw_model")}
							/>
							<SortHeader
								label="VALUE"
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
							<TableHead className="w-[140px]">TREND</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rawModelsQuery.isLoading || rawModelRows.length === 0 ? (
							<TableStateRow
								colSpan={5}
								isLoading={rawModelsQuery.isLoading}
								emptyText="no raw models in window"
							/>
						) : (
							rawModelRows.map((u, i) => {
								return (
									<TableRow key={u.raw_model}>
										<TableCell className="px-3 py-2.5 text-right text-xs tabular text-fg-subtle">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<div className="flex items-center min-w-0">
												<span className="text-fg truncate font-mono">{u.raw_model}</span>
											</div>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg">
											<MetricPair cents={isViewer ? null : u.cents} tokens={u.tokens} digits={2} />
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg-muted text-xs">
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
												color="var(--fg-muted)"
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
