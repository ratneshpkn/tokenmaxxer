import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Pencil, Search, Share2, X } from "lucide-react"
import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Link } from "wouter"
import { ActivityHeatmap } from "@/components/ActivityHeatmap"
import { Cost } from "@/components/Cost"
import { DateRangeBar } from "@/components/DateRangeBar"
import { FlexCardModal } from "@/components/FlexCardModal"
import { GithubHeatmap } from "@/components/GithubHeatmap"
import { MetricPair } from "@/components/MetricPair"
import { SortHeader } from "@/components/SortHeader"
import { Sparkline } from "@/components/Sparkline"
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

type ModelSortKey = "model" | "value" | "share"

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
				className="group inline-flex items-center gap-1.5 text-fg-very-dim hover:text-fg-mid transition-colors"
			>
				<span>
					{label}: {value || <span className="italic text-fg-very-dim">not set</span>}
				</span>
				<Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
			</button>
		)
	}

	return (
		<span className="inline-flex items-center gap-1">
			<span className="text-fg-very-dim">{label}:</span>
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
				className="bg-transparent border-b border-fg-dim/40 text-fg text-[10px] tracked font-mono px-1 py-0 w-28 focus:outline-none focus:border-amber"
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
				className="text-fg-dim hover:text-rose transition-colors"
			>
				<X className="w-3 h-3" />
			</button>
		</span>
	)
}

