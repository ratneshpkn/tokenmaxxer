import type { AdminConfigPatch } from "@shared/api-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Edit2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
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

type ValidationState = "idle" | "checking" | "ok" | "bad"

function useDebouncedValidation(
	value: string,
	provider: "anthropic" | "cursor" | "slack",
	slackChannel?: string,
	delay = 500,
): { state: ValidationState; error: string | null } {
	const [state, setState] = useState<ValidationState>("idle")
	const [error, setError] = useState<string | null>(null)
	const acRef = useRef<AbortController | null>(null)
	const lastFingerprintRef = useRef<string>("")

	useEffect(() => {
		const fp = value.slice(-4)
		if (!value || value.length < 8) {
			setState("idle")
			setError(null)
			return
		}
		if (fp === lastFingerprintRef.current) return
		setState("checking")
		setError(null)

		const t = setTimeout(async () => {
			acRef.current?.abort()
			const ac = new AbortController()
			acRef.current = ac
			try {
				const body: Record<string, string> = { provider, key: value }
				if (provider === "slack" && slackChannel) {
					body.channelId = slackChannel
				}
				const r = await fetch("/api/setup/validate-key", {
					method: "POST",
					headers: { "content-type": "application/json" },
					credentials: "include",
					body: JSON.stringify(body),
					signal: ac.signal,
				})
				const res = await r.json()
				if (ac.signal.aborted) return
				if (res.ok) {
					setState("ok")
					setError(null)
					lastFingerprintRef.current = fp
				} else {
					setState("bad")
					setError(res.error ?? "Invalid")
				}
			} catch (err) {
				if (ac.signal.aborted) return
				setState("bad")
				setError(err instanceof Error ? err.message : String(err))
			}
		}, delay)

		return () => clearTimeout(t)
	}, [value, provider, slackChannel, delay])

	return { state, error }
}

