import type { TeamItem, UpdateTeamPayload, UserListItem } from "@shared/api-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useRef, useState } from "react"
import { SectionHeader } from "@/components/SectionHeader"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
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
import { toast } from "@/components/ui/toast"
import { Typography } from "@/components/ui/typography"
import { api } from "@/lib/api"

export function TeamsSection(): React.JSX.Element {
	const qc = useQueryClient()
	const [createTeamOpen, setCreateTeamOpen] = useState(false)
	const [editingTeam, setEditingTeam] = useState<TeamItem | null>(null)
	const [teamName, setTeamName] = useState("")
	const [teamDesc, setTeamDesc] = useState("")
	const [teamMemberEmails, setTeamMemberEmails] = useState<string[]>([])
	const [teamError, setTeamError] = useState<string | null>(null)
	const [loadingMembers, setLoadingMembers] = useState(false)
	const activeTeamIdRef = useRef<string | null>(null)

	const { data: teamsData } = useQuery({
		queryKey: ["teams"],
		queryFn: () => api.teams.list(),
	})
	const { data: usersData } = useQuery({
		queryKey: ["users"],
		queryFn: () => api.users.list(),
	})
	const teams = teamsData?.teams ?? []
	const trackedUsersList = usersData ?? []

	const invalidateTeams = () => {
		qc.invalidateQueries({ queryKey: ["teams"] })
		qc.invalidateQueries({ queryKey: ["users.list"] })
		qc.invalidateQueries({ queryKey: ["users"] })
	}

	const createTeamMut = useMutation({
		mutationFn: (payload: { name: string; description?: string; memberEmails: string[] }) =>
			api.teams.create(payload),
		onSuccess: () => {
			invalidateTeams()
			toast.success("Team created successfully.")
			setCreateTeamOpen(false)
			resetTeamForm()
		},
		onError: (err: Error) => {
			setTeamError(
				err.message.includes("400") ? "A team with this name already exists" : err.message,
			)
		},
	})

	const updateTeamMut = useMutation({
		mutationFn: ({ id, payload }: { id: string; payload: UpdateTeamPayload }) =>
			api.teams.update(id, payload),
		onSuccess: () => {
			invalidateTeams()
			toast.success("Team updated successfully.")
			setEditingTeam(null)
			resetTeamForm()
		},
		onError: (err: Error) => {
			setTeamError(
				err.message.includes("400") ? "A team with this name already exists" : err.message,
			)
		},
	})

	const deleteTeamMut = useMutation({
		mutationFn: (id: string) => api.teams.delete(id),
		onSuccess: () => {
			invalidateTeams()
			toast.success("Team deleted successfully.")
		},
	})

	function resetTeamForm(): void {
		activeTeamIdRef.current = null
		setLoadingMembers(false)
		setTeamName("")
		setTeamDesc("")
		setTeamMemberEmails([])
		setTeamError(null)
	}

	async function openEditTeam(t: TeamItem): Promise<void> {
		activeTeamIdRef.current = t.id
		setEditingTeam(t)
		setTeamName(t.name)
		setTeamDesc(t.description ?? "")
		setTeamMemberEmails([])
		setTeamError(null)
		setLoadingMembers(true)
		try {
			const detail = await api.teams.get(t.id)
			if (activeTeamIdRef.current !== t.id) return
			setTeamMemberEmails(detail.members.map((m) => m.email))
		} catch {
			if (activeTeamIdRef.current !== t.id) return
			setTeamMemberEmails([])
		} finally {
			if (activeTeamIdRef.current === t.id) setLoadingMembers(false)
		}
	}

	function handleTeamSubmit(): void {
		if (!teamName.trim()) {
			setTeamError("Team name is required")
			return
		}
		const payload = {
			name: teamName.trim(),
			description: teamDesc.trim() || undefined,
			memberEmails: teamMemberEmails,
		}
		if (editingTeam) {
			updateTeamMut.mutate({ id: editingTeam.id, payload })
		} else {
			createTeamMut.mutate(payload)
		}
	}

	function toggleTeamMemberEmail(email: string): void {
		setTeamMemberEmails((prev) =>
			prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
		)
	}

	return (
		<>
			<Card className="overflow-hidden border border-line">
				<SectionHeader
					title="TEAMS & PODS"
					subtitle={`${teams.length} TEAM${teams.length === 1 ? "" : "S"} CONFIGURED`}
					action={
						<Button
							onClick={() => {
								resetTeamForm()
								setCreateTeamOpen(true)
							}}
							variant="outline"
							size="sm"
							className="h-7 text-xs font-mono gap-1.5"
						>
							<Plus className="size-3.5" />
							CREATE TEAM
						</Button>
					}
				/>
				{teams.length === 0 ? (
					<div className="p-6 text-center text-xs text-fg-muted font-mono">
						── no teams configured · create your first team to group engineers ──
					</div>
				) : (
					<Table className="w-full tabular text-xs table-fixed">
						<TableHeader className="border-b border-line bg-elev2/40">
							<TableRow>
								<TableHead className="w-48 px-5">TEAM NAME</TableHead>
								<TableHead className="px-5">DESCRIPTION</TableHead>
								<TableHead className="w-28 px-5 text-right">MEMBERS</TableHead>
								<TableHead className="w-28 px-5 text-right">ACTIONS</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{teams.map((t) => (
								<TableRow key={t.id} className="border-line hover:bg-elev1">
									<TableCell className="px-5 py-3 font-mono font-medium text-fg">
										{t.name}
									</TableCell>
									<TableCell className="px-5 py-3 text-fg-subtle truncate">
										{t.description || "—"}
									</TableCell>
									<TableCell className="px-5 py-3 text-right font-mono text-fg">
										{t.memberCount}
									</TableCell>
									<TableCell className="px-5 py-3 text-right">
										<div className="flex items-center justify-end gap-1">
											<Button
												variant="ghost"
												size="xs"
												onClick={() => openEditTeam(t)}
												className="h-7 w-7 p-0"
											>
												<Pencil className="size-3" />
											</Button>
											<Button
												variant="ghost"
												size="xs"
												onClick={() => {
													if (confirm(`Delete team "${t.name}"?`)) {
														deleteTeamMut.mutate(t.id)
													}
												}}
												className="h-7 w-7 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
											>
												<Trash2 className="size-3" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</Card>

			<Dialog
				open={createTeamOpen || !!editingTeam}
				onOpenChange={(open) => {
					if (!open) {
						setCreateTeamOpen(false)
						setEditingTeam(null)
						resetTeamForm()
					}
				}}
			>
				<DialogContent className="sm:max-w-md bg-bg border-line">
					<DialogHeader>
						<DialogTitle className="text-lg font-mono font-bold text-fg">
							{editingTeam ? "EDIT TEAM" : "CREATE NEW TEAM"}
						</DialogTitle>
						<DialogDescription className="text-xs text-fg-muted">
							Configure team details and assign tracked engineers.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-2">
						{teamError ? (
							<div className="p-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-mono rounded">
								{teamError}
							</div>
						) : null}

						<div className="space-y-1.5">
							<Label className="text-xs font-mono">TEAM NAME *</Label>
							<Input
								placeholder="e.g. Platform, Mobile, Growth"
								value={teamName}
								onChange={(e) => setTeamName(e.target.value)}
								className="h-9 text-xs font-mono bg-bg border-line"
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs font-mono">DESCRIPTION</Label>
							<Input
								placeholder="Optional team scope or charter..."
								value={teamDesc}
								onChange={(e) => setTeamDesc(e.target.value)}
								className="h-9 text-xs font-mono bg-bg border-line"
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs font-mono">
								ASSIGN MEMBERS ({teamMemberEmails.length})
							</Label>
							<div className="max-h-48 overflow-y-auto border border-line rounded p-2 space-y-1 bg-elev1">
								{trackedUsersList.length === 0 ? (
									<Typography
										variant="subtle"
										className="tabular text-fg-subtle block p-4 text-center"
									>
										── no tracked users found ──
									</Typography>
								) : (
									trackedUsersList.map((u: UserListItem) => {
										const checked = teamMemberEmails.includes(u.email)
										return (
											<div
												key={u.email}
												className="flex items-center justify-between p-1.5 hover:bg-elev2 rounded text-xs font-mono"
											>
												<div className="flex items-center gap-2 truncate">
													<Checkbox
														id={`team-chk-${u.email}`}
														checked={checked}
														onCheckedChange={() => toggleTeamMemberEmail(u.email)}
													/>
													<label
														htmlFor={`team-chk-${u.email}`}
														className="text-fg font-medium truncate cursor-pointer"
													>
														{u.name || u.email.split("@")[0]}
													</label>
													<span className="text-fg-subtle text-[10px] truncate">({u.email})</span>
												</div>
											</div>
										)
									})
								)}
							</div>
						</div>
					</div>

					<DialogFooter>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setCreateTeamOpen(false)
								setEditingTeam(null)
								resetTeamForm()
							}}
							className="text-xs font-mono"
						>
							CANCEL
						</Button>
						<Button
							size="sm"
							onClick={handleTeamSubmit}
							disabled={loadingMembers || createTeamMut.isPending || updateTeamMut.isPending}
							className="text-xs font-mono"
						>
							{editingTeam ? "SAVE CHANGES" : "CREATE TEAM"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
