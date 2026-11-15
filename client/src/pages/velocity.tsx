import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Line,
	ResponsiveContainer,
	Tooltip,
	type TooltipPayloadEntry,
	XAxis,
	YAxis,
} from "recharts"
import { useLocation, useSearch } from "wouter"
import { Cost } from "@/components/Cost"
import { MetricPair } from "@/components/MetricPair"
import { SectionHeader } from "@/components/SectionHeader"
import { SortHeader } from "@/components/SortHeader"
import { TableStateRow } from "@/components/TableStateRow"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { useFirstRenderAnimation } from "@/lib/use-first-render-animation"
import { useMetricMode } from "@/lib/use-metric-mode"
import { usePrivacyMode } from "@/lib/use-privacy-mode"
import { formatCompact, formatNumber } from "@/lib/utils"

type TeamSortField = "impactPoints" | "spend" | "prsMerged" | "efficiency"

const CATEGORY_COLORS: Record<string, string> = {
	feature: "var(--mint)",
	bug_fix: "var(--sky)",
	bugfix: "var(--sky)",
	refactor: "var(--amber)",
	infrastructure: "var(--fg-subtle)",
	test: "var(--warn)",
	chore: "var(--fg-subtle)",
	docs: "var(--chart-5)",
	other: "var(--line-strong)",
}

function StatTooltip({
	active,
	payload,
	mode,
}: {
	active?: boolean
	payload?: readonly TooltipPayloadEntry[]
	mode: "usd" | "tokens"
}): React.JSX.Element | null {
	if (!active || !payload?.length) return null
	const pt = payload[0].payload
	return (
		<div className="bg-bg/95 border border-line-strong px-3 py-2 text-xs tabular">
			<div className="text-fg-muted tracked-sm text-[9px] mb-1">{pt?.date ?? ""}</div>
			{payload.map((p) => {
				const key = String(p.dataKey ?? "")
				const isSpend = key.includes("Spend") || key.includes("Tokens")
				return (
					<div key={key} className="flex items-center justify-between gap-4">
						<span className="flex items-center gap-1.5">
							<span className="w-2 h-2" style={{ background: p.color || (p.fill as string) }} />
							<span className="text-fg-muted">{key}</span>
						</span>
						<span className="text-fg">
							{isSpend
								? mode === "usd"
									? `$${Number(p.value).toFixed(2)}`
									: formatCompact(Number(p.value))
								: `${Number(p.value)} pts`}
						</span>
					</div>
				)
			})}
		</div>
	)
}