function StatusPip({ state }: { state: ValidationState }): React.JSX.Element | null {
	if (state === "idle") return null
	if (state === "checking")
		return <span className="text-[10px] tracked text-fg-dim">⏳ CHECKING…</span>
	if (state === "ok") return <span className="text-[10px] tracked text-mint">✓ VALID</span>
	return <span className="text-[10px] tracked text-amber-hot">✗ INVALID</span>
}

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
	const { data: adminCfg } = useQuery({
		queryKey: ["admin.config"],
		queryFn: api.adminConfig,
	})
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

	// Edit mode state
	const [editingSection, setEditingSection] = useState<"org" | "oauth" | "creds" | null>(null)

	// Admin configuration form state
	const [orgName, setOrgName] = useState("")
	const [allowedDomain, setAllowedDomain] = useState("")
	const [openSignup, setOpenSignup] = useState(false)
	const [googleOauthEnabled, setGoogleOauthEnabled] = useState(false)
	const [googleClientId, setGoogleClientId] = useState("")
	const [googleClientSecret, setGoogleClientSecret] = useState("")
	const [googleOauthRedirectUri, setGoogleOauthRedirectUri] = useState("")
	const [anthropicKey, setAnthropicKey] = useState("")
	const [cursorKey, setCursorKey] = useState("")
	const [slackToken, setSlackToken] = useState("")
	const [slackChannel, setSlackChannel] = useState("")

	const [clearSlackToken, setClearSlackToken] = useState(false)
	const [clearGoogleSecret, setClearGoogleSecret] = useState(false)

	const hasInitialized = useRef(false)

	useEffect(() => {
		if (adminCfg && !hasInitialized.current) {
			setOrgName(adminCfg.orgName || "")
			setAllowedDomain(adminCfg.allowedEmailDomain || "")
			setOpenSignup(adminCfg.openSignupEnabled || false)
			setGoogleOauthEnabled(adminCfg.googleOauthEnabled || false)
			setGoogleClientId(adminCfg.googleClientId || "")
			setGoogleClientSecret("")
			setGoogleOauthRedirectUri(adminCfg.googleOauthRedirectUri || "")
			setAnthropicKey("")
			setCursorKey("")
			setSlackToken("")
			setSlackChannel(adminCfg.slackChannelId || "")
			setClearSlackToken(false)
			setClearGoogleSecret(false)
			hasInitialized.current = true
		}
	}, [adminCfg])

	// Debounced key validations
	const anthropicVal = useDebouncedValidation(anthropicKey, "anthropic")
	const cursorVal = useDebouncedValidation(cursorKey, "cursor")
	const slackVal = useDebouncedValidation(slackToken, "slack", slackChannel || undefined)

	const handleCancel = (section: "org" | "oauth" | "creds") => {
		if (adminCfg) {
			if (section === "org") {
				setOrgName(adminCfg.orgName || "")
				setAllowedDomain(adminCfg.allowedEmailDomain || "")
				setOpenSignup(adminCfg.openSignupEnabled || false)
			} else if (section === "oauth") {
				setGoogleOauthEnabled(adminCfg.googleOauthEnabled || false)
				setGoogleClientId(adminCfg.googleClientId || "")
				setGoogleClientSecret("")
				setGoogleOauthRedirectUri(adminCfg.googleOauthRedirectUri || "")
				setClearGoogleSecret(false)
			} else if (section === "creds") {
				setAnthropicKey("")
				setCursorKey("")
				setSlackToken("")
				setSlackChannel(adminCfg.slackChannelId || "")
				setClearSlackToken(false)
			}
		}
		setEditingSection(null)
	}

	const updateConfig = useMutation({
		mutationFn: async (section: "org" | "oauth" | "creds") => {
			const payload: AdminConfigPatch = {}
			if (section === "org") {
				if (orgName !== adminCfg?.orgName) payload.orgName = orgName
				if (allowedDomain !== (adminCfg?.allowedEmailDomain || "")) {
					payload.allowedEmailDomain = allowedDomain.trim() || null
				}
				if (openSignup !== adminCfg?.openSignupEnabled) {
					payload.openSignupEnabled = openSignup
				}
			} else if (section === "oauth") {
				if (googleOauthEnabled !== adminCfg?.googleOauthEnabled) {
					payload.googleOauthEnabled = googleOauthEnabled
				}
				if (googleClientId !== (adminCfg?.googleClientId || "")) {
					payload.googleClientId = googleClientId.trim() || null
				}
				if (googleOauthRedirectUri !== (adminCfg?.googleOauthRedirectUri || "")) {
					payload.googleOauthRedirectUri = googleOauthRedirectUri.trim() || null
				}
				if (clearGoogleSecret) {
					payload.googleClientSecret = ""
				} else if (googleClientSecret) {
					payload.googleClientSecret = googleClientSecret
				}
			} else if (section === "creds") {
				if (anthropicKey) payload.anthropicAdminApiKey = anthropicKey
				if (cursorKey) payload.cursorAdminApiKey = cursorKey
				if (clearSlackToken) {
					payload.slackBotToken = ""
				} else if (slackToken) {
					payload.slackBotToken = slackToken
				}
				if (slackChannel !== (adminCfg?.slackChannelId || "")) {
					payload.slackChannelId = slackChannel.trim() || null
				}
			}

			return api.updateAdminConfig(payload)
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["admin.config"] })
			qc.invalidateQueries({ queryKey: ["config"] })
			alert("Workspace configuration updated successfully.")
			setAnthropicKey("")
			setCursorKey("")
			setSlackToken("")
			setGoogleClientSecret("")
			setClearSlackToken(false)
			setClearGoogleSecret(false)
			setEditingSection(null)
		},
		onError: (err: Error) => {
			alert(`Failed to update configuration:\n${err.message}`)
		},
	})

	return (
		<div className="space-y-8 fade-rise">
			{/* Workspace Configuration */}
			<section className="panel">
				<div className="px-5 py-3 border-b border-line flex justify-between items-center">
					<span className="text-[11px] tracked text-fg">WORKSPACE CONFIGURATION</span>
					{updateConfig.isPending && (
						<span className="text-[10px] tracked text-amber">⏳ SAVING CHANGES…</span>
					)}
				</div>
				<div className="p-5 space-y-6">
					{/* Section 1: Org Details */}
					<div>
						<div className="flex justify-between items-center mb-3">
							<div className="text-[10px] tracked text-amber">/ 01 · ORGANIZATION</div>
							{editingSection === null && (
								<button
									type="button"
									onClick={() => setEditingSection("org")}
									className="flex items-center gap-1.5 text-[9px] tracked text-fg-dim hover:text-amber cursor-pointer transition-colors border-none bg-transparent outline-none"
									title="Edit Organization Details"
								>
									<Edit2 className="h-2.5 w-2.5" strokeWidth={1.5} />
									EDIT
								</button>
							)}
						</div>

						{editingSection !== "org" ? (
							/* Read-Only Org Details */
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<Label className="text-[10px] tracked text-fg-dim">ORG NAME</Label>
									<p className="mt-1 text-fg text-sm">{adminCfg?.orgName || "—"}</p>
								</div>
								<div>
									<Label className="text-[10px] tracked text-fg-dim">ALLOWED EMAIL DOMAIN</Label>
									<p className="mt-1 text-fg text-sm">{adminCfg?.allowedEmailDomain || "Any"}</p>
								</div>
								<div>
									<Label className="text-[10px] tracked text-fg-dim">SELF-SIGNUP</Label>
									<p className="mt-1 text-fg text-sm">
										{adminCfg?.openSignupEnabled ? "Enabled (domain-gated)" : "Invite-only"}
									</p>
								</div>
							</div>
						) : (
							/* Edit Org Details */
							<div className="space-y-4">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<Label htmlFor="orgName" className="text-[10px] tracked text-fg-dim">
											ORG NAME
										</Label>
										<Input
											id="orgName"
											value={orgName}
											onChange={(e) => setOrgName(e.target.value)}
											placeholder="Acme Corp"
											className="mt-1"
										/>
									</div>
									<div>
										<Label htmlFor="domain" className="text-[10px] tracked text-fg-dim">
											ALLOWED EMAIL DOMAIN (OPTIONAL)
										</Label>
										<Input
											id="domain"
											value={allowedDomain}
											onChange={(e) => setAllowedDomain(e.target.value)}
											placeholder="acme.com"
											className="mt-1"
										/>
									</div>
									<div>
										<Label className="text-[10px] tracked text-fg-dim">SELF-SIGNUP</Label>
										<label className="mt-2 flex items-center gap-2 text-[11px] text-fg-mid select-none cursor-pointer">
											<input
												type="checkbox"
												checked={openSignup}
												onChange={(e) => setOpenSignup(e.target.checked)}
											/>
											<span>
												Allow self-signup for{" "}
												{allowedDomain ? `@${allowedDomain}` : "the allowed domain"} addresses
											</span>
										</label>
									</div>
								</div>
								<div className="flex justify-end gap-2 pt-2">
									<button
										type="button"
										onClick={() => handleCancel("org")}
										className="text-xs px-3 h-7 text-fg-dim hover:text-fg border border-line hover:border-line-strong transition-colors cursor-pointer bg-transparent"
									>
										CANCEL
									</button>
									<Button
										onClick={() => updateConfig.mutate("org")}
										disabled={updateConfig.isPending || orgName.trim().length === 0}
										className="h-7 px-3 text-xs"
									>
										SAVE
									</Button>
								</div>
							</div>
						)}
					</div>

					<hr className="border-line" />

					{/* Section 2: Google OAuth */}
					<div>
						<div className="flex justify-between items-center mb-3">
							<div className="text-[10px] tracked text-amber">/ 02 · GOOGLE OAUTH</div>
							{editingSection === null && (
								<button
									type="button"
									onClick={() => setEditingSection("oauth")}
									className="flex items-center gap-1.5 text-[9px] tracked text-fg-dim hover:text-amber cursor-pointer transition-colors border-none bg-transparent outline-none"
									title="Edit Google OAuth Configuration"
								>
									<Edit2 className="h-2.5 w-2.5" strokeWidth={1.5} />
									EDIT
								</button>
							)}
						</div>

						{editingSection !== "oauth" ? (
							/* Read-Only Google OAuth */
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<Label className="text-[10px] tracked text-fg-dim">STATUS</Label>
									<p className="mt-1 text-fg text-sm">
										{adminCfg?.googleOauthEnabled ? "Enabled" : "Disabled"}
									</p>
								</div>
								{adminCfg?.googleOauthEnabled && (
									<>
										<div>
											<Label className="text-[10px] tracked text-fg-dim">CLIENT ID</Label>
											<p className="mt-1 text-fg text-sm font-mono truncate max-w-xs">
												{adminCfg?.googleClientId || "—"}
											</p>
										</div>
										<div>
											<Label className="text-[10px] tracked text-fg-dim">CLIENT SECRET</Label>
											<p className="mt-1 text-fg text-sm font-mono">
												{adminCfg?.googleClientSecretSet
													? "•••••••••••• (configured)"
													: "Not configured"}
											</p>
										</div>
										<div>
											<Label className="text-[10px] tracked text-fg-dim">REDIRECT URI</Label>
											<p className="mt-1 text-fg text-sm font-mono truncate max-w-xs">
												{adminCfg?.googleOauthRedirectUri || "—"}
											</p>
										</div>
									</>
								)}
							</div>
						) : (
							/* Edit Google OAuth */
							<div className="space-y-4">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<Label className="text-[10px] tracked text-fg-dim">STATUS</Label>
										<label className="mt-2 flex items-center gap-2 text-[11px] text-fg-mid select-none cursor-pointer">
											<input
												type="checkbox"
												checked={googleOauthEnabled}
												onChange={(e) => setGoogleOauthEnabled(e.target.checked)}
											/>
											<span>Enable Google OAuth login</span>
										</label>
									</div>

									{googleOauthEnabled && (
										<>
											<div>
												<Label htmlFor="googleClientId" className="text-[10px] tracked text-fg-dim">
													GOOGLE CLIENT ID
												</Label>
												<Input
													id="googleClientId"
													value={googleClientId}
													onChange={(e) => setGoogleClientId(e.target.value)}
													placeholder="12345678-abc.apps.googleusercontent.com"
													className="mt-1"
												/>
											</div>
											<div>
												<div className="flex items-center justify-between mb-1">
													<Label
														htmlFor="googleClientSecret"
														className="text-[10px] tracked text-fg-dim"
													>
														GOOGLE CLIENT SECRET
													</Label>
													<div className="flex items-center gap-2">
														{adminCfg?.googleClientSecretSet && !clearGoogleSecret && (
															<button
																type="button"
																onClick={() => setClearGoogleSecret(true)}
																className="text-[9px] text-fg-dim hover:text-amber-hot uppercase tracking-wider cursor-pointer font-mono border-none bg-transparent outline-none"
															>
																[Clear Secret]
															</button>
														)}
														{clearGoogleSecret && (
															<button
																type="button"
																onClick={() => setClearGoogleSecret(false)}
																className="text-[9px] text-mint uppercase tracking-wider cursor-pointer font-mono border-none bg-transparent outline-none"
															>
																[Undo Clear]
															</button>
														)}
													</div>
												</div>
												<Input
													id="googleClientSecret"
													value={googleClientSecret}
													onChange={(e) => {
														setGoogleClientSecret(e.target.value)
														if (clearGoogleSecret) setClearGoogleSecret(false)
													}}
													placeholder={
														clearGoogleSecret
															? "Cleared (will save on Save)"
															: adminCfg?.googleClientSecretSet
																? "•••••••••••• (configured)"
																: "Enter client secret"
													}
													type="password"
													disabled={clearGoogleSecret}
												/>
											</div>
											<div>
												<Label
													htmlFor="googleOauthRedirectUri"
													className="text-[10px] tracked text-fg-dim"
												>
													REDIRECT URI
												</Label>
												<Input
													id="googleOauthRedirectUri"
													value={googleOauthRedirectUri}
													onChange={(e) => setGoogleOauthRedirectUri(e.target.value)}
													placeholder="https://your-domain.com/api/auth/google/callback"
													className="mt-1"
												/>
											</div>
										</>
									)}
								</div>
								<div className="flex justify-end gap-2 pt-2">
									<button
										type="button"
										onClick={() => handleCancel("oauth")}
										className="text-xs px-3 h-7 text-fg-dim hover:text-fg border border-line hover:border-line-strong transition-colors cursor-pointer bg-transparent"
									>
										CANCEL
									</button>
									<Button
										onClick={() => updateConfig.mutate("oauth")}
										disabled={updateConfig.isPending}
										className="h-7 px-3 text-xs"
									>
										SAVE
									</Button>
								</div>
							</div>
						)}
					</div>

					<hr className="border-line" />

					{/* Section 3: Credentials & API Keys */}
					<div>
						<div className="flex justify-between items-center mb-3">
							<div className="text-[10px] tracked text-amber">/ 03 · CREDENTIALS & API KEYS</div>
							{editingSection === null && (
								<button
									type="button"
									onClick={() => setEditingSection("creds")}
									className="flex items-center gap-1.5 text-[9px] tracked text-fg-dim hover:text-amber cursor-pointer transition-colors border-none bg-transparent outline-none"
									title="Edit Credentials & API Keys"
								>
									<Edit2 className="h-2.5 w-2.5" strokeWidth={1.5} />
									EDIT
								</button>
							)}
						</div>

						{editingSection !== "creds" ? (
							/* Read-Only Credentials & API Keys */
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<Label className="text-[10px] tracked text-fg-dim">ANTHROPIC ADMIN API KEY</Label>
									<p className="mt-1 text-fg text-sm font-mono">
										{adminCfg?.anthropicAdminApiKeySet
											? "•••••••••••• (configured)"
											: "Not configured"}
									</p>
								</div>
								<div>
									<Label className="text-[10px] tracked text-fg-dim">CURSOR ADMIN API KEY</Label>
									<p className="mt-1 text-fg text-sm font-mono">
										{adminCfg?.cursorAdminApiKeySet
											? "•••••••••••• (configured)"
											: "Not configured"}
									</p>
								</div>
								<div>
									<Label className="text-[10px] tracked text-fg-dim">SLACK BOT TOKEN</Label>
									<p className="mt-1 text-fg text-sm font-mono">
										{adminCfg?.slackBotTokenSet ? "•••••••••••• (configured)" : "Not configured"}
									</p>
								</div>
								<div>
									<Label className="text-[10px] tracked text-fg-dim">SLACK CHANNEL ID</Label>
									<p className="mt-1 text-fg text-sm font-mono">
										{adminCfg?.slackChannelId || "—"}
									</p>
								</div>
							</div>
						) : (
							/* Edit Credentials & API Keys */
							<div className="space-y-4">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<div className="flex items-center justify-between mb-1">
											<Label htmlFor="anthropic" className="text-[10px] tracked text-fg-dim">
												ANTHROPIC ADMIN API KEY
											</Label>
											<StatusPip state={anthropicVal.state} />
										</div>
										<Input
											id="anthropic"
											value={anthropicKey}
											onChange={(e) => setAnthropicKey(e.target.value)}
											placeholder={
												adminCfg?.anthropicAdminApiKeySet
													? "•••••••••••• (configured)"
													: "Enter Anthropic admin key"
											}
											type="password"
										/>
										{anthropicVal.error ? (
											<p className="text-[10px] text-amber-hot mt-1">{anthropicVal.error}</p>
										) : null}
									</div>

									<div>
										<div className="flex items-center justify-between mb-1">
											<Label htmlFor="cursor" className="text-[10px] tracked text-fg-dim">
												CURSOR ADMIN API KEY
											</Label>
											<StatusPip state={cursorVal.state} />
										</div>
										<Input
											id="cursor"
											value={cursorKey}
											onChange={(e) => setCursorKey(e.target.value)}
											placeholder={
												adminCfg?.cursorAdminApiKeySet
													? "•••••••••••• (configured)"
													: "Enter Cursor admin key"
											}
											type="password"
										/>
										{cursorVal.error ? (
											<p className="text-[10px] text-amber-hot mt-1">{cursorVal.error}</p>
										) : null}
									</div>

									<div>
										<div className="flex items-center justify-between mb-1">
											<Label htmlFor="slackToken" className="text-[10px] tracked text-fg-dim">
												SLACK BOT TOKEN
											</Label>
											<div className="flex items-center gap-2">
												{adminCfg?.slackBotTokenSet && !clearSlackToken && (
													<button
														type="button"
														onClick={() => setClearSlackToken(true)}
														className="text-[9px] text-fg-dim hover:text-amber-hot uppercase tracking-wider cursor-pointer font-mono border-none bg-transparent outline-none"
													>
														[Clear Token]
													</button>
												)}
												{clearSlackToken && (
													<button
														type="button"
														onClick={() => setClearSlackToken(false)}
														className="text-[9px] text-mint uppercase tracking-wider cursor-pointer font-mono border-none bg-transparent outline-none"
													>
														[Undo Clear]
													</button>
												)}
												<StatusPip state={slackVal.state} />
											</div>
										</div>
										<Input
											id="slackToken"
											value={slackToken}
											onChange={(e) => {
												setSlackToken(e.target.value)
												if (clearSlackToken) setClearSlackToken(false)
											}}
											placeholder={
												clearSlackToken
													? "Cleared (will save on Save)"
													: adminCfg?.slackBotTokenSet
														? "•••••••••••• (configured)"
														: "xoxb-..."
											}
											type="password"
											disabled={clearSlackToken}
										/>
										{slackVal.error ? (
											<p className="text-[10px] text-amber-hot mt-1">{slackVal.error}</p>
										) : null}
									</div>

									<div>
										<Label htmlFor="slackChannel" className="text-[10px] tracked text-fg-dim">
											SLACK CHANNEL ID
										</Label>
										<Input
											id="slackChannel"
											value={slackChannel}
											onChange={(e) => setSlackChannel(e.target.value)}
											placeholder="C0XXXXXXX"
											className="mt-1"
										/>
									</div>
								</div>
								<div className="flex justify-end gap-2 pt-2">
									<button
										type="button"
										onClick={() => handleCancel("creds")}
										className="text-xs px-3 h-7 text-fg-dim hover:text-fg border border-line hover:border-line-strong transition-colors cursor-pointer bg-transparent"
									>
										CANCEL
									</button>
									<Button
										onClick={() => updateConfig.mutate("creds")}
										disabled={
											updateConfig.isPending ||
											anthropicVal.state === "checking" ||
											anthropicVal.state === "bad" ||
											cursorVal.state === "checking" ||
											cursorVal.state === "bad" ||
											slackVal.state === "checking" ||
											slackVal.state === "bad"
										}
										className="h-7 px-3 text-xs"
									>
										SAVE
									</Button>
								</div>
							</div>
						)}
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