export function UserDetailPage({ email }: { email: string }): React.JSX.Element {
	const [showFlexCard, setShowFlexCard] = useState(false)
	const [privacyOn] = usePrivacyMode()
	const [metricMode] = useMetricMode()
	const animating = useFirstRenderAnimation()
	const [modelFilter, setModelFilter] = useState("")
	const [modelSortKey, setModelSortKey] = useState<"model" | "value" | "share">("value")
	const [modelSortDir, setModelSortDir] = useState<"asc" | "desc">("desc")
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
	const githubHeatmapQuery = useQuery({
		queryKey: ["users.githubHeatmap", email, from, to],
		queryFn: () => api.users.githubHeatmap(email, from, to),
	})
	const isAdmin = me?.role === "admin"
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

	const leaderboardData = useMemo(() => {
		if (!usage) return []

		const modelMap = new Map<
			string,
			{
				model: string
				platforms: Set<"claude_code" | "cursor">
				cents: number
				tokens: number
				dailyValues: Map<string, number>
			}
		>()

		// Union of all dates in chronological order
		const ccDates = ccRows.map((r) => r.date)
		const cuDates = cuRows.map((r) => r.date)
		const allDates = [...new Set([...ccDates, ...cuDates])].sort()

		const getOrCreate = (modelName: string) => {
			let entry = modelMap.get(modelName)
			if (!entry) {
				entry = {
					model: modelName,
					platforms: new Set(),
					cents: 0,
					tokens: 0,
					dailyValues: new Map<string, number>(),
				}
				modelMap.set(modelName, entry)
			}
			return entry
		}

		ccRows.forEach((r) => {
			const m = r.model ?? "unknown"
			const entry = getOrCreate(m)
			entry.platforms.add("claude_code")
			entry.cents += Number(r.estimated_cost_cents ?? 0)
			const tokens = totalTokens(r)
			entry.tokens += tokens

			const val = trendMode === "tokens" ? tokens : Number(r.estimated_cost_cents ?? 0)
			entry.dailyValues.set(r.date, (entry.dailyValues.get(r.date) ?? 0) + val)
		})

		cuRows.forEach((r) => {
			const m = r.model ?? "unknown"
			const entry = getOrCreate(m)
			entry.platforms.add("cursor")
			entry.cents += Number(r.charged_cents ?? 0)
			const tokens = totalTokens(r)
			entry.tokens += tokens

			const val = trendMode === "tokens" ? tokens : Number(r.charged_cents ?? 0)
			entry.dailyValues.set(r.date, (entry.dailyValues.get(r.date) ?? 0) + val)
		})

		const totalTokensSum = ccTokens + cuTokens

		return [...modelMap.values()].map((item) => {
			const trend = allDates.map((date) => item.dailyValues.get(date) ?? 0)
			const share =
				trendMode === "tokens"
					? totalTokensSum > 0
						? (item.tokens / totalTokensSum) * 100
						: 0
					: totalCents > 0
						? (item.cents / totalCents) * 100
						: 0
			return {
				model: item.model,
				platforms: [...item.platforms],
				cents: item.cents,
				tokens: item.tokens,
				share,
				trend,
			}
		})
	}, [ccRows, cuRows, usage, trendMode, ccTokens, cuTokens, totalCents])

	const modelRows = useMemo(() => {
		const f = modelFilter.trim().toLowerCase()
		const filtered = f
			? leaderboardData.filter((m) => m.model.toLowerCase().includes(f))
			: leaderboardData

		const sortVal = (m: (typeof filtered)[number]): string | number => {
			switch (modelSortKey) {
				case "model":
					return m.model
				case "value":
					return trendMode === "tokens" ? m.tokens : m.cents
				case "share":
					return m.share
			}
		}

		return [...filtered].sort((a, b) => {
			const av = sortVal(a)
			const bv = sortVal(b)
			const cmp =
				typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number)
			return modelSortDir === "asc" ? cmp : -cmp
		})
	}, [leaderboardData, modelFilter, modelSortKey, modelSortDir, trendMode])

	function toggleModelSort(k: ModelSortKey): void {
		if (modelSortKey === k) setModelSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setModelSortKey(k)
			setModelSortDir(k === "model" ? "asc" : "desc")
		}
	}

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
				<div className="flex items-center gap-3 text-[10px] tracked text-fg-dim">
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
							<span className="text-fg-very-dim">{email}</span>
						</>
					) : (
						<>
							<span className="text-fg">{detail?.name || email}</span>
							{detail?.name ? <span className="text-fg-very-dim">{email}</span> : null}
						</>
					)}
					{isAdmin ? (
						<>
							<span className="text-fg-very-dim">·</span>
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
						<span className="text-fg-very-dim">· gh: {detail.github_username}</span>
					) : null}
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
				<div className="col-span-12 md:col-span-4 bg-bg p-6">
					<div className="text-[10px] tracked text-fg-dim mb-3">USER · {winLabel} TOTAL</div>
					<MetricPair
						cents={isViewer ? null : totalCents}
						tokens={ccTokens + cuTokens}
						digits={2}
						primaryClassName="font-display text-[72px] leading-none tracking-tight text-fg"
						secondaryClassName="mt-3 text-[11px] tracked text-fg-mid"
					/>
				</div>

				<div className="col-span-6 md:col-span-2 bg-bg p-6 flex flex-col justify-between">
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

				<div className="col-span-6 md:col-span-2 bg-bg p-6 flex flex-col justify-between">
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

				<div className="col-span-12 md:col-span-4 bg-bg p-6 flex flex-col justify-between">
					<div className="text-[10px] tracked text-fg-dim flex items-center gap-2">
						<span className="w-1.5 h-1.5 bg-mint" /> GITHUB OUTPUT
					</div>
					<div className="grid grid-cols-2 gap-4 mt-2">
						<div>
							<div className="text-[10px] tracked text-fg-dim">LINES CHANGED</div>
							<div className="font-mono text-3xl tabular text-fg leading-none font-medium mt-1">
								{formatNumber(totalLinesChanged)}
							</div>
						</div>
						<div>
							<div className="text-[10px] tracked text-fg-dim">PRs OPENED / MERGED</div>
							<div className="font-mono text-3xl tabular text-fg-mid leading-none mt-1">
								{totalPrsOpened} / {totalPrsMerged}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Activity heatmap + stats */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line">
					<span className="text-[11px] tracked text-fg">AI ACTIVITY · {winLabel} · PT</span>
				</div>
				<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,max-content)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-line border-b border-line">
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
				<div className="px-5 py-3 border-b border-line">
					<span className="text-[11px] tracked text-fg">GITHUB ACTIVITY · {winLabel}</span>
				</div>
				<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,max-content)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-line">
					<div className="p-4 overflow-x-auto flex items-center min-h-[190px] min-w-0">
						{githubHeatmapQuery.isLoading ? (
							<div className="text-xs text-fg-dim">── loading ──</div>
						) : ghDays.length > 0 ? (
							<GithubHeatmap days={ghDays} />
						) : (
							<div className="text-xs text-fg-dim">── no github activity in window ──</div>
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
							<BarChart data={modelTrendsData} margin={{ top: 6, right: 8, bottom: 8, left: 0 }}>
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
									cursor={{ fill: "var(--elev2)", opacity: 0.4 }}
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
			</section>

			{/* Model Usage Leaderboard */}
			<section className="panel overflow-hidden">
				<div className="px-5 py-3 border-b border-line flex items-center justify-between">
					<span className="text-[11px] tracked text-fg">TOP MODELS · {winLabel}</span>
					<div className="flex items-center gap-2 w-48">
						<Search className="w-3.5 h-3.5 text-fg-dim" />
						<input
							type="text"
							placeholder="filter..."
							value={modelFilter}
							onChange={(e) => setModelFilter(e.target.value)}
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
								label="MODEL"
								active={modelSortKey === "model"}
								dir={modelSortDir}
								onClick={() => toggleModelSort("model")}
							/>
							<SortHeader
								label={`VALUE · ${winLabel}`}
								active={modelSortKey === "value"}
								dir={modelSortDir}
								onClick={() => toggleModelSort("value")}
								align="right"
							/>
							<SortHeader
								label="SHARE"
								active={modelSortKey === "share"}
								dir={modelSortDir}
								onClick={() => toggleModelSort("share")}
								align="right"
							/>
							<TableHead className="h-9 px-3 w-[140px] text-[10px] tracked text-fg-dim text-left">
								TREND · {winLabel}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{usageQuery.isLoading ? (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-fg-dim py-8 text-xs">
									── loading ──
								</TableCell>
							</TableRow>
						) : modelRows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="text-center text-fg-dim py-8 text-xs">
									── no models in window ──
								</TableCell>
							</TableRow>
						) : (
							modelRows.map((m, i) => {
								return (
									<TableRow key={m.model}>
										<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-very-dim">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Link
												href={`/models/${encodeURIComponent(m.model)}`}
												className="flex items-center min-w-0 group"
											>
												<span className="flex items-center gap-1.5 min-w-0">
													<span className="flex items-center gap-1 flex-shrink-0">
														{m.platforms.includes("claude_code") && (
															<span className="w-1.5 h-1.5 bg-amber" />
														)}
														{m.platforms.includes("cursor") && (
															<span className="w-1.5 h-1.5 bg-sky" />
														)}
													</span>
													<span className="text-fg truncate group-hover:text-amber transition-colors">
														{m.model}
													</span>
												</span>
											</Link>
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
											{m.share.toFixed(1)}%
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Sparkline data={m.trend} color="var(--fg-mid)" height={22} />
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
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
