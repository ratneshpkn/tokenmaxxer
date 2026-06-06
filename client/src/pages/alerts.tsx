import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "wouter"
import { Cost } from "@/components/Cost"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { platformLabel } from "@/lib/platform"
import { formatDate } from "@/lib/utils"

type Status = "open" | "acknowledged" | "resolved" | "all"

const STATUS_COLOR: Record<string, string> = {
	open: "text-amber-hot",
	acknowledged: "text-amber",
	resolved: "text-mint",
}

const STATUS_PIP: Record<string, string> = {
	open: "pip-danger",
	acknowledged: "pip-warn",
	resolved: "pip-live",
}

export function AlertsPage(): React.JSX.Element {
	const [status, setStatus] = useState<Status>("open")
	const qc = useQueryClient()
	const { data = [], isLoading } = useQuery({
		queryKey: ["alerts", status],
		queryFn: () => api.alerts.list(status),
	})

	const ack = useMutation({
		mutationFn: (id: string) => api.alerts.acknowledge(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
	})
	const resolve = useMutation({
		mutationFn: (id: string) => api.alerts.resolve(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
	})

	return (
		<div className="space-y-6 fade-rise">
			<div className="flex items-end justify-between gap-4">
				<p className="text-[11px] tracked text-fg-dim leading-relaxed max-w-xl">
					Daily threshold alerts by user × platform. Each row is one (date · user · platform)
					trigger. Acknowledge to mark seen, resolve to close.
				</p>
				<Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
					<TabsList>
						<TabsTrigger value="open">OPEN</TabsTrigger>
						<TabsTrigger value="acknowledged">ACK</TabsTrigger>
						<TabsTrigger value="resolved">RESOLVED</TabsTrigger>
						<TabsTrigger value="all">ALL</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			<div className="panel overflow-hidden">
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
								USER
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
							<TableHead className="h-9 px-3 text-[10px] tracked text-fg-dim text-right">
								ACTION
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell colSpan={9} className="text-center text-fg-dim py-8 text-xs">
									── scanning ──
								</TableCell>
							</TableRow>
						) : data.length === 0 ? (
							<TableRow>
								<TableCell colSpan={9} className="text-center text-fg-dim py-8 text-xs">
									── all clear ──
								</TableCell>
							</TableRow>
						) : (
							data.map((a, i) => {
								const ratio = a.thresholdCents > 0 ? a.amountCents / a.thresholdCents : 0
								const ratioColor =
									ratio >= 5 ? "text-amber-hot" : ratio >= 2 ? "text-amber" : "text-fg"
								return (
									<TableRow key={a.id}>
										<TableCell className="px-3 py-2.5 text-right text-[10px] tabular text-fg-very-dim">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-fg-mid">{formatDate(a.date)}</TableCell>
										<TableCell className="px-3 py-2.5">
											<Link
												href={`/users/${encodeURIComponent(a.email)}`}
												className="text-fg hover:text-amber"
											>
												{a.name || a.email}
											</Link>
											{a.name ? (
												<div className="text-[10px] text-fg-very-dim">{a.email}</div>
											) : null}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-[10px] tracked text-fg-mid">
											{platformLabel(a.platform)}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-amber-hot">
											<Cost cents={a.amountCents} digits={2} />
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg-dim">
											<Cost cents={a.thresholdCents} digits={2} />
										</TableCell>
										<TableCell className={`px-3 py-2.5 text-right ${ratioColor}`}>
											▲ {ratio.toFixed(1)}x
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<span
												className={`flex items-center gap-2 text-[10px] tracked ${STATUS_COLOR[a.status]}`}
											>
												<span className={STATUS_PIP[a.status]} />
												{a.status}
											</span>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right space-x-2">
											{a.status === "open" ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<button
															type="button"
															className="text-[10px] tracked text-fg-mid hover:text-amber border border-line hover:border-amber px-2 py-0.5"
															onClick={() => ack.mutate(a.id)}
														>
															ACK
														</button>
													</TooltipTrigger>
													<TooltipContent>MARK AS SEEN</TooltipContent>
												</Tooltip>
											) : null}
											{a.status !== "resolved" ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<button
															type="button"
															className="text-[10px] tracked text-fg-mid hover:text-mint border border-line hover:border-mint px-2 py-0.5"
															onClick={() => resolve.mutate(a.id)}
														>
															RESOLVE
														</button>
													</TooltipTrigger>
													<TooltipContent>CLOSE ALERT</TooltipContent>
												</Tooltip>
											) : null}
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
