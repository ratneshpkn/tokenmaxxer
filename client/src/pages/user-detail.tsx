import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Pencil, Share2, X } from "lucide-react"
import { useState } from "react"
import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	type TooltipValueType,
	XAxis,
	YAxis,
} from "recharts"
import { Link } from "wouter"
import { ActivityHeatmap, GithubHeatmap } from "@/components/CalendarHeatmap"
import { Cost } from "@/components/Cost"
import { FlexCardModal } from "@/components/FlexCardModal"
import { MetricPair } from "@/components/MetricPair"
import { SectionHeader } from "@/components/SectionHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { PrComplexitySection } from "@/components/user-detail/PrComplexitySection"
import { UserModelsSection } from "@/components/user-detail/UserModelsSection"
import { severity } from "@/lib/alert-severity"
import { api } from "@/lib/api"
import { daysBetween } from "@/lib/date-range"
import { platformLabel, useDisplaySession } from "@/lib/display-session"
import { buildModelTrends, colorForModel, totalTokens } from "@/lib/model-trends"
import { useDateRange } from "@/lib/use-date-range"
import { useFirstRenderAnimation } from "@/lib/use-first-render-animation"
import { formatCompact, formatDate, formatNumber } from "@/lib/utils"

function StatBlock({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
	return (
		<div className="flex flex-col gap-1 select-none">
			<Typography variant="label" as="div">
				{label}
			</Typography>
			<div className="font-mono text-2xl tabular text-fg leading-none font-medium mt-1">
				{value}
			</div>
		</div>
	)
}

function EditableField({
	label,
	value,
	onSave,
	placeholder,
}: {
	label: string
	value: string | null
	onSave: (value: string | null) => Promise<void>
	placeholder?: string
}): React.JSX.Element {
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(value ?? "")
	const [saving, setSaving] = useState(false)

	const handleSave = async (): Promise<void> => {
		const trimmed = draft.trim()
		const newValue = trimmed === "" ? null : trimmed
		if (newValue === value) {
			setEditing(false)
			return
		}
		setSaving(true)
		try {
			await onSave(newValue)
			setEditing(false)
		} finally {
			setSaving(false)
		}
	}

	if (!editing) {
		return (
			<button
				type="button"
				onClick={() => {
					setDraft(value ?? "")
					setEditing(true)
				}}
				className="group inline-flex items-center gap-1.5 text-fg-subtle hover:text-fg-muted transition-colors"
			>
				<span>
					{label}: {value || <span className="italic text-fg-subtle">not set</span>}
				</span>
				<Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
			</button>
		)
	}

	return (
		<span className="inline-flex items-center gap-1">
			<span className="text-fg-subtle">{label}:</span>
			<input
				type="text"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") handleSave()
					if (e.key === "Escape") setEditing(false)
				}}
				placeholder={placeholder}
				disabled={saving}
				className="bg-transparent border-b border-fg-muted/40 text-fg text-xs tracked font-mono px-1 py-0 w-28 focus:outline-none focus:border-amber"
			/>
			<button
				type="button"
				onClick={handleSave}
				disabled={saving}
				className="text-mint hover:text-fg transition-colors"
			>
				<Check className="w-3 h-3" />
			</button>
			<button
				type="button"
				onClick={() => setEditing(false)}
				className="text-fg-muted hover:text-rose transition-colors"
			>
				<X className="w-3 h-3" />
			</button>
		</span>
	)
}

