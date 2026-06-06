import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { platformLabel } from "@/lib/platform"
import { formatCents, formatDate } from "@/lib/utils"

export function SettingsPage(): React.JSX.Element {
	const qc = useQueryClient()
	const { data: thresholds } = useQuery({
		queryKey: ["thresholds"],
		queryFn: api.thresholds.list,
	})
	const { data: runs = [] } = useQuery({
		queryKey: ["sync.runs"],
		queryFn: () => api.sync.runs(20),
		refetchInterval: (q) => {
			const data = q.state.data ?? []
			return data.some((r) => r.status === "running") ? 2000 : false
		},
	})
	const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: api.config })
	const { data: invites = [] } = useQuery({
		queryKey: ["invitations"],
		queryFn: api.invitations.list,
	})

	const setGlobal = useMutation({
		mutationFn: ({ platform, cents }: { platform: "claude_code" | "cursor"; cents: number }) =>
			api.thresholds.setGlobal(platform, cents, true),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["thresholds"] }),
	})
	const triggerSync = useMutation({
		mutationFn: ({
			job,
			full,
		}: {
			job: "anthropic" | "cursor" | "alerts" | "slack_digest"
			full: boolean
		}) => api.sync.run(job, full),
		onSuccess: () => {
			setTimeout(() => qc.invalidateQueries({ queryKey: ["sync.runs"] }), 1500)
		},
	})

	const createInvite = useMutation({
		mutationFn: ({ email, role }: { email: string; role: "viewer" | "admin" }) =>
			api.invitations.create(email, role),
		onSuccess: (res) => {
			navigator.clipboard?.writeText(res.url)
			qc.invalidateQueries({ queryKey: ["invitations"] })
			alert(`Invite link copied to clipboard:\n${res.url}`)
		},
	})

	const deleteInviteMut = useMutation({
		mutationFn: (id: string) => api.invitations.delete(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
	})

	const ccGlobalCents = thresholds?.global.claude_code ?? 5000
	const cuGlobalCents = thresholds?.global.cursor ?? 5000
	const userOverrides = thresholds?.perUser ?? []

	const [ccDollars, setCcDollars] = useState(ccGlobalCents / 100)
	const [cuDollars, setCuDollars] = useState(cuGlobalCents / 100)

	const [inviteEmail, setInviteEmail] = useState("")
	const [inviteRole, setInviteRole] = useState<"viewer" | "admin">("viewer")

	const STATUS_COLOR: Record<string, string> = {
		success: "text-mint",
		failed: "text-amber-hot",
		running: "text-amber",
	}

	return (
		<div className="space-y-8 fade-rise">
			{/* Organization */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line">
					<span className="text-[11px] tracked text-fg">ORGANIZATION</span>
				</div>
				<div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
					<div>
						<Label className="text-[10px] tracked text-fg-dim">ORG NAME</Label>
						<p className="mt-1 text-fg">{cfg?.orgName || "—"}</p>
					</div>
					<div>
						<Label className="text-[10px] tracked text-fg-dim">ALLOWED DOMAIN</Label>
						<p className="mt-1 text-fg">{cfg?.allowedEmailDomain || "Any"}</p>
					</div>
					<div>
						<Label className="text-[10px] tracked text-fg-dim">GOOGLE OAUTH</Label>
						<p className="mt-1 text-fg">{cfg?.googleOauthEnabled ? "Enabled" : "Disabled"}</p>
					</div>
					<div>
						<Label className="text-[10px] tracked text-fg-dim">SELF-SIGNUP</Label>
						<p className="mt-1 text-fg">
							{cfg?.openSignupEnabled ? "Enabled (domain-gated)" : "Invite-only"}
						</p>
					</div>
				</div>
			</section>

			{/* Invitations */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line">
					<span className="text-[11px] tracked text-fg">INVITATIONS</span>
				</div>
				<div className="p-5 space-y-4">
					<div className="flex gap-2 items-end">
						<div className="flex-1">
							<Label className="text-[10px] tracked text-fg-dim">EMAIL</Label>
							<Input
								value={inviteEmail}
								onChange={(e) => setInviteEmail(e.target.value)}
								placeholder="newperson@example.com"
								className="mt-1"
							/>
						</div>
						<div className="w-32">
							<Label className="text-[10px] tracked text-fg-dim">ROLE</Label>
							<select
								value={inviteRole}
								onChange={(e) => setInviteRole(e.target.value as "viewer" | "admin")}
								className="mt-1 w-full h-8 bg-transparent border border-line text-fg text-xs px-2"
							>
								<option value="viewer">VIEWER</option>
								<option value="admin">ADMIN</option>
							</select>
						</div>
						<Button
							onClick={() => createInvite.mutate({ email: inviteEmail, role: inviteRole })}
							disabled={!inviteEmail.trim()}
						>
							GENERATE LINK
						</Button>
					</div>
					{invites.length > 0 ? (
						<Table className="w-full tabular text-xs">
							<TableHeader>
								<TableRow>
									<TableHead className="h-8 px-2 text-left text-[10px] tracked text-fg-dim">
										EMAIL
									</TableHead>
									<TableHead className="h-8 px-2 text-left text-[10px] tracked text-fg-dim">
										ROLE
									</TableHead>
									<TableHead className="h-8 px-2 text-left text-[10px] tracked text-fg-dim">
										EXPIRES
									</TableHead>
									<TableHead className="h-8 px-2 text-right text-[10px] tracked text-fg-dim">
										ACTION
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{invites.map((i) => (
									<TableRow key={i.id}>
										<TableCell className="px-2 py-2 text-fg">{i.email}</TableCell>
										<TableCell className="px-2 py-2 text-fg-mid">{i.role}</TableCell>
										<TableCell className="px-2 py-2 text-fg-dim">
											{new Date(i.expiresAt).toLocaleDateString()}
										</TableCell>
										<TableCell className="px-2 py-2 text-right">
											<button
												type="button"
												className="text-[10px] tracked text-fg-mid hover:text-amber-hot"
												onClick={() => deleteInviteMut.mutate(i.id)}
											>
												REVOKE
											</button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<p className="text-xs text-fg-dim">— no pending invitations —</p>
					)}
				</div>
			</section>

			{/* Thresholds */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line flex items-center justify-between">
					<span className="text-[11px] tracked text-fg">GLOBAL DAILY THRESHOLDS</span>
					<span className="text-[10px] tracked text-fg-dim">PER USER · PER PLATFORM</span>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line">
					<div className="p-5 space-y-3">
						<div className="flex items-center gap-2 text-[10px] tracked">
							<span className="w-1.5 h-1.5 bg-amber" />
							<span className="text-fg-dim">CLAUDE CODE · DAILY $</span>
						</div>
						<div className="flex items-end gap-3">
							<span className="text-fg-very-dim font-mono text-2xl">$</span>
							<Input
								type="number"
								value={ccDollars}
								onChange={(e) => setCcDollars(parseFloat(e.target.value || "0"))}
								className="text-2xl h-12 max-w-[160px]"
							/>
							<Button
								onClick={() =>
									setGlobal.mutate({ platform: "claude_code", cents: Math.round(ccDollars * 100) })
								}
							>
								COMMIT
							</Button>
						</div>
						<div className="text-[10px] tracked text-fg-dim">
							ACTIVE: {formatCents(ccGlobalCents)}
						</div>
					</div>

					<div className="p-5 space-y-3">
						<div className="flex items-center gap-2 text-[10px] tracked">
							<span className="w-1.5 h-1.5 bg-sky" />
							<span className="text-fg-dim">CURSOR · DAILY $</span>
						</div>
						<div className="flex items-end gap-3">
							<span className="text-fg-very-dim font-mono text-2xl">$</span>
							<Input
								type="number"
								value={cuDollars}
								onChange={(e) => setCuDollars(parseFloat(e.target.value || "0"))}
								className="text-2xl h-12 max-w-[160px]"
							/>
							<Button
								onClick={() =>
									setGlobal.mutate({ platform: "cursor", cents: Math.round(cuDollars * 100) })
								}
							>
								COMMIT
							</Button>
						</div>
						<div className="text-[10px] tracked text-fg-dim">
							ACTIVE: {formatCents(cuGlobalCents)}
						</div>
					</div>
				</div>

				{userOverrides.length > 0 ? (
					<div className="border-t border-line p-5">
						<div className="text-[10px] tracked text-fg-dim mb-3">PER-USER OVERRIDES</div>
						<Table className="w-full tabular text-xs">
							<TableHeader>
								<TableRow>
									<TableHead className="h-8 px-2 text-left text-[10px] tracked text-fg-dim">
										USER
									</TableHead>
									<TableHead className="h-8 px-2 text-left text-[10px] tracked text-fg-dim">
										PLATFORM
									</TableHead>
									<TableHead className="h-8 px-2 text-right text-[10px] tracked text-fg-dim">
										DAILY $
									</TableHead>
									<TableHead className="h-8 px-2 text-left text-[10px] tracked text-fg-dim">
										STATE
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{userOverrides.map((t) => (
									<TableRow key={t.id}>
										<TableCell className="px-2 py-2 text-fg">{t.email}</TableCell>
										<TableCell className="px-2 py-2 text-fg-mid">
											{platformLabel(t.platform)}
										</TableCell>
										<TableCell className="px-2 py-2 text-right text-amber">
											{formatCents(t.dailyCents)}
										</TableCell>
										<TableCell className="px-2 py-2 text-[10px] tracked">
											<span className={t.enabled ? "text-mint" : "text-fg-dim"}>
												● {t.enabled ? "armed" : "disabled"}
											</span>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				) : null}
			</section>

			{/* Manual sync */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line flex items-center justify-between">
					<span className="text-[11px] tracked text-fg">MANUAL SYNC</span>
					<span className="text-[10px] tracked text-fg-dim">RUNS IN THE BACKGROUND</span>
				</div>
				<div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
					{(
						[
							["anthropic", "ANTHROPIC", "Pulls last 30 days. 365 if no data yet.", true],
							["cursor", "CURSOR", "Pulls last 30 days. 365 if no data yet.", true],
							["alerts", "ALERTS", "Recompute threshold breaches", false],
							["slack_digest", "SLACK", "Post daily digest now", false],
						] as const
					).map(([job, label, sub, full]) => (
						<button
							key={job}
							type="button"
							onClick={() => triggerSync.mutate({ job, full })}
							className="text-left border border-line p-3 hover:border-amber hover:bg-amber/[0.04] transition-colors"
						>
							<div className="text-[10px] tracked text-fg-dim">▶ RUN</div>
							<div className="font-mono text-sm tracked text-fg mt-1">{label}</div>
							<div className="text-[10px] text-fg-very-dim mt-1">{sub}</div>
						</button>
					))}
				</div>
			</section>

			{/* Sync runs */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line">
					<span className="text-[11px] tracked text-fg">RECENT SYNC RUNS</span>
				</div>
				<Table className="w-full tabular text-xs">
					<TableHeader>
						<TableRow>
							<TableHead className="h-8 px-3 text-left text-[10px] tracked text-fg-dim">
								JOB
							</TableHead>
							<TableHead className="h-8 px-3 text-left text-[10px] tracked text-fg-dim">
								STATUS
							</TableHead>
							<TableHead className="h-8 px-3 text-left text-[10px] tracked text-fg-dim">
								TRIGGER
							</TableHead>
							<TableHead className="h-8 px-3 text-left text-[10px] tracked text-fg-dim">
								STARTED
							</TableHead>
							<TableHead className="h-8 px-3 text-right text-[10px] tracked text-fg-dim">
								ROWS
							</TableHead>
							<TableHead className="h-8 px-3 text-left text-[10px] tracked text-fg-dim">
								NOTE
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{runs.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-fg-dim py-6 text-xs">
									── no runs ──
								</TableCell>
							</TableRow>
						) : (
							runs.map((r) => (
								<TableRow key={r.id}>
									<TableCell className="px-3 py-2 text-fg">{r.job}</TableCell>
									<TableCell className="px-3 py-2">
										<span className={`text-[10px] tracked ${STATUS_COLOR[r.status]}`}>
											● {r.status}
										</span>
									</TableCell>
									<TableCell className="px-3 py-2 text-fg-mid text-[10px] tracked">
										{r.triggeredBy ?? "—"}
									</TableCell>
									<TableCell className="px-3 py-2 text-fg-dim text-[11px]">
										{formatDate(r.startedAt)}
									</TableCell>
									<TableCell className="px-3 py-2 text-right text-fg">
										{r.rowsUpserted.toLocaleString()}
									</TableCell>
									<TableCell className="px-3 py-2 text-amber-hot text-[11px] truncate max-w-md">
										{r.error ?? ""}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</section>
		</div>
	)
}
