import { useQuery } from "@tanstack/react-query"
import { Share2 } from "lucide-react"
import { useState } from "react"
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts"
import { Link } from "wouter"
import { ActivityHeatmap } from "@/components/ActivityHeatmap"
import { Cost } from "@/components/Cost"
import { DateRangeBar } from "@/components/DateRangeBar"
import { FlexCardModal } from "@/components/FlexCardModal"
import { MetricPair } from "@/components/MetricPair"
import { Button } from "@/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { severity } from "@/lib/alert-severity"
import { api } from "@/lib/api"
import { daysBetween } from "@/lib/date-range"
import { buildModelTrends, colorForModel, totalTokens } from "@/lib/model-trends"
import { platformLabel } from "@/lib/platform"
import { useDateRange } from "@/lib/use-date-range"
import { useFirstRenderAnimation } from "@/lib/use-first-render-animation"
import { useMetricMode } from "@/lib/use-metric-mode"
import { usePrivacyMode } from "@/lib/use-privacy-mode"
import { formatCompact, formatDate, formatNumber } from "@/lib/utils"

function StatBlock({ label, value }: { label: string; value: string }): React.JSX.Element {
	return (
		<div className="flex flex-col gap-1 select-none">
			<div className="text-[10px] tracked text-fg-dim font-mono">{label}</div>
			<div className="font-mono text-2xl tabular text-fg leading-none font-medium mt-1">
				{value}
			</div>
		</div>
	)
}

