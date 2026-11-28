import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SectionHeader } from "@/components/SectionHeader"
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
import { api } from "@/lib/api"
import { formatDate, formatDuration } from "@/lib/utils"

const STATUS_COLOR: Record<string, string> = {
	success: "text-mint",
	failed: "text-amber-hot",
	running: "text-amber",
}

const SYNC_JOBS = [
	["anthropic", "ANTHROPIC", "Pulls last 30 days. 365 if no data yet.", true],
	["cursor", "CURSOR", "Pulls last 30 days. 365 if no data yet.", true],
	["github", "GITHUB", "Pulls PR stats & activity.", true],
	["pr_files", "PR FILES", "Caches changed file lists & diffs.", false],
	["prs_enrich", "PR ENRICH", "Classifies & scores PR complexity.", false],
	["recommendations", "ADVISOR", "Recompute model recommendations.", false],
	["alerts", "ALERTS", "Recompute threshold breaches", false],
	["slack_digest", "SLACK", "Post daily digest now", false],
] as const

export function SyncSection(): React.JSX.Element {
	const qc = useQueryClient()
	const { data: runs = [] } = useQuery({
		queryKey: ["sync.runs"],
		queryFn: () => api.sync.runs(20),
		refetchInterval: (q) => {
			const data = q.state.data ?? []
			return data.some((r) => r.status === "running") ? 2000 : false
		},
	})

	const triggerSync = useMutation({
		mutationFn: ({ job, full }: { job: (typeof SYNC_JOBS)[number][0]; full: boolean }) =>
			api.sync.run(job, full),
		onSuccess: () => {
			setTimeout(() => qc.invalidateQueries({ queryKey: ["sync.runs"] }), 1500)
		},
	})

	return (
		<>
			<Card>
				<SectionHeader
					title="MANUAL SYNC"
					action={<Typography variant="label">RUNS IN THE BACKGROUND</Typography>}
				/>
				<div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
					{SYNC_JOBS.map(([job, label, sub, full]) => (
						<Button
							key={job}
							variant="outline"
							onClick={() => triggerSync.mutate({ job, full })}
							className="h-auto text-left p-3 flex-col items-start justify-start border-line hover:border-amber hover:bg-amber/[0.04] whitespace-normal w-full"
						>
							<Typography variant="label">▶ RUN</Typography>
							<div className="font-mono text-sm tracked text-fg mt-1">{label}</div>
							<Typography variant="caption" className="mt-1">
								{sub}
							</Typography>
						</Button>
					))}
				</div>
			</Card>

			<Card>
				<SectionHeader title="RECENT SYNC RUNS" />
				<Table className="w-full tabular text-xs">
					<TableHeader>
						<TableRow>
							<TableHead className="px-3">JOB</TableHead>
							<TableHead className="px-3">STATUS</TableHead>
							<TableHead className="px-3">TRIGGER</TableHead>
							<TableHead className="px-3">STARTED</TableHead>
							<TableHead className="px-3 text-right">DURATION</TableHead>
							<TableHead className="px-3 text-right">ROWS</TableHead>
							<TableHead className="px-3">NOTE</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{runs.length === 0 ? (
							<TableRow>
								<TableCell colSpan={7} className="text-center text-fg-muted py-6 text-xs">
									── no runs ──
								</TableCell>
							</TableRow>
						) : (
							runs.map((r) => (
								<TableRow key={r.id}>
									<TableCell className="px-3 py-2 text-fg">{r.job}</TableCell>
									<TableCell className="px-3 py-2">
										<span className={`text-xs tracked ${STATUS_COLOR[r.status]}`}>
											● {r.status}
										</span>
									</TableCell>
									<TableCell className="px-3 py-2 text-fg-muted text-xs tracked">
										{r.triggeredBy ?? "—"}
									</TableCell>
									<TableCell className="px-3 py-2 text-fg-muted text-xs">
										{formatDate(r.startedAt)}
									</TableCell>
									<TableCell className="px-3 py-2 text-right text-fg-muted text-xs">
										{formatDuration(r.startedAt, r.completedAt)}
									</TableCell>
									<TableCell className="px-3 py-2 text-right text-fg">
										{r.rowsUpserted.toLocaleString()}
									</TableCell>
									<TableCell className="px-3 py-2 text-amber-hot text-xs truncate max-w-md">
										{r.error ?? ""}
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
