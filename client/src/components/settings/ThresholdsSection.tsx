import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Cost } from "@/components/Cost"
import { SectionHeader } from "@/components/SectionHeader"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { platformLabel } from "@/lib/display-session"

export function ThresholdsSection(): React.JSX.Element {
	const qc = useQueryClient()
	const { data: thresholds } = useQuery({
		queryKey: ["thresholds"],
		queryFn: api.thresholds.list,
	})

	const setGlobal = useMutation({
		mutationFn: ({ platform, cents }: { platform: "claude_code" | "cursor"; cents: number }) =>
			api.thresholds.setGlobal(platform, cents, true),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["thresholds"] }),
	})

	const ccGlobalCents = thresholds?.global.claude_code ?? 5000
	const cuGlobalCents = thresholds?.global.cursor ?? 5000
	const userOverrides = thresholds?.perUser ?? []

	const [ccDollars, setCcDollars] = useState(ccGlobalCents / 100)
	const [cuDollars, setCuDollars] = useState(cuGlobalCents / 100)

	const loadedCcCents = thresholds?.global.claude_code
	const loadedCuCents = thresholds?.global.cursor

	useEffect(() => {
		if (loadedCcCents !== undefined) setCcDollars(loadedCcCents / 100)
	}, [loadedCcCents])

	useEffect(() => {
		if (loadedCuCents !== undefined) setCuDollars(loadedCuCents / 100)
	}, [loadedCuCents])

	return (
		<Card>
			<SectionHeader
				title="GLOBAL DAILY THRESHOLDS"
				action={<Typography variant="label">PER USER · PER PLATFORM</Typography>}
			/>
			<div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line">
				<div className="p-5 space-y-3">
					<div className="flex items-center gap-2 text-xs tracked">
						<span className="w-1.5 h-1.5 bg-amber" />
						<span className="text-fg-muted">CLAUDE CODE · DAILY $ THRESHOLD</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="relative flex-1 max-w-[180px]">
							<span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted font-mono text-xs pointer-events-none">
								$
							</span>
							<Input
								type="number"
								min="0"
								step="1"
								value={ccDollars}
								onChange={(e) => setCcDollars(parseFloat(e.target.value || "0"))}
								className="pl-7 h-9 text-xs font-mono"
							/>
						</div>
						<Button
							size="sm"
							disabled={setGlobal.isPending}
							onClick={() =>
								setGlobal.mutate({ platform: "claude_code", cents: Math.round(ccDollars * 100) })
							}
						>
							SAVE
						</Button>
					</div>
					<div className="text-xs tracked text-fg-muted">
						ACTIVE THRESHOLD: <Cost cents={ccGlobalCents} className="text-fg font-mono" />
					</div>
				</div>

				<div className="p-5 space-y-3">
					<div className="flex items-center gap-2 text-xs tracked">
						<span className="w-1.5 h-1.5 bg-sky" />
						<span className="text-fg-muted">CURSOR · DAILY $ THRESHOLD</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="relative flex-1 max-w-[180px]">
							<span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted font-mono text-xs pointer-events-none">
								$
							</span>
							<Input
								type="number"
								min="0"
								step="1"
								value={cuDollars}
								onChange={(e) => setCuDollars(parseFloat(e.target.value || "0"))}
								className="pl-7 h-9 text-xs font-mono"
							/>
						</div>
						<Button
							size="sm"
							disabled={setGlobal.isPending}
							onClick={() =>
								setGlobal.mutate({ platform: "cursor", cents: Math.round(cuDollars * 100) })
							}
						>
							SAVE
						</Button>
					</div>
					<div className="text-xs tracked text-fg-muted">
						ACTIVE THRESHOLD: <Cost cents={cuGlobalCents} className="text-fg font-mono" />
					</div>
				</div>
			</div>

			{userOverrides.length > 0 ? (
				<div className="border-t border-line p-5">
					<div className="text-xs tracked text-fg-muted mb-3">PER-USER OVERRIDES</div>
					<Table className="w-full tabular text-xs">
						<TableHeader>
							<TableRow>
								<TableHead className="px-2">USER</TableHead>
								<TableHead className="px-2">PLATFORM</TableHead>
								<TableHead className="px-2 text-right">DAILY $</TableHead>
								<TableHead className="px-2">STATE</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{userOverrides.map((t) => (
								<TableRow key={t.id}>
									<TableCell className="px-2 py-2 text-fg">{t.email}</TableCell>
									<TableCell className="px-2 py-2 text-fg-muted">
										{platformLabel(t.platform)}
									</TableCell>
									<TableCell className="px-2 py-2 text-right text-amber">
										<Cost cents={t.dailyCents} />
									</TableCell>
									<TableCell className="px-2 py-2 text-xs tracked">
										<span className={t.enabled ? "text-mint" : "text-fg-muted"}>
											● {t.enabled ? "armed" : "disabled"}
										</span>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			) : null}
		</Card>
	)
}