export function UserDetailPage({ email }: { email: string }): React.JSX.Element {
	const [showFlexCard, setShowFlexCard] = useState(false)
	const [privacyOn] = usePrivacyMode()
	const [metricMode] = useMetricMode()
	const animating = useFirstRenderAnimation()
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isViewer = me ? me.role !== "admin" : false
	const trendMode: "usd" | "tokens" = isViewer || metricMode === "tokens" ? "tokens" : "usd"
	const { from, to } = useDateRange()
	const days = daysBetween(from, to)
	const winLabel = days === 1 ? "1D" : `${days}D`

	const { data: detail } = useQuery({
		queryKey: ["users.detail", email],
		queryFn: () => api.users.detail(email),
	})
	const usageQuery = useQuery({
		queryKey: ["users.usage", email, from, to],
		queryFn: () => api.users.usage(email, from, to, "all"),
	})
	const heatmapQuery = useQuery({
		queryKey: ["users.heatmap", email, from, to],
		queryFn: () => api.users.heatmap(email, from, to),
	})
	const isAdmin = me?.role === "admin"
	const alertsQuery = useQuery({
		queryKey: ["users.alerts", email],
		queryFn: () => api.users.alertsByEmail(email, 365, 50),
		enabled: isAdmin,
	})
	const usage = usageQuery.data

	const ccRows = usage?.claude_code ?? []
	const cuRows = usage?.cursor ?? []

	const ccTokens = ccRows.reduce((acc, r) => acc + totalTokens(r), 0)
	const cuTokens = cuRows.reduce((acc, r) => acc + totalTokens(r), 0)

	const ccCents = ccRows.reduce((acc, r) => acc + Number(r.estimated_cost_cents ?? 0), 0)
	const cuCents = cuRows.reduce((acc, r) => acc + Number(r.charged_cents ?? 0), 0)
	const totalCents = ccCents + cuCents

	const { chartModels, topModels, modelTrendsData } = buildModelTrends(ccRows, cuRows, trendMode)

	const heatDays = heatmapQuery.data ?? []
	const activeDays = heatDays.filter((d) => d.cc_tokens + d.cu_tokens > 0).length
	const totalHeatDays = heatDays.length
	const pctActive = totalHeatDays > 0 ? Math.round((activeDays / totalHeatDays) * 100) : 0
	const peakCents =
		heatDays.length > 0
			? Math.max(...heatDays.map((d) => (d.cc_cents ?? 0) + (d.cu_cents ?? 0)))
			: 0
	const peakTokens =
		heatDays.length > 0 ? Math.max(...heatDays.map((d) => d.cc_tokens + d.cu_tokens)) : 0
	const totalHeatCents = heatDays.reduce((acc, d) => acc + (d.cc_cents ?? 0) + (d.cu_cents ?? 0), 0)
	const totalHeatTokens = heatDays.reduce((acc, d) => acc + d.cc_tokens + d.cu_tokens, 0)
	const avgActiveCents = activeDays > 0 ? Math.round(totalHeatCents / activeDays) : 0
	const avgActiveTokens = activeDays > 0 ? Math.round(totalHeatTokens / activeDays) : 0

	return (
		<div className="space-y-6 fade-rise">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3 text-[10px] tracked text-fg-dim">
					<Link href="/users" className="hover:text-amber">
						◀ ROSTER
					</Link>
					<span>/</span>
					<span className="text-fg">{detail?.name || email}</span>
					{detail?.name ? <span className="text-fg-very-dim">{email}</span> : null}
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setShowFlexCard(true)}
					className="h-7 text-[10px] tracked bg-transparent border-line hover:bg-elev2"
				>
					<Share2 className="w-3 h-3 mr-1.5" /> SHARE STATS
				</Button>
			</div>

			<DateRangeBar updatedAt={usageQuery.dataUpdatedAt} />

			{/* Headline strip */}
			<section className="grid grid-cols-12 gap-px bg-line/60 border border-line">
				<div className="col-span-12 md:col-span-6 bg-bg p-6">
					<div className="text-[10px] tracked text-fg-dim mb-3">USER · {winLabel} TOTAL</div>
					<MetricPair
						cents={isViewer ? null : totalCents}
						tokens={ccTokens + cuTokens}
						digits={2}
						primaryClassName="font-display text-[72px] leading-none tracking-tight text-fg"
						secondaryClassName="mt-3 text-[11px] tracked text-fg-mid"
					/>
				</div>

				<div className="col-span-6 md:col-span-3 bg-bg p-6 flex flex-col justify-between">
					<div className="text-[10px] tracked text-fg-dim flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-amber" /> CLAUDE CODE
					</div>
					<div>
						<MetricPair
							cents={isViewer ? null : ccCents}
							tokens={ccTokens}
							digits={2}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="text-[10px] tracked text-fg-dim mt-2"
						/>
					</div>
				</div>

				<div className="col-span-6 md:col-span-3 bg-bg p-6 flex flex-col justify-between">
					<div className="text-[10px] tracked text-fg-dim flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-sky" /> CURSOR
					</div>
					<div>
						<MetricPair
							cents={isViewer ? null : cuCents}
							tokens={cuTokens}
							digits={2}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="text-[10px] tracked text-fg-dim mt-2"
						/>
					</div>
				</div>
			</section>

			{/* Activity heatmap + stats */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line">
					<span className="text-[11px] tracked text-fg">ACTIVITY · {winLabel} · PT</span>
				</div>
				<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,max-content)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-line">
					<div
						className="p-4 overflow-x-auto flex items-center min-h-[190px] min-w-0"
						style={{ filter: privacyOn && trendMode === "usd" ? "blur(6px)" : undefined }}
					>
						{heatmapQuery.isLoading ? (
							<div className="text-xs text-fg-dim">── loading ──</div>
						) : heatDays.length > 0 ? (
							<ActivityHeatmap days={heatDays} trendMode={trendMode} />
						) : (
							<div className="text-xs text-fg-dim">── no activity in window ──</div>
						)}
					</div>

					<div
						className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-px bg-line"
						style={{
							filter: privacyOn && trendMode === "usd" ? "blur(6px)" : undefined,
						}}
					>
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock label="ACTIVE DAYS" value={totalHeatDays > 0 ? String(activeDays) : "—"} />
						</div>
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock label="% ACTIVE" value={totalHeatDays > 0 ? `${pctActive}%` : "—"} />
						</div>
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock
								label="PEAK DAY"
								value={
									activeDays > 0
										? trendMode === "usd"
											? `$${Math.round(peakCents / 100)}`
											: formatCompact(peakTokens)
										: "—"
								}
							/>
						</div>
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock
								label="AVG / ACTIVE"
								value={
									activeDays > 0
										? trendMode === "usd"
											? `$${Math.round(avgActiveCents / 100)}`
											: formatCompact(avgActiveTokens)
										: "—"
								}
							/>
						</div>
					</div>
				</div>
			</section>

			{/* Model trends */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line">
					<span className="text-[11px] tracked text-fg">
						MODEL TRENDS · {winLabel} · {trendMode === "usd" ? "USD" : "TOKENS"}
					</span>
				</div>
				<div
					className="p-4"
					style={{
						height: 320,
						filter: privacyOn && trendMode === "usd" ? "blur(6px)" : undefined,
					}}
				>
					{modelTrendsData.length === 0 ? (
						<div className="h-full flex items-center justify-center text-xs text-fg-dim">
							── no model data ──
						</div>
					) : (
						<ResponsiveContainer width="100%" height="100%">
							<LineChart data={modelTrendsData} margin={{ top: 6, right: 8, bottom: 8, left: 0 }}>
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
										trendMode === "usd" ? `$${Math.round(v)}` : formatCompact(v)
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
									formatter={(v: number) =>
										trendMode === "usd" ? `$${v.toFixed(2)}` : formatNumber(v)
									}
								/>
								{chartModels.map((model) => (
									<Line
										key={model}
										type="monotone"
										dataKey={model}
										stroke={colorForModel(model, topModels)}
										strokeWidth={1.5}
										dot={false}
										activeDot={{ r: 3 }}
										isAnimationActive={animating}
									/>
								))}
							</LineChart>
						</ResponsiveContainer>
					)}
				</div>
			</section>

			{/* Alert history (admin-only) */}
			{isAdmin ? (
				<section className="panel">
					<div className="px-5 py-3 border-b border-line flex items-center justify-between">
						<span className="text-[11px] tracked text-fg">ALERT HISTORY · 365D</span>
					</div>
					{alertsQuery.isLoading ? (
						<div className="px-5 py-4 text-xs text-fg-dim">── loading ──</div>
					) : (alertsQuery.data ?? []).length === 0 ? (
						<div className="px-5 py-4 text-xs text-fg-dim">— no alerts on record —</div>
					) : (
						<Table className="w-full tabular text-xs">
							<TableHeader className="border-b border-line bg-elev2/40">
								<TableRow>
									<TableHead className="h-9 w-10 px-3 text-[10px] tracked text-fg-very-dim text-right">
										#
									</TableHead>
									<TableHead className="h-9 px-3 text-[10px] tracked text-fg-dim text-left">
										DATE
									</TableHead>
									<TableHead className="h-9 px-3 text-[10px] tracked text-fg-dim text-left">
										PLATFORM
									</TableHead>
									<TableHead className="h-9 px-3 text-[10px] tracked text-fg-dim text-right">
										SPEND
									</TableHead>
									<TableHead className="h-9 px-3 text-[10px] tracked text-fg-dim text-right">
										LIMIT
									</TableHead>
									<TableHead className="h-9 px-3 text-[10px] tracked text-fg-dim text-right">
										RATIO
									</TableHead>
									<TableHead className="h-9 px-3 text-[10px] tracked text-fg-dim text-left">
										STATUS
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(alertsQuery.data ?? []).map((a, i) => {
									const ratio = a.thresholdCents > 0 ? a.amountCents / a.thresholdCents : 0
									const sev = severity(ratio)
									return (
										<TableRow key={a.id} className={sev.row}>
											<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-very-dim">
												{String(i + 1).padStart(3, "0")}
											</TableCell>
											<TableCell className="px-3 py-2.5 text-fg-mid">
												{formatDate(a.date)}
											</TableCell>
											<TableCell className="px-3 py-2.5 text-[10px] tracked text-fg-mid">
												{platformLabel(a.platform)}
											</TableCell>
											<TableCell className={`px-3 py-2.5 text-right ${sev.text}`}>
												<Cost cents={a.amountCents} digits={2} />
											</TableCell>
											<TableCell className="px-3 py-2.5 text-right text-fg-dim">
												<Cost cents={a.thresholdCents} digits={2} />
											</TableCell>
											<TableCell className={`px-3 py-2.5 text-right ${sev.text}`}>
												▲ {ratio.toFixed(1)}x
											</TableCell>
											<TableCell className="px-3 py-2.5 text-[10px] tracked">
												<span className="flex items-center gap-2">
													<span className={`inline-block w-1.5 h-1.5 ${sev.pip}`} />
													{a.status}
												</span>
											</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
					)}
				</section>
			) : null}

			<FlexCardModal
				open={showFlexCard}
				onOpenChange={setShowFlexCard}
				userName={detail?.name || email.split("@")[0]}
				totalTokens={ccTokens + cuTokens}
				totalCents={isViewer ? null : totalCents}
				ccTokens={ccTokens}
				cuTokens={cuTokens}
				activeDays={activeDays}
				daysInWindow={days}
			/>
		</div>
	)
}
