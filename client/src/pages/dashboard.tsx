import { useQuery } from "@tanstack/react-query"
import { Share2 } from "lucide-react"
import { useMemo, useState } from "react"
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	type TooltipPayloadEntry,
	XAxis,
	YAxis,
} from "recharts"
import { Link } from "wouter"
import { Cost } from "@/components/Cost"
import { DateRangeBar } from "@/components/DateRangeBar"
import { FlexCardModal } from "@/components/FlexCardModal"
import { MetricPair } from "@/components/MetricPair"
import { ModelMixSection } from "@/components/ModelMixSection"
import { SectionHeader } from "@/components/SectionHeader"
import { Sparkline } from "@/components/Sparkline"
import { UserLink } from "@/components/UserLink"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Typography } from "@/components/ui/typography"
import { severity } from "@/lib/alert-severity"
import { api } from "@/lib/api"
import { useDateRange } from "@/lib/use-date-range"
import { useFirstRenderAnimation } from "@/lib/use-first-render-animation"
import { useMetricMode } from "@/lib/use-metric-mode"
import { usePrivacyMode } from "@/lib/use-privacy-mode"
import { formatCompact } from "@/lib/utils"

function pickTrend(
	r: { trend_cents: number[] | null; trend_tokens: number[] },
	isViewer: boolean,
	metricMode: "cost" | "tokens",
): number[] {
	if (isViewer) return r.trend_tokens
	return metricMode === "cost" ? (r.trend_cents ?? r.trend_tokens) : r.trend_tokens
}

const C_CC = "var(--amber)"
const C_CU = "var(--sky)"

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
	return (
		<div className="bg-bg/95 border border-line-strong px-3 py-2 text-xs tabular">
			<div className="text-fg-muted tracked-sm text-[9px] mb-1">
				{payload[0].payload?.date ?? ""}
			</div>
			{payload.map((p) => {
				const dataKeyStr = typeof p.dataKey === "function" ? "" : (p.dataKey ?? "")
				return (
					<div key={dataKeyStr} className="flex items-center justify-between gap-4">
						<span className="flex items-center gap-1.5">
							<span className="w-2 h-2" style={{ background: p.fill }} />
							<span className="text-fg-muted">{dataKeyStr}</span>
						</span>
						<span className="text-fg">
							{mode === "usd"
								? `$${Number(p.value).toFixed(2)}`
								: Math.abs(Number(p.value)).toLocaleString()}
						</span>
					</div>
				)
			})}
		</div>
	)
}

