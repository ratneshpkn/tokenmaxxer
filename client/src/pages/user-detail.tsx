import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Pencil, Share2, X } from "lucide-react"
import { useMemo, useState } from "react"
import {
	Area,
	AreaChart,
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
import { ActivityHeatmap } from "@/components/ActivityHeatmap"
import { Cost } from "@/components/Cost"
import { DateRangeBar } from "@/components/DateRangeBar"
import { FlexCardModal } from "@/components/FlexCardModal"
import { GithubHeatmap } from "@/components/GithubHeatmap"
import { MetricPair } from "@/components/MetricPair"
import { SearchInput } from "@/components/SearchInput"
import { SectionHeader } from "@/components/SectionHeader"
import { SortHeader } from "@/components/SortHeader"
import { Sparkline } from "@/components/Sparkline"
import { TableStateRow } from "@/components/TableStateRow"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
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
import { cn, formatCompact, formatDate, formatNumber } from "@/lib/utils"

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
	const [rawModelFilter, setRawModelFilter] = useState("")
	const [rawModelSortKey, setRawModelSortKey] = useState<ModelSortKey>("value")
	const [rawModelSortDir, setRawModelSortDir] = useState<"asc" | "desc">("desc")
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
	const [viewPrsOpen, setViewPrsOpen] = useState(false)
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

	const rawModelData = useMemo(() => {
		if (!rawModelsQuery.data) return []
		const modelMap = new Map<
			string,
			{
				model: string
				platforms: Set<"claude_code" | "cursor">
				cents: number
				tokens: number
			}
		>()

		const getOrCreate = (modelName: string) => {
			let entry = modelMap.get(modelName)
			if (!entry) {
				entry = {
					model: modelName,
					platforms: new Set(),
					cents: 0,
					tokens: 0,
				}
				modelMap.set(modelName, entry)
			}
			return entry
		}

		rawModelsQuery.data.claude_code.forEach((r) => {
			const m = r.model ?? "unknown"
			const entry = getOrCreate(m)
			entry.platforms.add("claude_code")
			entry.cents += Number(r.estimated_cost_cents ?? 0)
			const tokens =
				r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens
			entry.tokens += tokens
		})

		rawModelsQuery.data.cursor.forEach((r) => {
			const m = r.model ?? "unknown"
			const entry = getOrCreate(m)
			entry.platforms.add("cursor")
			entry.cents += Number(r.charged_cents ?? 0)
			const tokens = r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens
			entry.tokens += tokens
		})

		const totalTokensSum = ccTokens + cuTokens

		return [...modelMap.values()].map((item) => {
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
			}
		})
	}, [rawModelsQuery.data, trendMode, ccTokens, cuTokens, totalCents])

	const rawModelRows = useMemo(() => {
		const f = rawModelFilter.trim().toLowerCase()
		const filtered = f
			? rawModelData.filter((m) => m.model.toLowerCase().includes(f))
			: rawModelData

		const sortVal = (m: (typeof filtered)[number]): string | number => {
			switch (rawModelSortKey) {
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
			return rawModelSortDir === "asc" ? cmp : -cmp
		})
	}, [rawModelData, rawModelFilter, rawModelSortKey, rawModelSortDir, trendMode])

	function toggleRawModelSort(k: ModelSortKey): void {
		if (rawModelSortKey === k) setRawModelSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setRawModelSortKey(k)
			setRawModelSortDir(k === "model" ? "asc" : "desc")
		}
	}

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
							<div className="text-[10px] tracked text-fg-dim">PRs OPENED / MERGED</div>
							<div className="font-mono text-3xl tabular text-fg leading-none font-medium mt-1">
								{totalPrsOpened} / {totalPrsMerged}
							</div>
						</div>
						<div>
							<div className="text-[10px] tracked text-fg-dim">LINES CHANGED</div>
							<div className="font-mono text-3xl tabular text-fg-mid leading-none mt-1">
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
				<Card className="overflow-hidden">
					<SectionHeader
						title="PR WORKLOAD & COMPLEXITY"
						subtitle={`${prComplexity.totalEnrichedPrs} AI-analyzed Pull Requests`}
						action={
							<Button
								variant="outline"
								size="sm"
								className="text-[10px] font-mono border-line hover:border-amber hover:text-amber"
								onClick={() => setViewPrsOpen(true)}
							>
								VIEW PRs ({prComplexity.totalEnrichedPrs})
							</Button>
						}
					/>
					<div className="p-5 space-y-6">
						{/* Metrics Summary Row */}
						<div className="grid grid-cols-1 md:grid-cols-4 gap-4 pb-5 border-b border-line">
							<div className="bg-bg p-4 flex flex-col justify-between border border-line rounded-xs">
								<div className="text-[10px] tracked text-fg-dim font-mono">
									WEIGHTED COMPLEXITY (1.0-5.0)
								</div>
								<div className="flex items-baseline gap-2 mt-2">
									<span className="font-mono text-3xl font-medium text-amber font-bold">
										{prComplexity.weightedAvgComplexity ?? prComplexity.averageComplexity ?? "—"}
									</span>
									<span className="text-xs font-mono text-fg-dim">/ 5.0</span>
									<Badge
										variant="outline"
										className={cn(
											"ml-auto text-[9px] font-mono border",
											(prComplexity.weightedAvgComplexity ?? 0) <= 2
												? "bg-mint/10 text-mint border-mint/30"
												: (prComplexity.weightedAvgComplexity ?? 0) <= 3.5
													? "bg-amber-hot/10 text-amber-hot border-amber-hot/30"
													: "bg-crimson/10 text-crimson border-crimson/30",
										)}
									>
										{(prComplexity.weightedAvgComplexity ?? 0) <= 2
											? "MODEST DEPTH"
											: (prComplexity.weightedAvgComplexity ?? 0) <= 3.2
												? "SOLID DEPTH"
												: "HIGH DEPTH"}
									</Badge>
								</div>
								<div className="text-[9px] font-mono text-fg-dim mt-1">
									Simple Avg: {prComplexity.averageComplexity ?? "—"}
								</div>
							</div>

							<div className="bg-bg p-4 flex flex-col justify-between border border-line rounded-xs">
								<div className="text-[10px] tracked text-fg-dim font-mono">TOTAL IMPACT POINTS</div>
								<div className="flex items-baseline justify-between mt-2">
									<span className="font-mono text-3xl font-medium text-fg">
										{prComplexity.totalImpactPoints ?? 0}
									</span>
									<span className="text-[10px] font-mono text-fg-dim">
										pts ({prComplexity.totalEnrichedPrs} PRs)
									</span>
								</div>
								<div className="text-[9px] font-mono text-fg-dim mt-1">
									Substantive (L4+L5): {prComplexity.substantivePrCount ?? 0} PRs
								</div>
							</div>

							<div className="bg-bg p-4 flex flex-col justify-between border border-line rounded-xs col-span-1 md:col-span-2">
								<div className="flex items-center justify-between text-[10px] tracked text-fg-dim font-mono">
									<span>SCORE DISTRIBUTION (1-5)</span>
									<span className="text-[9px] text-fg-muted font-normal font-mono">
										{prComplexity.totalEnrichedPrs} Enriched PRs
									</span>
								</div>
								<div className="flex items-end gap-2 h-14 mt-2 pt-1">
									{prComplexity.distribution.map((d) => {
										const maxCount = Math.max(
											...prComplexity.distribution.map((item) => item.count),
											1,
										)
										const pct = (d.count / maxCount) * 100
										const total = prComplexity.totalEnrichedPrs || 1
										const sharePct = ((d.count / total) * 100).toFixed(0)

										const colorClass =
											d.score === 1
												? "bg-fg-dim/30 group-hover:bg-fg-dim/50"
												: d.score === 2
													? "bg-mint/60 group-hover:bg-mint/80"
													: d.score === 3
														? "bg-sky/70 group-hover:bg-sky/90"
														: d.score === 4
															? "bg-amber/80 group-hover:bg-amber"
															: "bg-amber-hot group-hover:bg-amber-hot/90"

										return (
											<div
												key={d.score}
												className="flex-1 flex flex-col items-center gap-0.5 group relative cursor-pointer"
												title={`Score ${d.score}: ${d.count} PRs (${sharePct}%)`}
											>
												<span className="text-[9px] font-mono font-medium text-fg-dim group-hover:text-fg transition-colors">
													{d.count}
												</span>
												<div className="w-full bg-line/40 rounded-xs overflow-hidden flex flex-col justify-end h-8 p-0.5">
													<div
														className={cn(
															"w-full rounded-xs transition-all duration-300",
															colorClass,
														)}
														style={{ height: `${Math.max(pct, d.count > 0 ? 12 : 0)}%` }}
													/>
												</div>
												<span className="text-[9px] font-mono text-fg-dim group-hover:text-fg font-medium transition-colors">
													L{d.score}
												</span>
											</div>
										)
									})}
								</div>
							</div>
						</div>

						{/* Average Complexity Trend Graph */}
						{prComplexity.trend && prComplexity.trend.length > 0 && (
							<div>
								<div className="text-[10px] font-mono text-fg-dim mb-3 uppercase tracking-wider">
									Average Complexity Trend Over Time
								</div>
								<div className="h-48 w-full bg-bg/50 border border-line rounded-xs p-3">
									<ResponsiveContainer width="100%" height="100%">
										<AreaChart
											data={prComplexity.trend}
											margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
										>
											<defs>
												<linearGradient id="complexityGrad" x1="0" y1="0" x2="0" y2="1">
													<stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
													<stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
												</linearGradient>
											</defs>
											<CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
											<XAxis
												dataKey="date"
												stroke="var(--fg-very-dim)"
												tick={{ fontSize: 10, fontFamily: "monospace" }}
											/>
											<YAxis
												domain={[1, 5]}
												ticks={[1, 2, 3, 4, 5]}
												stroke="var(--fg-very-dim)"
												tick={{ fontSize: 10, fontFamily: "monospace" }}
											/>
											<Tooltip
												contentStyle={{
													backgroundColor: "var(--bg-elev)",
													borderColor: "var(--line)",
													borderRadius: "4px",
													fontSize: "12px",
												}}
												formatter={(value) => [`${value ?? 0} / 5.0`, "Avg Complexity"]}
												labelFormatter={(label) => `Date: ${label}`}
											/>
											<Area
												type="monotone"
												dataKey="averageComplexity"
												stroke="#f59e0b"
												strokeWidth={2}
												fillOpacity={1}
												fill="url(#complexityGrad)"
											/>
										</AreaChart>
									</ResponsiveContainer>
								</div>
							</div>
						)}
					</div>
				</Card>
			)}

			{/* View PRs Dialog Modal */}
			<Dialog open={viewPrsOpen} onOpenChange={setViewPrsOpen}>
				<DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-bg border-line">
					<DialogHeader>
						<DialogTitle className="font-mono text-sm uppercase text-fg">
							CLASSIFIED PULL REQUESTS · {email}
						</DialogTitle>
						<DialogDescription className="text-xs text-fg-dim">
							Detailed AI classification, complexity rating, and rationale for pull requests.
						</DialogDescription>
					</DialogHeader>
					<div className="mt-2 border border-line rounded-xs overflow-x-auto">
						<Table className="w-full tabular text-xs">
							<TableHeader className="border-b border-line bg-elev2/40">
								<TableRow>
									<TableHead className="w-[180px] text-[10px] font-mono">PULL REQUEST</TableHead>
									<TableHead className="w-[120px] text-[10px] font-mono">CATEGORY</TableHead>
									<TableHead className="w-[110px] text-[10px] font-mono">SCORE</TableHead>
									<TableHead className="text-[10px] font-mono">SUMMARY & RATIONALE</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{prComplexity?.recentPrs.map((pr) => (
									<TableRow key={`${pr.repo}#${pr.number}`} className="border-line/60">
										<TableCell className="font-mono text-fg font-medium">
											{pr.repo}#{pr.number}
										</TableCell>
										<TableCell>
											<Badge
												variant="outline"
												className="text-[10px] font-mono uppercase bg-elev border-line text-fg-mid"
											>
												{pr.category}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge
												variant="outline"
												className={cn(
													"text-[10px] font-mono border",
													pr.complexityScore <= 2
														? "bg-mint/10 text-mint border-mint/30"
														: pr.complexityScore <= 3
															? "bg-amber-hot/10 text-amber-hot border-amber-hot/30"
															: "bg-crimson/10 text-crimson border-crimson/30",
												)}
											>
												{pr.complexityScore} / 5
											</Badge>
										</TableCell>
										<TableCell className="text-fg-dim text-[11px] py-2.5">
											<div className="font-medium text-fg">{pr.summary}</div>
											<div className="text-[10px] text-fg-dim mt-0.5">{pr.complexityReason}</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</DialogContent>
			</Dialog>

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
									<p className="text-fg-dim text-[11px] leading-relaxed">{rec.message}</p>
								</div>
								{rec.suggestedModel && (
									<div className="flex-shrink-0 text-right font-mono text-[11px]">
										<span className="text-fg-dim">Suggested: </span>
										<span className="text-amber font-medium">{rec.suggestedModel}</span>
										{rec.potentialSavingsCents != null && rec.potentialSavingsCents > 0 && (
											<div className="text-[10px] text-mint mt-0.5">
												Est. Savings: ${(rec.potentialSavingsCents / 100).toFixed(2)}
											</div>
										)}
									</div>
								)}
							</div>
						))}
					</div>
				</Card>
			)}

			{/* Model Usage Leaderboard */}
			<Card className="overflow-hidden">
				<SectionHeader
					title="TOP MODELS"
					subtitle={winLabel}
					action={
						<SearchInput value={modelFilter} onChange={setModelFilter} placeholder="filter…" />
					}
				/>
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
						{usageQuery.isLoading || modelRows.length === 0 ? (
							<TableStateRow
								colSpan={5}
								isLoading={usageQuery.isLoading}
								emptyText="no models in window"
							/>
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
			</Card>

			{/* Raw Models Breakdown */}
			<Card className="overflow-hidden">
				<SectionHeader
					title="RAW MODELS BREAKDOWN"
					subtitle={winLabel}
					action={
						<SearchInput
							value={rawModelFilter}
							onChange={setRawModelFilter}
							placeholder="filter…"
						/>
					}
				/>
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="h-9 w-10 px-3 text-[10px] tracked text-fg-very-dim text-right">
								#
							</TableHead>
							<SortHeader
								label="RAW MODEL"
								active={rawModelSortKey === "model"}
								dir={rawModelSortDir}
								onClick={() => toggleRawModelSort("model")}
							/>
							<SortHeader
								label={`VALUE · ${winLabel}`}
								active={rawModelSortKey === "value"}
								dir={rawModelSortDir}
								onClick={() => toggleRawModelSort("value")}
								align="right"
							/>
							<SortHeader
								label="SHARE"
								active={rawModelSortKey === "share"}
								dir={rawModelSortDir}
								onClick={() => toggleRawModelSort("share")}
								align="right"
							/>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rawModelsQuery.isLoading || rawModelRows.length === 0 ? (
							<TableStateRow
								colSpan={4}
								isLoading={rawModelsQuery.isLoading}
								emptyText="no raw models in window"
							/>
						) : (
							rawModelRows.map((m, i) => {
								return (
									<TableRow key={m.model}>
										<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-very-dim">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<div className="flex items-center min-w-0">
												<span className="flex items-center gap-1.5 min-w-0">
													<span className="flex items-center gap-1 flex-shrink-0">
														{m.platforms.includes("claude_code") && (
															<span className="w-1.5 h-1.5 bg-amber" />
														)}
														{m.platforms.includes("cursor") && (
															<span className="w-1.5 h-1.5 bg-sky" />
														)}
													</span>
													<span className="text-fg truncate font-mono">{m.model}</span>
												</span>
											</div>
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
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</Card>

			{/* Alert history (admin-only) */}
			{isAdmin ? (
				<Card>
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
