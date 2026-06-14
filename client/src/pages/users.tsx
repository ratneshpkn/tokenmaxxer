import { useQuery } from "@tanstack/react-query"
import { Filter } from "lucide-react"
import { useMemo, useState } from "react"
import { Link } from "wouter"
import { DateRangeBar } from "@/components/DateRangeBar"
import { MetricPair } from "@/components/MetricPair"
import { SortHeader } from "@/components/SortHeader"
import { Sparkline } from "@/components/Sparkline"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
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
import { useMetricMode } from "@/lib/use-metric-mode"
import { formatNumber } from "@/lib/utils"

type SortKey = "email" | "cc_cents" | "cu_cents" | "total" | "gh_lines" | "prs"

export function UsersPage(): React.JSX.Element {
	const { from, to, winLabel } = useDateRange()
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isViewer = me ? me.role !== "admin" : false
	const [metricMode] = useMetricMode()
	const effectiveMode = isViewer ? "tokens" : metricMode
	const usersQuery = useQuery({
		queryKey: ["users.list", from, to],
		queryFn: () => api.users.list({ from, to }),
	})
	const data = usersQuery.data ?? []
	const isLoading = usersQuery.isLoading

	const [filter, setFilter] = useState("")
	const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set())
	const [sortKey, setSortKey] = useState<SortKey>("total")
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

	const rows = useMemo(() => {
		const f = filter.trim().toLowerCase()
		let filtered = f
			? data.filter((r) => r.email.toLowerCase().includes(f) || r.name?.toLowerCase().includes(f))
			: data
		if (selectedEmails.size > 0) {
			filtered = filtered.filter((r) => selectedEmails.has(r.email))
		}
		const sortVal = (r: (typeof filtered)[number]): string | number => {
			if (sortKey === "email") return r.email
			if (sortKey === "total") {
				return effectiveMode === "tokens"
					? Number(r.cc_tokens) + Number(r.cu_tokens)
					: Number(r.cc_cents) + Number(r.cu_cents)
			}
			if (sortKey === "cc_cents") {
				return effectiveMode === "tokens" ? Number(r.cc_tokens) : Number(r.cc_cents)
			}
			if (sortKey === "cu_cents") {
				return effectiveMode === "tokens" ? Number(r.cu_tokens) : Number(r.cu_cents)
			}
			if (sortKey === "gh_lines") {
				return Number(r.gh_additions ?? 0) + Number(r.gh_deletions ?? 0)
			}
			if (sortKey === "prs") {
				return Number(r.gh_prs_merged ?? 0)
			}
			return 0
		}
		return [...filtered].sort((a, b) => {
			const av = sortVal(a)
			const bv = sortVal(b)
			const cmp =
				typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number)
			return sortDir === "asc" ? cmp : -cmp
		})
	}, [data, filter, selectedEmails, sortKey, sortDir, effectiveMode])

	function toggle(k: SortKey): void {
		if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setSortKey(k)
			setSortDir(k === "email" ? "asc" : "desc")
		}
	}

	return (
		<div className="space-y-4 fade-rise">
			<DateRangeBar updatedAt={usersQuery.dataUpdatedAt} />
			<div className="flex items-end justify-between gap-4">
				<div className="text-[11px] tracked text-fg-dim leading-relaxed max-w-xl">
					{data.length} USERS TRACKED · sorted by{" "}
					<span className="text-fg">
						{sortKey === "total"
							? "TOTAL"
							: sortKey === "gh_lines"
								? "LINES CHANGED"
								: sortKey.toUpperCase()}
					</span>
				</div>
				<div className="flex items-center gap-2 max-w-xs w-full">
					<Input
						placeholder="filter by email or name…"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						className="flex-1"
					/>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="icon" className="shrink-0 h-9 w-9 bg-bg border-line">
								<Filter className="w-4 h-4 text-fg-dim" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent className="w-64 max-h-[60vh] overflow-y-auto" align="end">
							<DropdownMenuLabel>Filter by User</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem
								checked={selectedEmails.size === 0}
								onCheckedChange={() => setSelectedEmails(new Set())}
							>
								All Users
							</DropdownMenuCheckboxItem>
							<DropdownMenuSeparator />
							{data.map((r) => (
								<DropdownMenuCheckboxItem
									key={r.email}
									checked={selectedEmails.has(r.email)}
									onCheckedChange={(checked) => {
										const next = new Set(selectedEmails)
										if (checked) next.add(r.email)
										else next.delete(r.email)
										setSelectedEmails(next)
									}}
								>
									<div className="flex flex-col min-w-0">
										<span className="truncate">{r.name || r.email}</span>
										{r.name && (
											<span className="text-[9px] text-fg-very-dim truncate">{r.email}</span>
										)}
									</div>
								</DropdownMenuCheckboxItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			<div className="panel overflow-hidden">
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
								label={`CLAUDE CODE · ${winLabel}`}
								active={sortKey === "cc_cents"}
								dir={sortDir}
								onClick={() => toggle("cc_cents")}
								align="right"
							/>
							<SortHeader
								label={`CURSOR · ${winLabel}`}
								active={sortKey === "cu_cents"}
								dir={sortDir}
								onClick={() => toggle("cu_cents")}
								align="right"
							/>
							<SortHeader
								label={sortKey === "prs" ? "GITHUB · PRs" : "GITHUB · LINES"}
								active={sortKey === "gh_lines" || sortKey === "prs"}
								dir={sortDir}
								onClick={() => {
									if (sortKey === "gh_lines") {
										setSortKey("prs")
										setSortDir("desc")
									} else {
										setSortKey("gh_lines")
										setSortDir("desc")
									}
								}}
								align="right"
							/>
							<SortHeader
								label={`TOTAL · ${winLabel}`}
								active={sortKey === "total"}
								dir={sortDir}
								onClick={() => toggle("total")}
								align="right"
							/>
							<TableHead className="h-9 px-3 w-[140px] text-[10px] tracked text-fg-dim text-left">
								TREND · {winLabel}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell colSpan={7} className="text-center text-fg-dim py-8 text-xs">
									── loading ──
								</TableCell>
							</TableRow>
						) : rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={7} className="text-center text-fg-dim py-8 text-xs">
									── no users ──
								</TableCell>
							</TableRow>
						) : (
							rows.map((r, i) => {
								const total =
									r.cc_cents == null || r.cu_cents == null
										? null
										: Number(r.cc_cents) + Number(r.cu_cents)
								return (
									<TableRow key={r.email}>
										<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-very-dim">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<div className="flex items-center gap-1.5">
												<Link
													href={`/users/${encodeURIComponent(r.email)}`}
													className="text-fg hover:text-amber"
												>
													{r.name || r.email}
												</Link>
												{!r.github_username && (
													<span
														title="No GitHub username mapped"
														className="inline-flex items-center px-1 py-0.5 text-[8px] tracked bg-amber/10 text-amber border border-amber/20 leading-none"
													>
														NO GH
													</span>
												)}
											</div>
											{r.name ? (
												<div className="text-[10px] text-fg-very-dim">{r.email}</div>
											) : null}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right">
											<MetricPair
												cents={isViewer ? null : r.cc_cents}
												tokens={r.cc_tokens}
												digits={2}
												primaryClassName="text-fg"
												secondaryClassName="text-[10px] text-fg-very-dim"
											/>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right">
											<MetricPair
												cents={isViewer ? null : r.cu_cents}
												tokens={r.cu_tokens}
												digits={2}
												primaryClassName="text-fg"
												secondaryClassName="text-[10px] text-fg-very-dim"
											/>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right select-none">
											<span className="block font-mono text-fg font-medium">
												{((r.gh_additions ?? 0) + (r.gh_deletions ?? 0)) > 0
													? `${formatNumber((r.gh_additions ?? 0) + (r.gh_deletions ?? 0))} lines`
													: "—"}
											</span>
											<span className="block font-mono text-mint font-medium text-[10px]">
												{r.gh_prs_merged
													? `${formatNumber(r.gh_prs_merged)} PR${r.gh_prs_merged === 1 ? "" : "s"}`
													: "0 PRs"}{" "}
												<span className="text-fg-very-dim">
													(+{formatNumber(r.gh_additions ?? 0)}/-{formatNumber(r.gh_deletions ?? 0)})
												</span>
											</span>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-amber">
											<MetricPair
												cents={isViewer ? null : total}
												tokens={Number(r.cc_tokens) + Number(r.cu_tokens)}
												digits={2}
												secondaryClassName="text-[10px] text-fg-dim"
											/>
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Sparkline
												data={
													isViewer
														? r.trend_tokens
														: metricMode === "cost"
															? (r.trend_cents ?? r.trend_tokens)
															: r.trend_tokens
												}
												color="var(--amber)"
												height={22}
											/>
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}
