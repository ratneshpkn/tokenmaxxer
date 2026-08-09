import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Cost } from "@/components/Cost"
import { TableStateRow } from "@/components/TableStateRow"
import { UserLink } from "@/components/UserLink"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Typography } from "@/components/ui/typography"
import { api } from "@/lib/api"
import { platformLabel } from "@/lib/platform"
import { formatDate } from "@/lib/utils"

type Status = "open" | "acknowledged" | "resolved" | "all"

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
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["alerts"] })
			qc.invalidateQueries({ queryKey: ["dashboard.alerts"] })
		},
	})
	const resolve = useMutation({
		mutationFn: (id: string) => api.alerts.resolve(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["alerts"] })
			qc.invalidateQueries({ queryKey: ["dashboard.alerts"] })
		},
	})

	return (
		<div className="space-y-4 fade-rise">
			<div className="flex items-end justify-between gap-4">
				<Typography variant="muted" as="p" className="max-w-xl">
					Daily threshold alerts by user × platform. Each row is one (date · user · platform)
					trigger. Acknowledge to mark seen, resolve to close.
				</Typography>
				<Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
					<TabsList>
						<TabsTrigger value="open">OPEN</TabsTrigger>
						<TabsTrigger value="acknowledged">ACK</TabsTrigger>
						<TabsTrigger value="resolved">RESOLVED</TabsTrigger>
						<TabsTrigger value="all">ALL</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			<Card className="overflow-hidden">
				<Table className="w-full tabular text-xs">
					<TableHeader className="border-b border-line bg-elev2/40">
						<TableRow>
							<TableHead className="w-14 text-right">#</TableHead>
							<TableHead>DATE</TableHead>
							<TableHead>USER</TableHead>
							<TableHead>PLATFORM</TableHead>
							<TableHead className="text-right">SPEND</TableHead>
							<TableHead className="text-right">LIMIT</TableHead>
							<TableHead className="text-right">RATIO</TableHead>
							<TableHead>STATUS</TableHead>
							<TableHead className="text-right">ACTION</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading || data.length === 0 ? (
							<TableStateRow colSpan={9} isLoading={isLoading} emptyText="all clear" />
						) : (
							data.map((a, i) => {
								const ratio = a.thresholdCents > 0 ? a.amountCents / a.thresholdCents : 0
								const ratioColor =
									ratio >= 5 ? "text-amber-hot" : ratio >= 2 ? "text-amber" : "text-fg"
								return (
									<TableRow key={a.id}>
										<TableCell className="px-3 py-2.5 text-right text-xs tabular text-fg-subtle">
											{String(i + 1).padStart(3, "0")}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-fg-muted">
											{formatDate(a.date)}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<UserLink email={a.email} name={a.name} />
										</TableCell>
										<TableCell className="px-3 py-2.5 text-xs text-fg-muted">
											{platformLabel(a.platform)}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-amber-hot">
											<Cost cents={a.amountCents} digits={2} />
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-fg-muted">
											<Cost cents={a.thresholdCents} digits={2} />
										</TableCell>
										<TableCell className={`px-3 py-2.5 text-right ${ratioColor}`}>
											▲ {ratio.toFixed(1)}x
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<Badge
												variant={
													a.status === "resolved"
														? "success"
														: a.status === "open"
															? "destructive"
															: "warning"
												}
												className="uppercase tracking-wider font-mono"
											>
												<span className={STATUS_PIP[a.status]} />
												{a.status}
											</Badge>
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right">
											<div className="flex items-center justify-end gap-1.5">
												{a.status === "open" ? (
													<Tooltip>
														<TooltipTrigger asChild>
															<Button variant="amber" size="xs" onClick={() => ack.mutate(a.id)}>
																ACK
															</Button>
														</TooltipTrigger>
														<TooltipContent>MARK AS SEEN</TooltipContent>
													</Tooltip>
												) : null}
												{a.status !== "resolved" ? (
													<Tooltip>
														<TooltipTrigger asChild>
															<Button variant="mint" size="xs" onClick={() => resolve.mutate(a.id)}>
																RESOLVE
															</Button>
														</TooltipTrigger>
														<TooltipContent>CLOSE ALERT</TooltipContent>
													</Tooltip>
												) : null}
											</div>
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</Card>
		</div>
	)
}
