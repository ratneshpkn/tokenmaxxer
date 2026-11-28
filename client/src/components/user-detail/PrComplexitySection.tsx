import type { UserPRComplexityResponse } from "@shared/api-types"
import { useState } from "react"
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts"
import { SectionHeader } from "@/components/SectionHeader"
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
import { cn } from "@/lib/utils"

interface PrComplexitySectionProps {
	email: string
	prComplexity: UserPRComplexityResponse
}

export function PrComplexitySection({
	email,
	prComplexity,
}: PrComplexitySectionProps): React.JSX.Element {
	const [viewPrsOpen, setViewPrsOpen] = useState(false)

	return (
		<>
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
					<div className="grid grid-cols-1 md:grid-cols-4 gap-4 pb-5 border-b border-line">
						<div className="bg-bg p-4 flex flex-col justify-between border border-line rounded-xs">
							<div className="text-[10px] tracked text-fg-muted font-mono">
								WEIGHTED COMPLEXITY (1.0-5.0)
							</div>
							<div className="flex items-baseline gap-2 mt-2">
								<span className="font-mono text-3xl font-medium text-amber font-bold">
									{prComplexity.weightedAvgComplexity ?? prComplexity.averageComplexity ?? "—"}
								</span>
								<span className="text-xs font-mono text-fg-muted">/ 5.0</span>
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
							<div className="text-[9px] font-mono text-fg-muted mt-1">
								Simple Avg: {prComplexity.averageComplexity ?? "—"}
							</div>
						</div>

						<div className="bg-bg p-4 flex flex-col justify-between border border-line rounded-xs">
							<div className="text-[10px] tracked text-fg-muted font-mono">TOTAL IMPACT POINTS</div>
							<div className="flex items-baseline justify-between mt-2">
								<span className="font-mono text-3xl font-medium text-fg">
									{prComplexity.totalImpactPoints ?? 0}
								</span>
								<span className="text-[10px] font-mono text-fg-muted">
									pts ({prComplexity.totalEnrichedPrs} PRs)
								</span>
							</div>
							<div className="text-[9px] font-mono text-fg-muted mt-1">
								Substantive (L4+L5): {prComplexity.substantivePrCount ?? 0} PRs
							</div>
						</div>

						<div className="bg-bg p-4 flex flex-col justify-between border border-line rounded-xs col-span-1 md:col-span-2">
							<div className="flex items-center justify-between text-[10px] tracked text-fg-muted font-mono">
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
											? "bg-fg-subtle/30 group-hover:bg-fg-subtle/50"
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
											<span className="text-[9px] font-mono font-medium text-fg-muted group-hover:text-fg transition-colors">
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
											<span className="text-[9px] font-mono text-fg-muted group-hover:text-fg font-medium transition-colors">
												L{d.score}
											</span>
										</div>
									)
								})}
							</div>
						</div>
					</div>

					{prComplexity.trend && prComplexity.trend.length > 0 && (
						<div>
							<div className="text-[10px] font-mono text-fg-muted mb-3 uppercase tracking-wider">
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
											stroke="var(--fg-subtle)"
											tick={{ fontSize: 10, fontFamily: "monospace" }}
										/>
										<YAxis
											domain={[1, 5]}
											ticks={[1, 2, 3, 4, 5]}
											stroke="var(--fg-subtle)"
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

			<Dialog open={viewPrsOpen} onOpenChange={setViewPrsOpen}>
				<DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-bg border-line">
					<DialogHeader>
						<DialogTitle className="font-mono text-sm uppercase text-fg">
							CLASSIFIED PULL REQUESTS · {email}
						</DialogTitle>
						<DialogDescription className="text-xs text-fg-muted">
							Detailed AI classification, complexity rating, and rationale for pull requests.
						</DialogDescription>
					</DialogHeader>
					<div className="mt-2 border border-line rounded-xs overflow-x-auto">
						<Table className="w-full tabular text-xs">
							<TableHeader className="border-b border-line bg-elev2/40">
								<TableRow>
									<TableHead className="w-[180px]">PULL REQUEST</TableHead>
									<TableHead className="w-[120px]">CATEGORY</TableHead>
									<TableHead className="w-[110px]">SCORE</TableHead>
									<TableHead>SUMMARY & RATIONALE</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{prComplexity.recentPrs.map((pr) => (
									<TableRow key={`${pr.repo}#${pr.number}`} className="border-line/60">
										<TableCell className="font-mono text-fg font-medium">
											{pr.repo}#{pr.number}
										</TableCell>
										<TableCell>
											<Badge
												variant="outline"
												className="text-[10px] font-mono uppercase bg-elev border-line text-fg-muted"
											>
												{pr.category || "uncategorized"}
											</Badge>
										</TableCell>
										<TableCell>
											{pr.complexityScore != null ? (
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
											) : (
												<span className="text-[10px] font-mono text-fg-muted">—</span>
											)}
										</TableCell>
										<TableCell className="text-fg-muted text-xs py-2.5">
											<div className="font-medium text-fg">{pr.summary || pr.title}</div>
											{pr.complexityReason && (
												<div className="text-xs text-fg-muted mt-0.5">{pr.complexityReason}</div>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