export function UserDetailPage({ email }: { email: string }): React.JSX.Element {
	const [showFlexCard, setShowFlexCard] = useState(false)
	const { isAdmin, isViewer, trendMode, privacyOn } = useDisplaySession()
	const animating = useFirstRenderAnimation()
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
	const rawModelsQuery = useQuery({
		queryKey: ["users.rawModels", email, from, to],
		queryFn: () => api.users.rawModels(email, from, to),
	})
	const heatmapQuery = useQuery({
		queryKey: ["users.heatmap", email, from, to],
		queryFn: () => api.users.heatmap(email, from, to),
	})
	const githubHeatmapQuery = useQuery({
		queryKey: ["users.githubHeatmap", email, from, to],
		queryFn: () => api.users.githubHeatmap(email, from, to),
	})
	const recommendationsQuery = useQuery({
		queryKey: ["users.recommendations", email],
		queryFn: () => api.users.recommendations(email),
	})
	const recommendations = recommendationsQuery.data ?? []

	const prComplexityQuery = useQuery({
		queryKey: ["users.prComplexity", email, from, to],
		queryFn: () => api.users.prComplexity(email, from, to),
	})
	const prComplexity = prComplexityQuery.data
	const alertsQuery = useQuery({
		queryKey: ["users.alerts", email],
		queryFn: () => api.users.alertsByEmail(email, 365, 50),
		enabled: isAdmin,
	})
	const queryClient = useQueryClient()
	const updateMutation = useMutation({
		mutationFn: (fields: { githubUsername?: string | null; name?: string | null }) =>
			api.users.update(email, fields),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["users.detail", email] })
		},
	})
	const usage = usageQuery.data

	const ghDays = githubHeatmapQuery.data ?? []
	const totalPrsOpened = ghDays.reduce((acc, r) => acc + r.prs_opened, 0)
	const totalPrsMerged = ghDays.reduce((acc, r) => acc + r.prs_merged, 0)
	const totalAdditions = ghDays.reduce((acc, r) => acc + (r.additions ?? 0), 0)
	const totalDeletions = ghDays.reduce((acc, r) => acc + (r.deletions ?? 0), 0)
	const totalLinesChanged = totalAdditions + totalDeletions

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

	const ghActiveDays = ghDays.filter(
		(d) => d.prs_opened + d.prs_merged + d.additions + d.deletions > 0,
	).length
	const ghTotalDays = ghDays.length
	const ghPctActive = ghTotalDays > 0 ? Math.round((ghActiveDays / ghTotalDays) * 100) : 0
	const ghPeakPRs =
		ghDays.length > 0 ? Math.max(...ghDays.map((d) => d.prs_opened + d.prs_merged)) : 0
	const ghTotalPRs = ghDays.reduce((acc, d) => acc + d.prs_opened + d.prs_merged, 0)
	const ghAvgActivePRs = ghActiveDays > 0 ? Number((ghTotalPRs / ghActiveDays).toFixed(1)) : 0

	return (
		<div className="space-y-6 fade-rise">
			<div className="flex items-center justify-between">
				<Typography variant="label" className="flex items-center gap-3">
					<Link href="/users" className="hover:text-amber">
						◀ ROSTER
					</Link>
					<span>/</span>
					{isAdmin && detail ? (
						<>
							<EditableField
								label="name"
								value={detail.name}
								placeholder="Display name"
								onSave={async (v) => {
									await updateMutation.mutateAsync({ name: v })
								}}
							/>
							<span className="text-fg-subtle">{email}</span>
						</>
					) : (
						<>
							<span className="text-fg">{detail?.name || email}</span>
							{detail?.name ? <span className="text-fg-subtle">{email}</span> : null}
						</>
					)}
					{isAdmin ? (
						<>
							<span className="text-fg-subtle">·</span>
							<EditableField
								label="gh"
								value={detail?.github_username ?? null}
								placeholder="github-user"
								onSave={async (v) => {
									await updateMutation.mutateAsync({ githubUsername: v })
								}}
							/>
						</>
					) : detail?.github_username ? (
						<span className="text-fg-subtle">· gh: {detail.github_username}</span>
					) : null}
					{detail?.teams && detail.teams.length > 0 ? (
						<>
							<span className="text-fg-subtle">·</span>
							<span className="flex items-center gap-1">
								<span className="text-fg-subtle">team:</span>
								{detail.teams.map((t) => (
									<span
										key={t.id}
										className="px-1.5 py-0.5 rounded bg-elev2 text-fg text-[10px] font-mono border border-line"
									>
										{t.name}
									</span>
								))}
							</span>
						</>
					) : null}
				</Typography>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setShowFlexCard(true)}
					className="h-7 text-xs tracked bg-transparent border-line hover:bg-elev2"
				>
					<Share2 className="w-3 h-3 mr-1.5" /> SHARE STATS
				</Button>
			</div>

			{/* Headline strip */}
			<section className="grid grid-cols-12 gap-px bg-line/60 border border-line">
				<div className="col-span-12 md:col-span-4 bg-bg p-6">
					<Typography variant="label" as="div" className="mb-3">
						USER · {winLabel} TOTAL
					</Typography>
					<MetricPair
						cents={isViewer ? null : totalCents}
						tokens={ccTokens + cuTokens}
						digits={2}
						primaryClassName="font-display text-4xl sm:text-5xl md:text-[72px] leading-none tracking-tight text-fg"
						secondaryClassName="mt-3"
					/>
				</div>

				<div className="col-span-6 md:col-span-2 bg-bg p-6 flex flex-col justify-between">
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-amber" /> CLAUDE CODE
					</Typography>
					<div>
						<MetricPair
							cents={isViewer ? null : ccCents}
							tokens={ccTokens}
							digits={2}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="mt-2"
						/>
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
							digits={2}
							primaryClassName="font-mono text-3xl tabular text-fg leading-none"
							secondaryClassName="mt-2"
						/>
					</div>
				</div>

				<div className="col-span-12 md:col-span-4 bg-bg p-6 flex flex-col justify-between">
					<Typography variant="label" as="div" className="flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-mint" /> GITHUB OUTPUT
					</Typography>
					<div className="grid grid-cols-2 gap-4 mt-2">
						<div>
							<Typography variant="label" as="div">
								PRs OPENED / MERGED
							</Typography>
							<div className="font-mono text-3xl tabular text-fg leading-none font-medium mt-1">
								{totalPrsOpened} / {totalPrsMerged}
							</div>
						</div>
						<div>
							<Typography variant="label" as="div">
								LINES CHANGED
							</Typography>
							<div className="font-mono text-3xl tabular text-fg-muted leading-none mt-1">
								{formatNumber(totalLinesChanged)}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Activity heatmap + stats */}
			<Card>
				<SectionHeader title="AI ACTIVITY" subtitle={`${winLabel} · PT`} />
				<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,max-content)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-line border-b border-line">
					<div
						className="p-4 overflow-x-auto flex items-center min-h-[190px] min-w-0"
						style={{ filter: privacyOn && trendMode === "usd" ? "blur(6px)" : undefined }}
					>
						{heatmapQuery.isLoading ? (
							<div className="text-xs text-fg-muted">── loading ──</div>
						) : heatDays.length > 0 ? (
							<ActivityHeatmap days={heatDays} trendMode={trendMode} />
						) : (
							<div className="text-xs text-fg-muted">── no activity in window ──</div>
						)}
					</div>

					<div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-px bg-line">
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
									activeDays > 0 ? (
										trendMode === "usd" ? (
											<Cost cents={peakCents} digits={0} />
										) : (
											formatCompact(peakTokens)
										)
									) : (
										"—"
									)
								}
							/>
						</div>
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock
								label="AVG / ACTIVE"
								value={
									activeDays > 0 ? (
										trendMode === "usd" ? (
											<Cost cents={avgActiveCents} digits={0} />
										) : (
											formatCompact(avgActiveTokens)
										)
									) : (
										"—"
									)
								}
							/>
						</div>
					</div>
				</div>
				<div className="px-5 py-3 border-b border-line">
					<Typography variant="section-title">GITHUB ACTIVITY · {winLabel}</Typography>
				</div>
				<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,max-content)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-line">
					<div className="p-4 overflow-x-auto flex items-center min-h-[190px] min-w-0">
						{githubHeatmapQuery.isLoading ? (
							<div className="text-xs text-fg-muted">── loading ──</div>
						) : ghDays.length > 0 ? (
							<GithubHeatmap days={ghDays} />
						) : (
							<div className="text-xs text-fg-muted">── no github activity in window ──</div>
						)}
					</div>

					<div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-px bg-line">
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock label="ACTIVE DAYS" value={ghTotalDays > 0 ? String(ghActiveDays) : "—"} />
						</div>
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock label="% ACTIVE" value={ghTotalDays > 0 ? `${ghPctActive}%` : "—"} />
						</div>
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock label="PEAK PRs" value={ghActiveDays > 0 ? String(ghPeakPRs) : "—"} />
						</div>
						<div className="p-5 flex flex-col justify-center bg-elev hover:bg-elev2/20 transition-colors duration-150">
							<StatBlock
								label="AVG PRs / ACTIVE"
								value={ghActiveDays > 0 ? String(ghAvgActivePRs) : "—"}
							/>
						</div>
					</div>
				</div>
			</Card>

			{/* Model trends */}
			<Card>
				<SectionHeader
					title="MODEL TRENDS"
					subtitle={`${winLabel} · ${trendMode === "usd" ? "USD" : "TOKENS"}`}
				/>
				<div
					className="p-4"
					style={{
						height: 320,
						filter: privacyOn && trendMode === "usd" ? "blur(6px)" : undefined,
					}}
				>
					{modelTrendsData.length === 0 ? (
						<div className="h-full flex items-center justify-center text-xs text-fg-muted">
							── no model data ──
						</div>
					) : (
						<ResponsiveContainer width="100%" height="100%">
							<BarChart data={modelTrendsData} margin={{ top: 6, right: 8, bottom: 8, left: 0 }}>
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
									cursor={{ fill: "var(--elev2)", opacity: 0.4 }}
									contentStyle={{
										background: "var(--bg)",
										border: "1px solid var(--line-strong)",
										fontFamily: "JetBrains Mono",
										fontSize: 11,
									}}
									formatter={(v: TooltipValueType | undefined) =>
										trendMode === "usd"
											? `$${Number(v ?? 0).toFixed(2)}`
											: formatNumber(Number(v ?? 0))
									}
								/>
								{chartModels.map((model) => (
									<Bar
										key={model}
										dataKey={model}
										stackId="a"
										fill={colorForModel(model, topModels)}
										isAnimationActive={animating}
									/>
								))}
							</BarChart>
						</ResponsiveContainer>
					)}
				</div>
			</Card>

			{/* PR Workload & Complexity */}
			{prComplexity && prComplexity.totalEnrichedPrs > 0 && (
				<PrComplexitySection email={email} prComplexity={prComplexity} />
			)}

			{/* Model Recommendations */}
			{recommendations.length > 0 && (
				<Card className="overflow-hidden p-5 border-amber/30 bg-amber/5">
					<SectionHeader
						title="MODEL RECOMMENDATIONS"
						subtitle={`${recommendations.length} SUGGESTION${recommendations.length === 1 ? "" : "S"}`}
					/>
					<div className="space-y-3 pt-3">
						{recommendations.map((rec) => (
							<div
								key={rec.id}
								className="p-3.5 bg-bg/80 border border-line rounded flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs"
							>
								<div className="space-y-1 min-w-0">
									<div className="flex items-center gap-2">
										<Badge
											variant={rec.severity === "critical" ? "destructive" : "secondary"}
											className="uppercase font-mono text-[9px] tracked"
										>
											{rec.severity}
										</Badge>
										<span className="font-semibold text-fg">{rec.title}</span>
									</div>
									<p className="text-fg-muted text-xs leading-relaxed">{rec.message}</p>
								</div>
								{rec.suggestedModel && (
									<div className="flex-shrink-0 text-right font-mono text-xs">
										<span className="text-fg-muted">Suggested: </span>
										<span className="text-amber font-medium">{rec.suggestedModel}</span>
										{rec.potentialSavingsCents != null && rec.potentialSavingsCents > 0 && (
											<div className="text-xs text-mint mt-0.5">
												Est. Savings: <Cost cents={rec.potentialSavingsCents} digits={2} />
											</div>
										)}
									</div>
								)}
							</div>
						))}
					</div>
				</Card>
			)}

			{/* Model Usage Leaderboard & Raw Models Breakdown */}
			<UserModelsSection
				ccRows={ccRows}
				cuRows={cuRows}
				hasUsage={Boolean(usage)}
				usageLoading={usageQuery.isLoading}
				rawModels={rawModelsQuery.data}
				rawModelsLoading={rawModelsQuery.isLoading}
				trendMode={trendMode}
				isViewer={isViewer}
				totalCents={totalCents}
				totalTokensSum={ccTokens + cuTokens}
				winLabel={winLabel}
			/>

			{/* Alert history (admin-only) */}
			{isAdmin ? (
				<Card>
					<div className="px-5 py-3 border-b border-line flex items-center justify-between">
						<Typography variant="section-title">ALERT HISTORY · 365D</Typography>
					</div>
					{alertsQuery.isLoading ? (
						<div className="px-5 py-4 text-xs text-fg-muted">── loading ──</div>
					) : (alertsQuery.data ?? []).length === 0 ? (
						<div className="px-5 py-4 text-xs text-fg-muted">— no alerts on record —</div>
					) : (
						<Table className="w-full tabular text-xs">
							<TableHeader className="border-b border-line bg-elev2/40">
								<TableRow>
									<TableHead className="w-14 text-right">#</TableHead>
									<TableHead>DATE</TableHead>
									<TableHead>PLATFORM</TableHead>
									<TableHead className="text-right">SPEND</TableHead>
									<TableHead className="text-right">LIMIT</TableHead>
									<TableHead className="text-right">RATIO</TableHead>
									<TableHead>STATUS</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(alertsQuery.data ?? []).map((a, i) => {
									const ratio = a.thresholdCents > 0 ? a.amountCents / a.thresholdCents : 0
									const sev = severity(ratio)
									return (
										<TableRow key={a.id} className={sev.row}>
											<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-subtle">
												{String(i + 1).padStart(3, "0")}
											</TableCell>
											<TableCell className="px-3 py-2.5 text-fg-muted">
												{formatDate(a.date)}
											</TableCell>
											<TableCell className="px-3 py-2.5 text-[10px] tracked text-fg-muted">
												{platformLabel(a.platform)}
											</TableCell>
											<TableCell className={`px-3 py-2.5 text-right ${sev.text}`}>
												<Cost cents={a.amountCents} digits={2} />
											</TableCell>
											<TableCell className="px-3 py-2.5 text-right text-fg-muted">
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
				</Card>
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