export function VelocityPage(): React.JSX.Element {
	const [, navigate] = useLocation()
	const searchString = useSearch()
	const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString])
	const paramTeamId = searchParams.get("teamId")

	const { from, to, winLabel } = useDateRange()
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isViewer = me ? me.role !== "admin" : false
	const [privacyOn] = usePrivacyMode()
	const animating = useFirstRenderAnimation()
	const [metricMode] = useMetricMode()
	const effectiveMode = isViewer ? "tokens" : metricMode
	const trendMode: "usd" | "tokens" = isViewer || metricMode === "tokens" ? "tokens" : "usd"

	const [selectedTeamId, setSelectedTeamId] = useState<string>(paramTeamId || "all")
	useEffect(() => {
		if (paramTeamId) setSelectedTeamId(paramTeamId)
	}, [paramTeamId])

	const [sortField, setSortField] = useState<TeamSortField>("impactPoints")
	const [sortAsc, setSortAsc] = useState(false)

	const { data: teamsData } = useQuery({ queryKey: ["teams"], queryFn: () => api.teams.list() })
	const teams = teamsData?.teams ?? []
	const teamQueryParam = selectedTeamId !== "all" ? selectedTeamId : undefined

	const { data: summary, isLoading: isSummaryLoading } = useQuery({
		queryKey: ["velocity.summary", from, to, selectedTeamId],
		queryFn: () => api.velocity.summary({ from, to, teamId: teamQueryParam }),
	})

	const { data: categoriesData, isLoading: isCategoriesLoading } = useQuery({
		queryKey: ["velocity.categories", from, to, selectedTeamId],
		queryFn: () => api.velocity.categories({ from, to, teamId: teamQueryParam }),
	})

	const { data: velocityTeamsData, isLoading: isTeamsLoading } = useQuery({
		queryKey: ["velocity.teams", from, to],
		queryFn: () => api.velocity.teams({ from, to }),
	})
	const velocityTeams = velocityTeamsData?.teams ?? []

	const sortedTeams = useMemo(() => {
		return [...velocityTeams].sort((a, b) => {
			const valA =
				sortField === "impactPoints"
					? a.impactPoints
					: sortField === "prsMerged"
						? a.prsMerged
						: sortField === "spend"
							? effectiveMode === "tokens"
								? a.totalTokens
								: (a.totalCostCents ?? 0)
							: effectiveMode === "tokens"
								? (a.tokensPerImpactPoint ?? 0)
								: (a.costPerImpactPointCents ?? 0)
			const valB =
				sortField === "impactPoints"
					? b.impactPoints
					: sortField === "prsMerged"
						? b.prsMerged
						: sortField === "spend"
							? effectiveMode === "tokens"
								? b.totalTokens
								: (b.totalCostCents ?? 0)
							: effectiveMode === "tokens"
								? (b.tokensPerImpactPoint ?? 0)
								: (b.costPerImpactPointCents ?? 0)
			return sortAsc ? valA - valB : valB - valA
		})
	}, [velocityTeams, sortField, sortAsc, effectiveMode])

	const trendChartData = useMemo(() => {
		return (summary?.trend ?? []).map((pt) => ({
			date: pt.date.slice(5),
			"Impact Points": pt.impactPoints,
			"PRs Merged": pt.prsMerged,
			[trendMode === "usd" ? "AI Spend ($)" : "AI Tokens"]:
				trendMode === "usd"
					? pt.costCents != null
						? Number((pt.costCents / 100).toFixed(2))
						: 0
					: pt.tokens,
		}))
	}, [summary?.trend, trendMode])

	const handleSort = (field: TeamSortField) => {
		if (sortField === field) setSortAsc(!sortAsc)
		else {
			setSortField(field)
			setSortAsc(false)
		}
	}

	return (
		<div className="space-y-6 fade-rise">
			{/* ── Subnav / Team Filter Bar ───────────────────────────────── */}
			<div className="flex items-end justify-between gap-4">
				<Typography variant="label" className="max-w-xl">
					VELOCITY & ROI · {winLabel} ·{" "}
					<span className="text-fg">
						{selectedTeamId === "all"
							? "ALL TEAMS"
							: (teams.find((t) => t.id === selectedTeamId)?.name.toUpperCase() ?? "TEAM")}
					</span>
				</Typography>
				{teams.length > 0 && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								className="h-8 text-xs font-mono bg-bg border-line shrink-0"
							>
								{selectedTeamId === "all"
									? "ALL TEAMS"
									: (teams.find((t) => t.id === selectedTeamId)?.name.toUpperCase() ?? "TEAM")}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-48 font-mono text-xs">
							<DropdownMenuLabel>Filter by Team</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem
								checked={selectedTeamId === "all"}
								onCheckedChange={() => setSelectedTeamId("all")}
							>
								ALL TEAMS
							</DropdownMenuCheckboxItem>
							<DropdownMenuSeparator />
							{teams.map((t) => (
								<DropdownMenuCheckboxItem
									key={t.id}
									checked={selectedTeamId === t.id}
									onCheckedChange={() => setSelectedTeamId(t.id)}
								>
									{t.name.toUpperCase()}
								</DropdownMenuCheckboxItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>

			{/* ── Headline KPI Band ───────────────────────────────────────── */}
			<section className="grid grid-cols-12 gap-px bg-line/60 border border-line">
				<div className="col-span-12 md:col-span-3 bg-bg p-6">
					<Typography variant="label" as="div" className="mb-3">
						{effectiveMode === "tokens" ? "TOTAL AI TOKENS" : "TOTAL AI SPEND"} · {winLabel}
					</Typography>
					{isSummaryLoading ? (
						<Skeleton className="h-20 w-full" />
					) : (
						<div className="num-tick">
							<MetricPair
								cents={isViewer ? null : summary?.totalCostCents}
								tokens={summary?.totalTokens ?? 0}
								digits={0}
								primaryClassName="font-display text-4xl sm:text-5xl md:text-6xl leading-none tracking-tight text-fg"
								secondaryClassName="mt-2"
							/>
							<div className="mt-2 flex items-center gap-3">
								<span className="text-mint">●</span>
								<Typography variant="label">
									{summary?.activeEngineersCount ?? 0} ACTIVE USERS
								</Typography>
							</div>
						</div>
					)}
				</div>

				<div className="col-span-6 md:col-span-3 bg-bg p-6 flex flex-col justify-between">
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-mint" /> PULL REQUESTS MERGED
					</Typography>
					<div>
						{isSummaryLoading ? (
							<Skeleton className="h-8 w-24 my-1" />
						) : (
							<div className="font-mono text-3xl tabular text-fg leading-none">
								{formatNumber(summary?.totalPrsMerged ?? 0)}
							</div>
						)}
						<Typography variant="label" as="div" className="mt-2">
							{summary?.substantivePrCount ?? 0} substantive (L4+L5)
						</Typography>
						<Typography variant="caption" as="div" className="mt-1">
							{summary?.totalPrsOpened ?? 0} opened in window
						</Typography>
					</div>
				</div>

				<div className="col-span-6 md:col-span-3 bg-bg p-6 flex flex-col justify-between">
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-amber" /> GROUNDED IMPACT
					</Typography>
					<div>
						{isSummaryLoading ? (
							<Skeleton className="h-8 w-24 my-1" />
						) : (
							<div className="font-mono text-3xl tabular text-fg leading-none">
								{formatNumber(summary?.totalImpactPoints ?? 0)}{" "}
								<span className="text-sm font-normal text-fg-muted">pts</span>
							</div>
						)}
						<Typography variant="label" as="div" className="mt-2">
							Avg complexity: {summary?.averageComplexity ?? "—"}/5
						</Typography>
						<Typography variant="caption" as="div" className="mt-1">
							{summary?.totalEnrichedPrs ?? 0} enriched PRs
						</Typography>
					</div>
				</div>

				<div className="col-span-12 md:col-span-3 bg-bg p-6 flex flex-col justify-between">
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-sky" />{" "}
						{effectiveMode === "tokens" ? "TOKENS / IMPACT PT" : "COST / IMPACT PT"}
					</Typography>
					<div>
						{isSummaryLoading ? (
							<Skeleton className="h-8 w-28 my-1" />
						) : effectiveMode === "tokens" ? (
							<div className="font-mono text-3xl tabular text-fg leading-none">
								{summary?.tokensPerImpactPoint
									? `${formatCompact(summary.tokensPerImpactPoint)} tok`
									: "—"}
							</div>
						) : (
							<div className="font-mono text-3xl tabular text-fg leading-none">
								{summary?.costPerImpactPointCents != null ? (
									<Cost cents={summary.costPerImpactPointCents} digits={2} />
								) : (
									"—"
								)}
							</div>
						)}
						<Typography variant="label" as="div" className="mt-2">
							{effectiveMode !== "tokens" && summary?.tokensPerImpactPoint
								? `${formatCompact(summary.tokensPerImpactPoint)} tokens/pt`
								: "Throughput unit ROI"}
						</Typography>
						<Typography variant="caption" as="div" className="mt-1">
							{effectiveMode !== "tokens" && summary?.costPerPrCents != null ? (
								<>
									Cost per PR: <Cost cents={summary.costPerPrCents} digits={0} />
								</>
							) : (
								"Output-weighted metric"
							)}
						</Typography>
					</div>
				</div>
			</section>

			{/* ── Correlation Trend Chart (Spend vs Output Over Time) ─────── */}
			<Card>
				<SectionHeader
					title={`TREND · ${trendMode === "usd" ? "SPEND" : "TOKENS"} VS IMPACT POINTS`}
					subtitle={winLabel}
				/>
				<div
					className="p-4"
					style={{
						height: 300,
						filter: privacyOn && trendMode === "usd" ? "blur(6px)" : undefined,
					}}
				>
					{isSummaryLoading ? (
						<div className="h-full flex items-center justify-center text-xs text-fg-muted">
							── scanning trend… ──
						</div>
					) : trendChartData.length === 0 ? (
						<div className="h-full flex items-center justify-center text-xs text-fg-muted">
							── awaiting data ──
						</div>
					) : (
						<ResponsiveContainer width="100%" height="100%">
							<ComposedChart
								data={trendChartData}
								margin={{ top: 6, right: 8, bottom: 8, left: 0 }}
							>
								<CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
								<XAxis
									dataKey="date"
									axisLine={false}
									tickLine={false}
									tick={{ fill: "var(--fg-muted)", fontSize: 10 }}
								/>
								<YAxis
									yAxisId="impact"
									orientation="left"
									axisLine={false}
									tickLine={false}
									tick={{ fill: "var(--fg-muted)", fontSize: 10 }}
									tickFormatter={(v: number) => `${v}`}
									width={44}
								/>
								<YAxis
									yAxisId="spend"
									orientation="right"
									axisLine={false}
									tickLine={false}
									tick={{ fill: "var(--fg-muted)", fontSize: 10 }}
									tickFormatter={(v: number) =>
										trendMode === "usd" ? `$${Math.round(v)}` : formatCompact(v)
									}
									width={56}
								/>
								<Tooltip
									cursor={{ fill: "color-mix(in oklch, var(--fg) 4%, transparent)" }}
									content={(p) => <StatTooltip {...p} mode={trendMode} />}
								/>
								<Bar
									yAxisId="impact"
									dataKey="Impact Points"
									fill="var(--mint)"
									isAnimationActive={animating}
									maxBarSize={32}
								/>
								<Line
									yAxisId="spend"
									type="monotone"
									dataKey={trendMode === "usd" ? "AI Spend ($)" : "AI Tokens"}
									stroke="var(--sky)"
									strokeWidth={2}
									dot={false}
									isAnimationActive={animating}
								/>
							</ComposedChart>
						</ResponsiveContainer>
					)}
				</div>
			</Card>

			{/* ── Two Columns: Team Breakdown & Delivery by Work-Type ─────── */}
			<div className="grid grid-cols-12 gap-6">
				{/* Team Velocity Table */}
				<div className="col-span-12 lg:col-span-7">
					<Card className="overflow-hidden">
						<SectionHeader title="TEAMS · VELOCITY & ADOPTION" subtitle={winLabel} />
						<Table className="w-full tabular text-xs">
							<TableHeader className="border-b border-line bg-elev2/40">
								<TableRow>
									<TableHead className="w-[180px]">TEAM</TableHead>
									<SortHeader
										label="IMPACT PTS"
										active={sortField === "impactPoints"}
										dir={sortAsc ? "asc" : "desc"}
										onClick={() => handleSort("impactPoints")}
										align="right"
									/>
									<SortHeader
										label="PRS MERGED"
										active={sortField === "prsMerged"}
										dir={sortAsc ? "asc" : "desc"}
										onClick={() => handleSort("prsMerged")}
										align="right"
									/>
									<SortHeader
										label={effectiveMode === "tokens" ? "TOKENS" : "SPEND"}
										active={sortField === "spend"}
										dir={sortAsc ? "asc" : "desc"}
										onClick={() => handleSort("spend")}
										align="right"
									/>
									<SortHeader
										label={effectiveMode === "tokens" ? "TOKENS / PT" : "COST / PT"}
										active={sortField === "efficiency"}
										dir={sortAsc ? "asc" : "desc"}
										onClick={() => handleSort("efficiency")}
										align="right"
									/>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isTeamsLoading ? (
									<TableStateRow colSpan={5} isLoading={true} />
								) : sortedTeams.length === 0 ? (
									<TableStateRow colSpan={5} isLoading={false} emptyText="no team data in window" />
								) : (
									sortedTeams.map((t) => (
										<TableRow
											key={t.teamId}
											className={`border-b border-line hover:bg-elev2/40 cursor-pointer transition-colors ${selectedTeamId === t.teamId ? "bg-elev2/60" : ""}`}
											onClick={() => navigate(`/users?teamId=${encodeURIComponent(t.teamId)}`)}
										>
											<TableCell className="font-medium text-xs text-fg py-2.5">
												<span className="font-mono text-fg hover:text-amber transition-colors">
													{t.teamName}
												</span>
												<span className="text-fg-subtle ml-2 text-[10px]">
													({t.memberCount} {t.memberCount === 1 ? "user" : "users"})
												</span>
											</TableCell>
											<TableCell className="text-right text-xs tabular font-mono text-fg py-2.5">
												<span className="text-mint font-medium">{t.impactPoints}</span>
												<span className="text-fg-subtle ml-1 text-[10px]">pts</span>
											</TableCell>
											<TableCell className="text-right text-xs tabular font-mono text-fg py-2.5">
												{t.prsMerged}
												{t.substantivePrCount > 0 && (
													<span className="text-fg-subtle ml-1 text-[10px]">
														({t.substantivePrCount} L4+)
													</span>
												)}
											</TableCell>
											<TableCell className="text-right text-xs tabular font-mono text-fg py-2.5">
												{effectiveMode !== "tokens" && t.totalCostCents != null ? (
													<Cost cents={t.totalCostCents} digits={0} />
												) : (
													`${formatCompact(t.totalTokens)} tok`
												)}
											</TableCell>
											<TableCell className="text-right text-xs tabular font-mono text-fg py-2.5">
												{effectiveMode !== "tokens" && t.costPerImpactPointCents != null ? (
													<>
														<Cost cents={t.costPerImpactPointCents} digits={2} />
														<span className="text-fg-subtle ml-0.5 text-[10px]">/pt</span>
													</>
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
					</Card>
				</div>

				{/* PR Work-Type Categories */}
				<div className="col-span-12 lg:col-span-5">
					<Card className="overflow-hidden">
						<SectionHeader title="PR WORK-TYPES" subtitle={winLabel} />
						{isCategoriesLoading ? (
							<div className="p-5 text-xs text-fg-muted">── scanning categories… ──</div>
						) : !categoriesData || categoriesData.categories.length === 0 ? (
							<div className="p-5 text-xs text-fg-muted">── no categorized PRs in window ──</div>
						) : (
							<div className="p-5 space-y-4">
								<div className="h-[20px] border border-line flex overflow-hidden">
									{categoriesData.categories.map((c) => (
										<div
											key={c.category}
											style={{
												backgroundColor:
													CATEGORY_COLORS[c.category.toLowerCase()] || CATEGORY_COLORS.other,
												width: `${c.sharePct > 0 ? Math.max(2, c.sharePct) : 0}%`,
											}}
											title={`${c.category} · ${c.sharePct}% (${c.impactPoints} pts)`}
										/>
									))}
								</div>

								<ol className="divide-y divide-line/60">
									{categoriesData.categories.map((c, i) => {
										const color = CATEGORY_COLORS[c.category.toLowerCase()] || CATEGORY_COLORS.other
										return (
											<li
												key={c.category}
												className="grid grid-cols-12 items-center gap-2 py-2.5 text-xs hover:bg-elev2/40 transition-colors"
											>
												<span className="col-span-1 font-mono text-xs tabular text-fg-subtle">
													{String(i + 1).padStart(2, "0")}
												</span>
												<span className="col-span-4 capitalize font-medium text-fg truncate flex items-center gap-2">
													<span
														className="w-2 h-2 shrink-0 inline-block"
														style={{ backgroundColor: color }}
													/>
													<span className="truncate">{c.category.replace(/_/g, " ")}</span>
												</span>
												<span className="col-span-3 text-right font-mono tabular text-fg">
													{c.impactPoints} <span className="text-fg-subtle text-[10px]">pts</span>
												</span>
												<span className="col-span-2 text-right font-mono tabular text-fg-muted">
													{c.sharePct}%
												</span>
												<span className="col-span-2 text-right font-mono tabular text-fg-subtle text-[10px]">
													{c.prCount} PRs
												</span>
											</li>
										)
									})}
								</ol>
							</div>
						)}
					</Card>
				</div>
			</div>
		</div>
	)
}
