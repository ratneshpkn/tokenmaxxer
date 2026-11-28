import type { UsageRow, UserRawModelsResponse } from "@shared/api-types"
import { useMemo } from "react"
import { Link } from "wouter"
import { MetricPair } from "@/components/MetricPair"
import { SearchInput } from "@/components/SearchInput"
import { SectionHeader } from "@/components/SectionHeader"
import { SortHeader } from "@/components/SortHeader"
import { Sparkline } from "@/components/Sparkline"
import { TableStateRow } from "@/components/TableStateRow"
import { Card } from "@/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import type { TrendMode } from "@/lib/display-session"
import { useTableState } from "@/lib/use-table-state"

type ModelSortKey = "model" | "value" | "share"

interface RollupRowInput {
	date?: string
	model?: string | null
	estimated_cost_cents?: number | null
	charged_cents?: number | null
	input_tokens?: number | null
	output_tokens?: number | null
	cache_read_tokens?: number | null
	cache_creation_tokens?: number | null
	cache_write_tokens?: number | null
}

function rowTokens(r: RollupRowInput): number {
	return (
		Number(r.input_tokens ?? 0) +
		Number(r.output_tokens ?? 0) +
		Number(r.cache_read_tokens ?? 0) +
		Number(r.cache_creation_tokens ?? 0) +
		Number(r.cache_write_tokens ?? 0)
	)
}

interface ModelRollupRow {
	model: string
	platforms: Array<"claude_code" | "cursor">
	cents: number
	tokens: number
	share: number
	trend: number[]
}

function rollupUserModels(
	ccRows: readonly RollupRowInput[],
	cuRows: readonly RollupRowInput[],
	trendMode: TrendMode,
	totalCents: number,
	totalTokensSum: number,
): ModelRollupRow[] {
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

	const allDates = [
		...new Set([
			...ccRows.flatMap((r) => (r.date ? [r.date] : [])),
			...cuRows.flatMap((r) => (r.date ? [r.date] : [])),
		]),
	].sort()

	const getOrCreate = (modelName: string) => {
		let entry = modelMap.get(modelName)
		if (!entry) {
			entry = {
				model: modelName,
				platforms: new Set(),
				cents: 0,
				tokens: 0,
				dailyValues: new Map(),
			}
			modelMap.set(modelName, entry)
		}
		return entry
	}

	for (const r of ccRows) {
		const entry = getOrCreate(r.model ?? "unknown")
		const cents = Number(r.estimated_cost_cents ?? 0)
		const tokens = rowTokens(r)
		entry.platforms.add("claude_code")
		entry.cents += cents
		entry.tokens += tokens
		if (r.date) {
			const val = trendMode === "tokens" ? tokens : cents
			entry.dailyValues.set(r.date, (entry.dailyValues.get(r.date) ?? 0) + val)
		}
	}

	for (const r of cuRows) {
		const entry = getOrCreate(r.model ?? "unknown")
		const cents = Number(r.charged_cents ?? 0)
		const tokens = rowTokens(r)
		entry.platforms.add("cursor")
		entry.cents += cents
		entry.tokens += tokens
		if (r.date) {
			const val = trendMode === "tokens" ? tokens : cents
			entry.dailyValues.set(r.date, (entry.dailyValues.get(r.date) ?? 0) + val)
		}
	}

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
			trend: allDates.map((date) => item.dailyValues.get(date) ?? 0),
		}
	})
}

interface UserModelsSectionProps {
	ccRows: UsageRow[]
	cuRows: UsageRow[]
	hasUsage: boolean
	usageLoading: boolean
	rawModels: UserRawModelsResponse | undefined
	rawModelsLoading: boolean
	trendMode: TrendMode
	isViewer: boolean
	totalCents: number
	totalTokensSum: number
	winLabel: string
}

