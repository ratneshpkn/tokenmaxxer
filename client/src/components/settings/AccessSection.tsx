import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { SectionHeader } from "@/components/SectionHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { useMe } from "@/lib/display-session"

export function AccessSection(): React.JSX.Element {
	const qc = useQueryClient()
	const { data: me } = useMe()
	const { data: appUsers = [] } = useQuery({ queryKey: ["appUsers"], queryFn: api.appUsers.list })
	const { data: invites = [] } = useQuery({
		queryKey: ["invitations"],
		queryFn: api.invitations.list,
	})

	const [inviteEmail, setInviteEmail] = useState("")
	const [inviteRole, setInviteRole] = useState<"viewer" | "admin">("viewer")

	const createInvite = useMutation({
		mutationFn: ({ email, role }: { email: string; role: "viewer" | "admin" }) =>
			api.invitations.create(email, role),
		onSuccess: (res) => {
			navigator.clipboard?.writeText(res.url)
			qc.invalidateQueries({ queryKey: ["invitations"] })
			toast.success(`Invite link copied to clipboard: ${res.url}`, "Invite Link Created")
		},
	})

	const deleteInviteMut = useMutation({
		mutationFn: (id: string) => api.invitations.delete(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
	})

	const updateRoleMut = useMutation({
		mutationFn: ({ id, role }: { id: string; role: "viewer" | "admin" }) =>
			api.appUsers.updateRole(id, role),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["appUsers"] }),
		onError: (err: Error) => toast.error(err.message, "Failed to update role"),
	})

	return (
		<>
			<Card>
				<SectionHeader
					title="ACTIVE ACCOUNTS"
					action={
						<span className="text-[10px] tracked text-fg-muted">
							{appUsers.length} ACCOUNT{appUsers.length === 1 ? "" : "S"}
						</span>
					}
				/>
				<Table className="w-full tabular text-xs">
					<TableHeader>
						<TableRow>
							<TableHead className="px-5">USER</TableHead>
							<TableHead className="px-5 w-48">ROLE</TableHead>
							<TableHead className="px-5 text-right">JOINED</TableHead>
							<TableHead className="px-5 text-right">LAST LOGIN</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{appUsers.map((u) => (
							<TableRow key={u.id}>
								<TableCell className="px-5 py-3">
									<div className="text-fg">{u.name || "—"}</div>
									<div className="text-fg-muted text-xs">{u.email}</div>
								</TableCell>
								<TableCell className="px-5 py-3">
									{me?.role === "admin" && me?.id !== u.id ? (
										<Select
											value={u.role}
											onValueChange={(role) =>
												updateRoleMut.mutate({
													id: u.id,
													role: role as "viewer" | "admin",
												})
											}
											disabled={updateRoleMut.isPending}
										>
											<SelectTrigger className="w-32 h-8 bg-transparent border border-line text-fg text-xs">
												<SelectValue placeholder="Role" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="viewer">VIEWER</SelectItem>
												<SelectItem value="admin">ADMIN</SelectItem>
											</SelectContent>
										</Select>
									) : (
										<Badge variant="secondary" className="uppercase text-xs tracked font-mono">
											{u.role}
										</Badge>
									)}
								</TableCell>
								<TableCell className="px-5 py-3 text-right text-fg-muted">
									{new Date(u.createdAt).toLocaleDateString()}
								</TableCell>
								<TableCell className="px-5 py-3 text-right text-fg-muted">
									{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Card>

			<Card>
				<SectionHeader title="INVITATIONS" />
				<div className="p-5 space-y-4">
					<div className="flex gap-2 items-end">
						<div className="flex-1">
							<Label className="text-xs tracked text-fg-muted">EMAIL</Label>
							<Input
								value={inviteEmail}
								onChange={(e) => setInviteEmail(e.target.value)}
								placeholder="newperson@example.com"
								className="mt-1"
							/>
						</div>
						<div className="w-32">
							<Label className="text-xs tracked text-fg-muted">ROLE</Label>
							<Select
								value={inviteRole}
								onValueChange={(val) => setInviteRole(val as "viewer" | "admin")}
							>
								<SelectTrigger className="mt-1 w-full h-8">
									<SelectValue placeholder="Role" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="viewer">VIEWER</SelectItem>
									<SelectItem value="admin">ADMIN</SelectItem>
								</SelectContent>
							</Select>
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
									<TableHead className="px-2">EMAIL</TableHead>
									<TableHead className="px-2">ROLE</TableHead>
									<TableHead className="px-2">EXPIRES</TableHead>
									<TableHead className="px-2 text-right">ACTION</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{invites.map((i) => (
									<TableRow key={i.id}>
										<TableCell className="px-2 py-2 text-fg">{i.email}</TableCell>
										<TableCell className="px-2 py-2 text-fg-muted">{i.role}</TableCell>
										<TableCell className="px-2 py-2 text-fg-muted">
											{new Date(i.expiresAt).toLocaleDateString()}
										</TableCell>
										<TableCell className="px-2 py-2 text-right">
											<Button
												variant="destructive"
												size="xs"
												onClick={() => deleteInviteMut.mutate(i.id)}
											>
												REVOKE
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<p className="text-xs text-fg-muted">— no pending invitations —</p>
					)}
				</div>
			</Card>
		</>
	)
}
