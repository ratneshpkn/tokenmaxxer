import { useQuery } from "@tanstack/react-query"
import {
	ChevronDown,
	ChevronUp,
	Filter,
	PieChart as PieChartIcon,
	TrendingUp,
	Users,
	Zap,
} from "lucide-react"
import { useMemo, useState } from "react"
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Line,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts"
import { useLocation } from "wouter"
import { Cost } from "@/components/Cost"
import { MetricPair } from "@/components/MetricPair"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
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
import { useMetricMode } from "@/lib/use-metric-mode"
import { formatCompact, formatNumber } from "@/lib/utils"

type TeamSortField = "impactPoints" | "spend" | "prsMerged" | "efficiency"

const CATEGORY_COLORS: Record<string, string> = {
	feature: "#10b981",
	bugfix: "#38bdf8",
	refactor: "#a855f7",
	test: "#f59e0b",
	chore: "#94a3b8",
	docs: "#ec4899",
	other: "#64748b",
}

export function VelocityPage(): React.JSX.Element {
	const [, navigate] = useLocation()
	const { from, to } = useDateRange()
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isViewer = me ? me.role !== "admin" : false
	const [metricMode] = useMetricMode()
	const effectiveMode = isViewer ? "tokens" : metricMode

	const [selectedTeamId, setSelectedTeamId] = useState<string>("all")
	const [sortField, setSortField] = useState<TeamSortField>("impactPoints")
	const [sortAsc, setSortAsc] = useState(false)

	// Fetch Teams list for filter dropdown
	const { data: teamsData } = useQuery({
		queryKey: ["teams"],
		queryFn: () => api.teams.list(),
	})
	const teams = teamsData?.teams ?? []

	const teamQueryParam = selectedTeamId !== "all" ? selectedTeamId : undefined

	// 1. Summary query
	const { data: summary, isLoading: isSummaryLoading } = useQuery({
		queryKey: ["velocity.summary", from, to, selectedTeamId],
		queryFn: () => api.velocity.summary({ from, to, teamId: teamQueryParam }),
	})

	// 2. Categories query
	const { data: categoriesData, isLoading: isCategoriesLoading } = useQuery({
		queryKey: ["velocity.categories", from, to, selectedTeamId],
		queryFn: () => api.velocity.categories({ from, to, teamId: teamQueryParam }),
	})

	// 3. Teams breakdown query
	const { data: velocityTeamsData, isLoading: isTeamsLoading } = useQuery({
		queryKey: ["velocity.teams", from, to],
		queryFn: () => api.velocity.teams({ from, to }),
	})

	const velocityTeams = velocityTeamsData?.teams ?? []

	// Sorted teams
	const sortedTeams = useMemo(() => {
		const list = [...velocityTeams]
		return list.sort((a, b) => {
			let diff = 0
			if (sortField === "impactPoints") diff = a.impactPoints - b.impactPoints
			else if (sortField === "spend") {
				diff =
					effectiveMode === "tokens"
						? a.totalTokens - b.totalTokens
						: (a.totalCostCents ?? 0) - (b.totalCostCents ?? 0)
			} else if (sortField === "prsMerged") diff = a.prsMerged - b.prsMerged
			else if (sortField === "efficiency") {
				const effA =
					effectiveMode === "tokens"
						? (a.tokensPerImpactPoint ?? 0)
						: (a.costPerImpactPointCents ?? 0)
				const effB =
					effectiveMode === "tokens"
						? (b.tokensPerImpactPoint ?? 0)
						: (b.costPerImpactPointCents ?? 0)
				diff = effA - effB
			}
			return sortAsc ? diff : -diff
		})
	}, [velocityTeams, sortField, sortAsc, effectiveMode])

	// Trend chart data
	const trendChartData = useMemo(() => {
		if (!summary?.trend) return []
		return summary.trend.map((pt) => ({
			date: pt.date.slice(5), // MM-DD
			impactPoints: pt.impactPoints,
			prsMerged: pt.prsMerged,
			spend:
				effectiveMode === "tokens"
					? pt.tokens
					: pt.costCents != null
						? Number((pt.costCents / 100).toFixed(2))
						: 0,
		}))
	}, [summary?.trend, effectiveMode])

	const handleSort = (field: TeamSortField) => {
		if (sortField === field) {
			setSortAsc(!sortAsc)
		} else {
			setSortField(field)
			setSortAsc(false)
		}
	}

	return (
		<div className="space-y-6 fade-rise">
			{/* ── Header & Filters ────────────────────────────────────────── */}
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-5">
				<div>
					<div className="flex items-center gap-2">
						<Zap className="w-5 h-5 text-mint" />
						<Typography variant="heading" className="tracking-tight text-fg font-display text-2xl">
							VELOCITY & ROI
						</Typography>
					</div>
					<Typography variant="muted" className="mt-1">
						Correlating AI tooling consumption with engineering output, PR complexity, and delivery
						trends.
					</Typography>
				</div>

				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<Filter className="w-4 h-4 text-muted-foreground" />
						<Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
							<SelectTrigger className="w-[180px] bg-card border-line h-9 text-xs">
								<SelectValue placeholder="All Teams" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Teams</SelectItem>
								{teams.map((t) => (
									<SelectItem key={t.id} value={t.id}>
										{t.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			</div>

			{/* ── KPI Hero Grid ───────────────────────────────────────────── */}
			<section className="grid grid-cols-12 gap-px bg-line/60 border border-line">
				{/* 1. Total AI Spend / Tokens */}
				<div className="col-span-12 sm:col-span-6 lg:col-span-3 bg-bg p-5">
					<Typography variant="label" as="div" className="mb-2">
						{isViewer ? "TOTAL AI TOKENS" : "TOTAL AI SPEND"}
					</Typography>
					<div className="mt-1">
						{isSummaryLoading ? (
							<Skeleton className="h-10 w-28 my-1" />
						) : (
							<MetricPair
								cents={isViewer ? null : summary?.totalCostCents}
								tokens={summary?.totalTokens ?? 0}
								digits={0}
								primaryClassName="font-display text-3xl sm:text-4xl text-fg"
								secondaryClassName="mt-1"
							/>
						)}
						<Typography variant="subtle" className="mt-2 block">
							Across {summary?.activeEngineersCount ?? 0} active engineers
						</Typography>
					</div>
				</div>

				{/* 2. PRs Merged & Substantive */}
				<div className="col-span-12 sm:col-span-6 lg:col-span-3 bg-bg p-5">
					<Typography variant="label" as="div" className="mb-2">
						PULL REQUESTS MERGED
					</Typography>
					<div className="mt-1">
						{isSummaryLoading ? (
							<Skeleton className="h-10 w-24 my-1" />
						) : (
							<div className="font-display text-3xl sm:text-4xl text-fg">
								{formatNumber(summary?.totalPrsMerged ?? 0)}
							</div>
						)}
						<Typography variant="subtle" className="mt-2 block text-mint">
							{summary?.substantivePrCount ?? 0} substantive (L4+L5) ·{" "}
							{summary?.totalPrsOpened ?? 0} opened
						</Typography>
					</div>
				</div>

				{/* 3. Total Impact Points */}
				<div className="col-span-12 sm:col-span-6 lg:col-span-3 bg-bg p-5">
					<Typography variant="label" as="div" className="mb-2">
						GROUNDED IMPACT POINTS
					</Typography>
					<div className="mt-1">
						{isSummaryLoading ? (
							<Skeleton className="h-10 w-24 my-1" />
						) : (
							<div className="font-display text-3xl sm:text-4xl text-fg">
								{formatNumber(summary?.totalImpactPoints ?? 0)}{" "}
								<span className="text-sm font-normal text-muted-foreground">pts</span>
							</div>
						)}
						<Typography variant="subtle" className="mt-2 block">
							Avg complexity: {summary?.averageComplexity ?? "—"}/5 ·{" "}
							{summary?.totalEnrichedPrs ?? 0} analyzed
						</Typography>
					</div>
				</div>

				{/* 4. Unit Cost per Impact Point */}
				<div className="col-span-12 sm:col-span-6 lg:col-span-3 bg-bg p-5">
					<Typography variant="label" as="div" className="mb-2">
						{isViewer ? "TOKENS PER IMPACT PT" : "COST PER IMPACT PT"}
					</Typography>
					<div className="mt-1">
						{isSummaryLoading ? (
							<Skeleton className="h-10 w-28 my-1" />
						) : isViewer ? (
							<div className="font-display text-3xl sm:text-4xl text-fg">
								{summary?.tokensPerImpactPoint
									? `${formatCompact(summary.tokensPerImpactPoint)} tok`
									: "—"}
							</div>
						) : (
							<div className="font-display text-3xl sm:text-4xl text-fg">
								{summary?.costPerImpactPointCents != null ? (
									<Cost cents={summary.costPerImpactPointCents} digits={2} />
								) : (
									"—"
								)}
								<span className="text-xs font-normal text-muted-foreground ml-1">/ pt</span>
							</div>
						)}
						<Typography variant="subtle" className="mt-2 block">
							{!isViewer && summary?.tokensPerImpactPoint
								? `${formatCompact(summary.tokensPerImpactPoint)} tokens per impact pt`
								: summary?.costPerPrCents != null
									? "Avg cost per PR: "
									: "Delivery ROI efficiency metric"}
							{!isViewer && summary?.costPerPrCents != null && (
								<Cost cents={summary.costPerPrCents} digits={0} />
							)}
						</Typography>
					</div>
				</div>
			</section>

			{/* ── Correlation Trend Chart (Spend vs Output Over Time) ─────── */}
			<Card className="bg-card border-line">
				<CardHeader className="pb-2">
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
						<div>
							<CardTitle className="text-base font-medium text-fg flex items-center gap-2">
								<TrendingUp className="w-4 h-4 text-mint" />
								Velocity & Consumption Trend
							</CardTitle>
							<CardDescription className="text-xs">
								Comparing engineering impact points shipped against AI token and spend volume.
							</CardDescription>
						</div>
						<div className="flex items-center gap-4 text-xs text-muted-foreground">
							<span className="flex items-center gap-1.5">
								<span className="w-3 h-3 rounded-xs bg-mint/80" /> Impact Points
							</span>
							<span className="flex items-center gap-1.5">
								<span className="w-3 h-0.5 bg-sky-400" />{" "}
								{effectiveMode === "tokens" ? "Tokens" : "Spend ($)"}
							</span>
						</div>
					</div>
				</CardHeader>
				<CardContent className="pt-4">
					{isSummaryLoading ? (
						<div className="h-72 flex items-center justify-center">
							<Skeleton className="h-64 w-full" />
						</div>
					) : trendChartData.length === 0 ? (
						<div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
							No activity recorded for this period.
						</div>
					) : (
						<div className="h-72 w-full">
							<ResponsiveContainer width="100%" height="100%">
								<ComposedChart
									data={trendChartData}
									margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
								>
									<CartesianGrid strokeDasharray="3 3" stroke="var(--line)" opacity={0.5} />
									<XAxis dataKey="date" stroke="var(--muted-fg)" fontSize={11} tickLine={false} />
									<YAxis
										yAxisId="impact"
										orientation="left"
										stroke="var(--muted-fg)"
										fontSize={11}
										tickLine={false}
										unit=" pts"
									/>
									<YAxis
										yAxisId="spend"
										orientation="right"
										stroke="var(--muted-fg)"
										fontSize={11}
										tickLine={false}
										unit={effectiveMode === "tokens" ? "" : "$"}
										tickFormatter={(v) => (effectiveMode === "tokens" ? formatCompact(v) : `$${v}`)}
									/>
									<RechartsTooltip
										content={({ active, payload, label }) => {
											if (!active || !payload?.length) return null
											const pt = payload[0].payload
											return (
												<div className="bg-popover border border-line p-3 rounded-md shadow-xl text-xs space-y-1.5 min-w-[180px]">
													<div className="font-semibold text-fg border-b border-line pb-1">
														Date: {label}
													</div>
													<div className="flex justify-between items-center text-mint">
														<span>Impact Points:</span>
														<span className="font-mono font-medium">{pt.impactPoints} pts</span>
													</div>
													<div className="flex justify-between items-center text-muted-foreground">
														<span>PRs Merged:</span>
														<span className="font-mono text-fg">{pt.prsMerged}</span>
													</div>
													<div className="flex justify-between items-center text-sky-400">
														<span>AI Consumption:</span>
														<span className="font-mono font-medium">
															{effectiveMode === "tokens"
																? `${formatCompact(pt.spend)} tok`
																: `$${pt.spend.toFixed(2)}`}
														</span>
													</div>
												</div>
											)
										}}
									/>
									<Bar
										yAxisId="impact"
										dataKey="impactPoints"
										name="Impact Points"
										fill="#10b981"
										radius={[3, 3, 0, 0]}
										opacity={0.85}
										maxBarSize={32}
									/>
									<Line
										yAxisId="spend"
										type="monotone"
										dataKey="spend"
										name={effectiveMode === "tokens" ? "Tokens" : "Spend ($)"}
										stroke="#38bdf8"
										strokeWidth={2}
										dot={false}
									/>
								</ComposedChart>
							</ResponsiveContainer>
						</div>
					)}
				</CardContent>
			</Card>

			{/* ── Two Columns: Team Breakdown & Delivery by Category ────────── */}
			<div className="grid grid-cols-12 gap-6">
				{/* Team Velocity Table */}
				<Card className="col-span-12 lg:col-span-8 bg-card border-line flex flex-col">
					<CardHeader className="pb-3 border-b border-line">
						<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
							<div>
								<CardTitle className="text-base font-medium text-fg flex items-center gap-2">
									<Users className="w-4 h-4 text-mint" />
									Team Velocity & Adoption
								</CardTitle>
								<CardDescription className="text-xs">
									Team-level delivery throughput, grounded impact points, and tooling consumption.
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent className="p-0 flex-1">
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow className="border-b border-line hover:bg-transparent">
										<TableHead className="w-[200px] text-xs font-semibold">Team</TableHead>
										<TableHead
											className="text-xs font-semibold cursor-pointer select-none text-right"
											onClick={() => handleSort("impactPoints")}
										>
											<div className="flex items-center justify-end gap-1">
												Impact Points
												{sortField === "impactPoints" &&
													(sortAsc ? (
														<ChevronUp className="w-3 h-3" />
													) : (
														<ChevronDown className="w-3 h-3" />
													))}
											</div>
										</TableHead>
										<TableHead
											className="text-xs font-semibold cursor-pointer select-none text-right"
											onClick={() => handleSort("prsMerged")}
										>
											<div className="flex items-center justify-end gap-1">
												Merged PRs
												{sortField === "prsMerged" &&
													(sortAsc ? (
														<ChevronUp className="w-3 h-3" />
													) : (
														<ChevronDown className="w-3 h-3" />
													))}
											</div>
										</TableHead>
										<TableHead
											className="text-xs font-semibold cursor-pointer select-none text-right"
											onClick={() => handleSort("spend")}
										>
											<div className="flex items-center justify-end gap-1">
												{effectiveMode === "tokens" ? "Tokens Burned" : "AI Spend"}
												{sortField === "spend" &&
													(sortAsc ? (
														<ChevronUp className="w-3 h-3" />
													) : (
														<ChevronDown className="w-3 h-3" />
													))}
											</div>
										</TableHead>
										<TableHead
											className="text-xs font-semibold cursor-pointer select-none text-right"
											onClick={() => handleSort("efficiency")}
										>
											<div className="flex items-center justify-end gap-1">
												{effectiveMode === "tokens" ? "Tokens / Point" : "Cost / Point"}
												{sortField === "efficiency" &&
													(sortAsc ? (
														<ChevronUp className="w-3 h-3" />
													) : (
														<ChevronDown className="w-3 h-3" />
													))}
											</div>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{isTeamsLoading ? (
										["skel-t1", "skel-t2", "skel-t3"].map((skelId) => (
											<TableRow key={skelId} className="border-b border-line">
												<TableCell colSpan={5} className="py-4">
													<Skeleton className="h-6 w-full" />
												</TableCell>
											</TableRow>
										))
									) : sortedTeams.length === 0 ? (
										<TableRow>
											<TableCell
												colSpan={5}
												className="h-32 text-center text-xs text-muted-foreground"
											>
												No teams found or no team activity in this window.
											</TableCell>
										</TableRow>
									) : (
										sortedTeams.map((t) => (
											<TableRow
												key={t.teamId}
												className="border-b border-line hover:bg-elev1 cursor-pointer transition-colors"
												onClick={() => navigate(`/teams/${t.teamId}`)}
											>
												<TableCell className="font-medium text-xs text-fg py-3">
													<div className="flex items-center gap-2">
														<span>{t.teamName}</span>
														<Badge
															variant="outline"
															className="text-[10px] px-1.5 py-0 border-line text-muted-foreground"
														>
															{t.memberCount} {t.memberCount === 1 ? "member" : "members"}
														</Badge>
													</div>
												</TableCell>
												<TableCell className="font-mono text-xs text-right text-fg py-3">
													<span className="font-semibold text-mint">{t.impactPoints}</span> pts
												</TableCell>
												<TableCell className="font-mono text-xs text-right text-fg py-3">
													{t.prsMerged}
													{t.substantivePrCount > 0 && (
														<span className="text-[10px] text-muted-foreground ml-1">
															({t.substantivePrCount} L4+)
														</span>
													)}
												</TableCell>
												<TableCell className="font-mono text-xs text-right text-fg py-3">
													{!isViewer && t.totalCostCents != null ? (
														<Cost cents={t.totalCostCents} digits={2} />
													) : (
														`${formatCompact(t.totalTokens)} tok`
													)}
												</TableCell>
												<TableCell className="font-mono text-xs text-right text-muted-foreground py-3">
													{!isViewer && t.costPerImpactPointCents != null ? (
														<span>
															<Cost cents={t.costPerImpactPointCents} digits={2} />
															<span className="text-[10px] text-muted-foreground ml-0.5">/ pt</span>
														</span>
													) : t.tokensPerImpactPoint ? (
														`${formatCompact(t.tokensPerImpactPoint)} tok/pt`
													) : (
														"—"
													)}
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
					</CardContent>
				</Card>

				{/* PR Work-Type Categories */}
				<Card className="col-span-12 lg:col-span-4 bg-card border-line flex flex-col">
					<CardHeader className="pb-2">
						<CardTitle className="text-base font-medium text-fg flex items-center gap-2">
							<PieChartIcon className="w-4 h-4 text-mint" />
							Delivery by Work-Type
						</CardTitle>
						<CardDescription className="text-xs">
							Distribution of pull requests by category & complexity.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex-1 pt-2">
						{isCategoriesLoading ? (
							<div className="space-y-4 pt-2">
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-8 w-full" />
							</div>
						) : !categoriesData || categoriesData.categories.length === 0 ? (
							<div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
								No categorized pull requests found.
							</div>
						) : (
							<div className="space-y-3.5 mt-1">
								{categoriesData.categories.map((cat) => {
									const color = CATEGORY_COLORS[cat.category.toLowerCase()] || CATEGORY_COLORS.other
									return (
										<div key={cat.category} className="space-y-1">
											<div className="flex items-center justify-between text-xs">
												<span className="flex items-center gap-2 capitalize font-medium text-fg">
													<span
														className="w-2 h-2 rounded-full"
														style={{ backgroundColor: color }}
													/>
													{cat.category}
												</span>
												<span className="font-mono text-muted-foreground">
													{cat.impactPoints} pts ({cat.sharePct}%)
												</span>
											</div>
											<div className="w-full h-1.5 bg-line/60 rounded-full overflow-hidden">
												<div
													className="h-full rounded-full transition-all"
													style={{
														width: `${Math.max(4, cat.sharePct)}%`,
														backgroundColor: color,
													}}
												/>
											</div>
											<div className="flex justify-between text-[10px] text-muted-foreground">
												<span>
													{cat.prCount} PRs · {cat.substantiveCount} substantive
												</span>
												<span>Avg score: {cat.avgComplexity}/5</span>
											</div>
										</div>
									)
								})}
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