export function DashboardPage(): React.JSX.Element {
	const [showFlexCard, setShowFlexCard] = useState(false)
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isViewer = me ? me.role !== "admin" : false
	const [privacyOn] = usePrivacyMode()
	const animating = useFirstRenderAnimation()

	const [metricMode] = useMetricMode()
	// Map global mode to chart's usd/tokens axis
	const trendMode: "usd" | "tokens" = isViewer || metricMode === "tokens" ? "tokens" : "usd"

	const { from, to, winLabel } = useDateRange()
	const summaryQuery = useQuery({
		queryKey: ["dashboard.summary", from, to],
		queryFn: () => api.dashboard.summary({ from, to }),
	})
	const topQuery = useQuery({
		queryKey: ["dashboard.top", from, to, metricMode],
		queryFn: () => api.dashboard.topSpenders({ from, to }, "all", 8, metricMode),
	})
	const modelMixQuery = useQuery({
		queryKey: ["dashboard.modelMix", from, to, metricMode],
		queryFn: () => api.dashboard.modelMix({ from, to }, undefined, metricMode),
	})
	const modelMix = modelMixQuery.data
	const summary = summaryQuery.data
	const top = topQuery.data
	const isLoading = summaryQuery.isLoading
	const { data: openAlerts } = useQuery({
		queryKey: ["alerts", "open"],
		queryFn: () => api.alerts.list("open", 50),
		enabled: !isViewer,
	})

	const totals = summary?.totals
	const ccCents = Number(totals?.cc_cents ?? 0)
	const cuCents = Number(totals?.cu_cents ?? 0)
	const totalCents = ccCents + cuCents
	const ccTokens = Number(totals?.cc_tokens ?? 0)
	const cuTokens = Number(totals?.cu_tokens ?? 0)
	const totalTokens = ccTokens + cuTokens

	const totalDays = Math.max(
		1,
		Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1,
	)
	const prsPerDay = totals != null ? ((totals.gh_prs_merged ?? 0) / totalDays).toFixed(1) : "0"

	const trend = useMemo(
		() =>
			(summary?.trend ?? []).map((d) =>
				trendMode === "usd"
					? {
							date: d.date.slice(5),
							"Claude Code": Number(d.claude_code_cents) / 100,
							Cursor: Number(d.cursor_cents) / 100,
						}
					: {
							date: d.date.slice(5),
							"Claude Code": Number(d.claude_code_tokens),
							Cursor: Number(d.cursor_tokens),
						},
			),
		[summary?.trend, trendMode],
	)

	const gitTrend = useMemo(
		() =>
			(summary?.trend ?? []).map((d) => ({
				date: d.date.slice(5),
				"PRs Merged": Number(d.gh_prs_merged ?? 0),
			})),
		[summary?.trend],
	)

	const severeAlerts = useMemo(() => {
		if (!openAlerts) return []
		return [...openAlerts]
			.map((a) => ({ ...a, _ratio: a.thresholdCents > 0 ? a.amountCents / a.thresholdCents : 0 }))
			.sort((a, b) => b._ratio - a._ratio)
			.slice(0, 5)
	}, [openAlerts])
	const totalOpenAlerts = openAlerts?.length ?? 0

	const isEmpty =
		!isLoading &&
		!!summary &&
		(isViewer ? totalTokens === 0 : totalCents === 0) &&
		(summary.trend?.length ?? 0) === 0
	if (isEmpty) {
		return (
			<div className="space-y-6 fade-rise">
				<DateRangeBar updatedAt={summaryQuery.dataUpdatedAt} />
				<Card className="p-12 text-center">
					<Typography variant="display-lg" as="div" className="mb-3">
						No data yet.
					</Typography>
					<Typography variant="muted" as="p" className="max-w-md mx-auto">
						{isViewer
							? "An admin needs to run the first sync to populate this dashboard. Check back once data is in."
							: "Tokenmaxxer needs at least one successful sync to populate the dashboard. Pull the last 365 days from Settings, or wait for the next scheduled cron."}
					</Typography>
					<div className="mt-6 flex items-center justify-center gap-3">
						{!isViewer ? (
							<Link
								href="/settings"
								className="inline-flex items-center gap-2 px-4 h-9 border border-amber text-amber hover:bg-amber/[0.08] text-xs tracked transition-colors"
							>
								▸ OPEN SETTINGS
							</Link>
						) : null}
						<a
							href="https://github.com/instawork/tokenmaxxer#quick-start"
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-2 px-4 h-9 border border-line text-fg-muted hover:text-fg hover:border-line-strong text-xs tracked transition-colors"
						>
							READ THE DOCS ↗
						</a>
					</div>
					{!isViewer ? (
						<div className="mt-10 grid grid-cols-3 gap-px bg-line/60 border border-line max-w-2xl mx-auto text-left">
							{[
								["01", "Add API keys", "Anthropic admin + Cursor admin keys — encrypted at rest."],
								["02", "Run a sync", "Refetch last 365 days. ~10 min Anthropic, <1 min Cursor."],
								["03", "Set thresholds", "Daily $ caps per platform. Alerts fire automatically."],
							].map(([n, title, body]) => (
								<div key={n} className="bg-bg p-5">
									<Typography variant="heading" className="text-2xl text-fg-subtle">
										{n}
									</Typography>
									<Typography variant="section-title" as="div" className="mt-2">
										{String(title).toUpperCase()}
									</Typography>
									<Typography variant="muted" as="p" className="mt-1">
										{body}
									</Typography>
								</div>
							))}
						</div>
					) : null}
				</Card>
			</div>
		)
	}

	return (
		<div className="space-y-6 fade-rise">
			<div className="flex items-center justify-between">
				<DateRangeBar updatedAt={summaryQuery.dataUpdatedAt} />
				<Button
					variant="outline"
					size="sm"
					onClick={() => setShowFlexCard(true)}
					className="h-7 text-xs tracked bg-transparent border-line hover:bg-elev2"
				>
					<Share2 className="w-3 h-3 mr-1.5" /> SHARE STATS
				</Button>
			</div>

			{/* ── Headline KPI band ─────────────────────────────────────────── */}
			<section className="grid grid-cols-12 gap-px bg-line/60 border border-line">
				<div className={`col-span-12 ${isViewer ? "md:col-span-6" : "md:col-span-4"} bg-bg p-6`}>
					<Typography variant="label" as="div" className="mb-3">
						{isViewer ? "TOTAL TOKENS" : "TOTAL"} · {winLabel}
					</Typography>
					{summary ? (
						<div className="num-tick">
							<MetricPair
								cents={isViewer ? null : totalCents}
								tokens={totalTokens}
								digits={0}
								primaryClassName="font-display text-5xl sm:text-6xl md:text-[80px] leading-none tracking-tight text-fg"
								secondaryClassName="mt-2"
							/>
							<div className="mt-2 flex items-center gap-3">
								<span className="text-mint">●</span>
								<Typography variant="label">
									{(totals?.cc_users ?? 0) + (totals?.cu_users ?? 0)} ACTIVE USERS
								</Typography>
							</div>
						</div>
					) : (
						<Skeleton className="h-20 w-full" />
					)}
				</div>

				<div className="col-span-6 md:col-span-2 bg-bg p-6 flex flex-col justify-between">
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-amber" /> CLAUDE CODE
					</Typography>
					<div>
						<MetricPair
							cents={isViewer ? null : ccCents}
							tokens={ccTokens}
							digits={0}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="mt-2"
						/>
						<Typography variant="label" as="div" className="mt-1">
							{totals?.cc_users ?? 0} users
						</Typography>
					</div>
				</div>

				<div className="col-span-6 md:col-span-2 bg-bg p-6 flex flex-col justify-between">
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-sky" /> CURSOR
					</Typography>
					<div>
						<MetricPair
							cents={isViewer ? null : cuCents}
							tokens={cuTokens}
							digits={0}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="mt-2"
						/>
						<Typography variant="label" as="div" className="mt-1">
							{totals?.cu_users ?? 0} users
						</Typography>
					</div>
				</div>

				<div className="col-span-12 md:col-span-2 bg-bg p-6 flex flex-col justify-between">
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-mint" /> GITHUB
					</Typography>
					<div>
						<div className="font-mono text-3xl tabular text-fg leading-none">
							{totals?.gh_prs_merged ?? 0}
						</div>
						<Typography variant="label" as="div" className="mt-2">
							PRs merged ({prsPerDay}/day)
						</Typography>
						<Typography variant="caption" as="div" className="mt-1">
							{totals != null
								? ((totals.gh_additions ?? 0) + (totals.gh_deletions ?? 0)).toLocaleString()
								: "0"}{" "}
							lines · {totals?.gh_users ?? 0} users
						</Typography>
					</div>
				</div>

				{!isViewer ? (
					<div className="col-span-12 md:col-span-2 bg-bg p-6 flex flex-col justify-between">
						<Typography variant="label" as="div" className="flex items-center gap-2">
							{(totals?.open_alerts ?? 0) > 0 ? (
								<span className="pip-danger" />
							) : (
								<span className="pip-live" />
							)}
							ALERTS
						</Typography>
						<div>
							<div
								className={`font-mono text-3xl tabular leading-none ${(totals?.open_alerts ?? 0) > 0 ? "text-amber-hot" : "text-mint"}`}
							>
								{String(totals?.open_alerts ?? 0).padStart(2, "0")}
							</div>
							<Typography asChild variant="label" className="hover:text-amber mt-2 inline-block">
								<Link href="/alerts">▸ VIEW ALERTS</Link>
							</Typography>
						</div>
					</div>
				) : null}
			</section>

			{/* ── Trend chart ───────────────────────────────────────────────── */}
			<Card>
				<SectionHeader
					title={`DAILY ${trendMode === "usd" ? "SPEND" : "TOKENS"}`}
					subtitle={winLabel}
				/>
				<div
					className="p-4"
					style={{
						height: 320,
						filter: privacyOn && trendMode === "usd" ? "blur(6px)" : undefined,
					}}
				>
					{trend.length === 0 ? (
						<div className="h-full flex items-center justify-center text-xs text-fg-muted">
							── awaiting data ──
						</div>
					) : (
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={trend} margin={{ top: 6, right: 8, bottom: 8, left: 0 }}>
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
										trendMode === "usd" ? `$${Math.round(v)}` : formatCompact(v)
									}
									width={56}
								/>
								<Tooltip
									cursor={{ fill: "color-mix(in oklch, var(--fg) 4%, transparent)" }}
									content={(p) => <StatTooltip {...p} mode={trendMode} />}
								/>
								<Bar dataKey="Claude Code" stackId="s" fill={C_CC} isAnimationActive={animating} />
								<Bar dataKey="Cursor" stackId="s" fill={C_CU} isAnimationActive={animating} />
							</BarChart>
						</ResponsiveContainer>
					)}
				</div>
			</Card>

			{/* ── GitHub Activity Trend chart ───────────────────────────────── */}
			<Card>
				<SectionHeader title="DAILY GITHUB PRs" subtitle={winLabel} />
				<div
					className="p-4"
					style={{
						height: 240,
					}}
				>
					{gitTrend.length === 0 ? (
						<div className="h-full flex items-center justify-center text-xs text-fg-muted">
							── awaiting data ──
						</div>
					) : (
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={gitTrend} margin={{ top: 6, right: 8, bottom: 8, left: 0 }}>
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
									tickFormatter={(v: number) => formatCompact(Math.abs(v))}
									width={48}
								/>
								<Tooltip
									cursor={{ fill: "color-mix(in oklch, var(--fg) 4%, transparent)" }}
									content={(p) => <StatTooltip {...p} mode="tokens" />}
								/>
								<Bar dataKey="PRs Merged" fill="var(--mint)" isAnimationActive={animating} />
							</BarChart>
						</ResponsiveContainer>
					)}
				</div>
			</Card>

			{/* ── Model mix · stacked bar + ranked list with sparklines ─────── */}
			<Card>
				<div className="px-5 py-3 border-b border-line flex items-center justify-between">
					<Typography variant="section-title">MODEL MIX · {winLabel}</Typography>
					<Typography variant="label" className="flex items-center gap-3">
						<span>
							<span className="inline-block w-2 h-2 bg-amber mr-1.5" />
							CLAUDE CODE
						</span>
						<span>
							<span className="inline-block w-2 h-2 bg-sky mr-1.5" />
							CURSOR
						</span>
					</Typography>
				</div>
				<ModelMixSection modelMix={modelMix ?? []} isViewer={isViewer} />
			</Card>

			{/* ── Two-column: leaderboard + alerts (admins) / full-width leaderboard (viewers) ── */}
			<section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
				<Card className={isViewer ? "lg:col-span-12" : "lg:col-span-7"}>
					<SectionHeader
						title={isViewer || metricMode === "tokens" ? "TOP USERS" : "TOP SPENDERS"}
						subtitle={winLabel}
						action={
							<Typography asChild variant="label" className="hover:text-amber">
								<Link href="/users">▸ VIEW ROSTER</Link>
							</Typography>
						}
					/>
					<ol className="divide-y divide-line/60">
						{(top ?? []).map((r, i) => {
							return (
								<li
									key={r.email}
									className="grid grid-cols-12 items-center gap-3 px-5 py-3 hover:bg-elev2/40 transition-colors"
								>
									<span className="col-span-1 font-mono text-xs tabular text-fg-subtle">
										{String(i + 1).padStart(3, "0")}
									</span>
									<UserLink
										email={r.email}
										name={r.name}
										className="col-span-5 text-sm truncate min-w-0"
									/>
									<div className="col-span-4">
										<Sparkline
											data={pickTrend(r, isViewer, metricMode)}
											color="var(--amber)"
											height={24}
										/>
									</div>
									<span className="col-span-2 text-right text-sm tabular text-fg">
										<MetricPair
											cents={isViewer ? null : r.total_cents}
											tokens={r.total_tokens}
											digits={2}
										/>
									</span>
								</li>
							)
						})}
						{top && top.length === 0 ? (
							<li className="px-5 py-6 text-xs text-fg-muted">
								{isViewer ? "── no usage in window ──" : "── no spend in window ──"}
							</li>
						) : null}
					</ol>
				</Card>

				{!isViewer ? (
					<Card className="lg:col-span-5">
						<div className="px-5 py-3 border-b border-line flex items-center justify-between">
							<span className="text-xs tracked text-amber-hot flex items-center gap-2">
								{totalOpenAlerts > 0 ? (
									<span className="pip-danger" />
								) : (
									<span className="pip-live" />
								)}
								OPEN ALERTS
								{totalOpenAlerts > severeAlerts.length ? (
									<span className="text-fg-muted">({totalOpenAlerts})</span>
								) : null}
							</span>
							<Link href="/alerts" className="text-xs tracked text-fg-muted hover:text-amber">
								▸ ALL ALERTS
							</Link>
						</div>
						{severeAlerts.length > 0 ? (
							<ul className="divide-y divide-line/60">
								{severeAlerts.map((a) => {
									const sev = severity(a._ratio)
									return (
										<li
											key={a.id}
											className={`px-5 py-3 transition-colors hover:bg-elev2/40 ${sev.row}`}
										>
											<div className="flex items-center justify-between gap-3 min-w-0">
												<span className="flex items-center gap-2 min-w-0">
													<span className={`w-1.5 h-1.5 shrink-0 ${sev.pip}`} />
													<Link
														href={`/users/${encodeURIComponent(a.email)}`}
														className="text-xs hover:text-amber truncate min-w-0"
													>
														<span className="text-fg">{a.name || a.email}</span>
														{a.name ? (
															<span className="text-xs text-fg-subtle ml-2">{a.email}</span>
														) : null}
													</Link>
												</span>
												<span className="text-xs tracked text-fg-muted shrink-0">
													{a.platform === "claude_code" ? "CC" : "CU"}
												</span>
											</div>
											<div className="mt-1 flex items-center justify-between text-xs tabular pl-3.5">
												<Cost cents={a.amountCents} digits={2} className={sev.text} />
												<span className="text-fg-subtle">
													/ <Cost cents={a.thresholdCents} digits={2} /> → ▲ {a._ratio.toFixed(1)}x
												</span>
											</div>
										</li>
									)
								})}
							</ul>
						) : (
							<div className="px-5 py-6 text-xs text-fg-muted">── all clear ──</div>
						)}
					</Card>
				) : null}
			</section>

			<FlexCardModal
				open={showFlexCard}
				onOpenChange={setShowFlexCard}
				userName={isViewer ? me?.name || me?.email?.split("@")[0] || "Unknown" : "Company Wide"}
				totalTokens={totalTokens}
				totalCents={isViewer ? null : totalCents}
				ccTokens={ccTokens}
				cuTokens={cuTokens}
				activeDays={
					summary?.trend?.filter((d) => Number(d.claude_code_tokens) + Number(d.cursor_tokens) > 0)
						.length || 0
				}
				daysInWindow={summary?.trend?.length || 0}
			/>
		</div>
	)
}