export function UserModelsSection({
	ccRows,
	cuRows,
	hasUsage,
	usageLoading,
	rawModels,
	rawModelsLoading,
	trendMode,
	isViewer,
	totalCents,
	totalTokensSum,
	winLabel,
}: UserModelsSectionProps): React.JSX.Element {
	const leaderboardData = useMemo(
		() => (hasUsage ? rollupUserModels(ccRows, cuRows, trendMode, totalCents, totalTokensSum) : []),
		[hasUsage, ccRows, cuRows, trendMode, totalCents, totalTokensSum],
	)

	const rawModelData = useMemo(
		() =>
			rawModels
				? rollupUserModels(
						rawModels.claude_code,
						rawModels.cursor,
						trendMode,
						totalCents,
						totalTokensSum,
					)
				: [],
		[rawModels, trendMode, totalCents, totalTokensSum],
	)

	const sortValue = (m: ModelRollupRow, key: ModelSortKey): string | number => {
		switch (key) {
			case "model":
				return m.model
			case "value":
				return trendMode === "tokens" ? m.tokens : m.cents
			case "share":
				return m.share
		}
	}

	const topTable = useTableState({
		data: leaderboardData,
		initialSortKey: "value" as ModelSortKey,
		ascKeys: ["model"],
		filterBy: (m, q) => m.model.toLowerCase().includes(q),
		sortValue,
	})

	const rawTable = useTableState({
		data: rawModelData,
		initialSortKey: "value" as ModelSortKey,
		ascKeys: ["model"],
		filterBy: (m, q) => m.model.toLowerCase().includes(q),
		sortValue,
	})

	return (
		<>
			<Card className="overflow-hidden">
				<SectionHeader
					title="TOP MODELS"
					subtitle={winLabel}
					action={
						<SearchInput
							value={topTable.filter}
							onChange={topTable.setFilter}
							placeholder="filter…"
						/>
					}
				/>
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="w-14 text-right">#</TableHead>
							<SortHeader
								label="MODEL"
								active={topTable.sortKey === "model"}
								dir={topTable.sortDir}
								onClick={() => topTable.toggleSort("model")}
							/>
							<SortHeader
								label="VALUE"
								active={topTable.sortKey === "value"}
								dir={topTable.sortDir}
								onClick={() => topTable.toggleSort("value")}
								align="right"
							/>
							<SortHeader
								label="SHARE"
								active={topTable.sortKey === "share"}
								dir={topTable.sortDir}
								onClick={() => topTable.toggleSort("share")}
								align="right"
							/>
							<TableHead className="w-[140px]">TREND</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{usageLoading || topTable.rows.length === 0 ? (
							<TableStateRow colSpan={5} isLoading={usageLoading} emptyText="no models in window" />
						) : (
							topTable.rows.map((m, i) => (
								<TableRow key={m.model}>
									<TableCell className="px-3 py-2.5 text-right text-xs tabular text-fg-subtle">
										{String(i + 1).padStart(3, "0")}
									</TableCell>
									<TableCell className="px-3 py-2.5">
										<Link
											href={`/models/${encodeURIComponent(m.model)}`}
											className="flex items-center min-w-0 hover:text-amber transition-colors group"
										>
											<span className="flex items-center gap-1 mr-2 shrink-0">
												{m.platforms.includes("claude_code") && (
													<span className="w-1.5 h-1.5 bg-amber" />
												)}
												{m.platforms.includes("cursor") && <span className="w-1.5 h-1.5 bg-sky" />}
											</span>
											<span className="text-fg truncate group-hover:text-amber transition-colors">
												{m.model}
											</span>
										</Link>
									</TableCell>
									<TableCell className="px-3 py-2.5 text-right text-fg">
										<MetricPair cents={isViewer ? null : m.cents} tokens={m.tokens} digits={2} />
									</TableCell>
									<TableCell className="px-3 py-2.5 text-right text-fg-muted text-xs">
										{m.share.toFixed(1)}%
									</TableCell>
									<TableCell className="px-3 py-2.5">
										<Sparkline data={m.trend} color="var(--fg-muted)" height={22} />
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</Card>

			<Card className="overflow-hidden">
				<SectionHeader
					title="RAW MODELS BREAKDOWN"
					subtitle={winLabel}
					action={
						<SearchInput
							value={rawTable.filter}
							onChange={rawTable.setFilter}
							placeholder="filter…"
						/>
					}
				/>
				<Table className="w-full tabular text-xs table-fixed">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="w-14 text-right">#</TableHead>
							<SortHeader
								label="RAW MODEL"
								active={rawTable.sortKey === "model"}
								dir={rawTable.sortDir}
								onClick={() => rawTable.toggleSort("model")}
							/>
							<SortHeader
								label="VALUE"
								active={rawTable.sortKey === "value"}
								dir={rawTable.sortDir}
								onClick={() => rawTable.toggleSort("value")}
								align="right"
							/>
							<SortHeader
								label="SHARE"
								active={rawTable.sortKey === "share"}
								dir={rawTable.sortDir}
								onClick={() => rawTable.toggleSort("share")}
								align="right"
							/>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rawModelsLoading || rawTable.rows.length === 0 ? (
							<TableStateRow
								colSpan={4}
								isLoading={rawModelsLoading}
								emptyText="no raw models in window"
							/>
						) : (
							rawTable.rows.map((m, i) => (
								<TableRow key={m.model}>
									<TableCell className="px-3 py-2.5 text-right text-xs tabular text-fg-subtle">
										{String(i + 1).padStart(3, "0")}
									</TableCell>
									<TableCell className="px-3 py-2.5">
										<div className="flex items-center min-w-0">
											<span className="flex items-center gap-1 mr-2 shrink-0">
												{m.platforms.includes("claude_code") && (
													<span className="w-1.5 h-1.5 bg-amber" />
												)}
												{m.platforms.includes("cursor") && <span className="w-1.5 h-1.5 bg-sky" />}
											</span>
											<span className="text-fg truncate font-mono">{m.model}</span>
										</div>
									</TableCell>
									<TableCell className="px-3 py-2.5 text-right text-fg">
										<MetricPair cents={isViewer ? null : m.cents} tokens={m.tokens} digits={2} />
									</TableCell>
									<TableCell className="px-3 py-2.5 text-right text-fg-muted text-xs">
										{m.share.toFixed(1)}%
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</Card>
		</>
	)
}
