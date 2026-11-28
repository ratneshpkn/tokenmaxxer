import type { AdminConfigPatch } from "@shared/api-types"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Edit2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
	useDebouncedKeyValidation,
	type ValidationState,
	ValidationStatusPip,
} from "@/components/KeyValidation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/display-session"
import { cn } from "@/lib/utils"

function SecretField({
	id,
	label,
	value,
	onChange,
	isSet,
	cleared,
	onClearChange,
	clearLabel = "Clear Token",
	unsetPlaceholder,
	validation,
	className,
}: {
	id: string
	label: string
	value: string
	onChange: (next: string) => void
	isSet?: boolean
	cleared: boolean
	onClearChange: (next: boolean) => void
	clearLabel?: string
	unsetPlaceholder: string
	validation?: { state: ValidationState; error: string | null }
	className?: string
}): React.JSX.Element {
	return (
		<div className={className}>
			<div className="flex items-center justify-between mb-1">
				<Label htmlFor={id} className="text-xs tracked text-fg-muted">
					{label}
				</Label>
				<div className="flex items-center gap-2">
					{isSet && !cleared && (
						<button
							type="button"
							onClick={() => {
								onClearChange(true)
								onChange("")
							}}
							className="text-[9px] text-fg-muted hover:text-amber-hot uppercase tracking-wider cursor-pointer font-mono border-none bg-transparent outline-none"
						>
							[{clearLabel}]
						</button>
					)}
					{cleared && (
						<button
							type="button"
							onClick={() => onClearChange(false)}
							className="text-[9px] text-mint uppercase tracking-wider cursor-pointer font-mono border-none bg-transparent outline-none"
						>
							[Undo Clear]
						</button>
					)}
					{validation ? <ValidationStatusPip state={validation.state} /> : null}
				</div>
			</div>
			<Input
				id={id}
				value={value}
				onChange={(e) => {
					onChange(e.target.value)
					if (cleared) onClearChange(false)
				}}
				placeholder={
					cleared
						? "Cleared (will save on Save)"
						: isSet
							? "•••••••••••• (configured)"
							: unsetPlaceholder
				}
				type="password"
				disabled={cleared}
			/>
			{validation?.error ? <p className="text-xs text-amber-hot mt-1">{validation.error}</p> : null}
		</div>
	)
}

export function WorkspaceConfigSection(): React.JSX.Element {
	const qc = useQueryClient()
	const { data: adminCfg } = useQuery({
		queryKey: ["admin.config"],
		queryFn: api.adminConfig,
	})

	const [editingSection, setEditingSection] = useState<"org" | "oauth" | "creds" | null>(null)

	const [orgName, setOrgName] = useState("")
	const [allowedDomain, setAllowedDomain] = useState("")
	const [openSignup, setOpenSignup] = useState(false)
	const [spendVisibility, setSpendVisibility] = useState<
		"admin_only" | "viewer_own" | "viewer_all"
	>("admin_only")
	const [googleOauthEnabled, setGoogleOauthEnabled] = useState(false)
	const [passwordAuthDisabled, setPasswordAuthDisabled] = useState(false)
	const [googleClientId, setGoogleClientId] = useState("")
	const [googleClientSecret, setGoogleClientSecret] = useState("")
	const [googleOauthRedirectUri, setGoogleOauthRedirectUri] = useState("")
	const [anthropicKey, setAnthropicKey] = useState("")
	const [cursorKey, setCursorKey] = useState("")
	const [slackToken, setSlackToken] = useState("")
	const [slackChannel, setSlackChannel] = useState("")
	const [githubToken, setGithubToken] = useState("")
	const [githubOrg, setGithubOrg] = useState("")

	const [enrichmentProvider, setEnrichmentProvider] = useState<
		"anthropic" | "openai" | "openai_compatible"
	>("anthropic")
	const [enrichmentApiKey, setEnrichmentApiKey] = useState("")
	const [enrichmentModelName, setEnrichmentModelName] = useState("")
	const [enrichmentBaseUrl, setEnrichmentBaseUrl] = useState("")

	const [clearSlackToken, setClearSlackToken] = useState(false)
	const [clearGithubToken, setClearGithubToken] = useState(false)
	const [clearGoogleSecret, setClearGoogleSecret] = useState(false)
	const [clearEnrichmentKey, setClearEnrichmentKey] = useState(false)

	const hasInitialized = useRef(false)

	useEffect(() => {
		if (adminCfg && !hasInitialized.current) {
			setOrgName(adminCfg.orgName || "")
			setAllowedDomain(adminCfg.allowedEmailDomain || "")
			setOpenSignup(adminCfg.openSignupEnabled || false)
			setSpendVisibility(adminCfg.spendVisibility || "admin_only")
			setGoogleOauthEnabled(adminCfg.googleOauthEnabled || false)
			setPasswordAuthDisabled(adminCfg.passwordAuthDisabled || false)
			setGoogleClientId(adminCfg.googleClientId || "")
			setGoogleClientSecret("")
			setGoogleOauthRedirectUri(adminCfg.googleOauthRedirectUri || "")
			setAnthropicKey("")
			setCursorKey("")
			setSlackToken("")
			setSlackChannel(adminCfg.slackChannelId || "")
			setGithubToken("")
			setGithubOrg(adminCfg.githubOrg || "")
			setEnrichmentProvider(adminCfg.enrichmentProvider || "anthropic")
			setEnrichmentApiKey("")
			setEnrichmentModelName(adminCfg.enrichmentModelName || "")
			setEnrichmentBaseUrl(adminCfg.enrichmentBaseUrl || "")
			setClearSlackToken(false)
			setClearGithubToken(false)
			setClearGoogleSecret(false)
			setClearEnrichmentKey(false)
			hasInitialized.current = true
		}
	}, [adminCfg])

	const anthropicVal = useDebouncedKeyValidation(anthropicKey, "anthropic")
	const cursorVal = useDebouncedKeyValidation(cursorKey, "cursor")
	const slackVal = useDebouncedKeyValidation(slackToken, "slack", slackChannel || undefined)
	const githubVal = useDebouncedKeyValidation(githubToken, "github", githubOrg || undefined)

	const handleCancel = (section: "org" | "oauth" | "creds") => {
		if (adminCfg) {
			if (section === "org") {
				setOrgName(adminCfg.orgName || "")
				setAllowedDomain(adminCfg.allowedEmailDomain || "")
				setOpenSignup(adminCfg.openSignupEnabled || false)
				setSpendVisibility(adminCfg.spendVisibility || "admin_only")
			} else if (section === "oauth") {
				setGoogleOauthEnabled(adminCfg.googleOauthEnabled || false)
				setPasswordAuthDisabled(adminCfg.passwordAuthDisabled || false)
				setGoogleClientId(adminCfg.googleClientId || "")
				setGoogleClientSecret("")
				setGoogleOauthRedirectUri(adminCfg.googleOauthRedirectUri || "")
				setClearGoogleSecret(false)
			} else if (section === "creds") {
				setAnthropicKey("")
				setCursorKey("")
				setSlackToken("")
				setSlackChannel(adminCfg.slackChannelId || "")
				setGithubToken("")
				setGithubOrg(adminCfg.githubOrg || "")
				setEnrichmentProvider(adminCfg.enrichmentProvider || "anthropic")
				setEnrichmentApiKey("")
				setEnrichmentModelName(adminCfg.enrichmentModelName || "")
				setEnrichmentBaseUrl(adminCfg.enrichmentBaseUrl || "")
				setClearSlackToken(false)
				setClearGithubToken(false)
				setClearEnrichmentKey(false)
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
				if (spendVisibility !== adminCfg?.spendVisibility) {
					payload.spendVisibility = spendVisibility
				}
			} else if (section === "oauth") {
				if (googleOauthEnabled !== adminCfg?.googleOauthEnabled) {
					payload.googleOauthEnabled = googleOauthEnabled
				}
				if (passwordAuthDisabled !== adminCfg?.passwordAuthDisabled) {
					payload.passwordAuthDisabled = passwordAuthDisabled
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
				if (clearGithubToken) {
					payload.githubAccessToken = ""
				} else if (githubToken) {
					payload.githubAccessToken = githubToken
				}
				if (githubOrg !== (adminCfg?.githubOrg || "")) {
					payload.githubOrg = githubOrg.trim() || null
				}
				if (enrichmentProvider !== adminCfg?.enrichmentProvider) {
					payload.enrichmentProvider = enrichmentProvider
				}
				if (clearEnrichmentKey) {
					payload.enrichmentApiKey = ""
				} else if (enrichmentApiKey) {
					payload.enrichmentApiKey = enrichmentApiKey
				}
				if (enrichmentModelName !== (adminCfg?.enrichmentModelName || "")) {
					payload.enrichmentModelName = enrichmentModelName.trim() || null
				}
				if (enrichmentBaseUrl !== (adminCfg?.enrichmentBaseUrl || "")) {
					payload.enrichmentBaseUrl = enrichmentBaseUrl.trim() || null
				}
			}

			return api.updateAdminConfig(payload)
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["admin.config"] })
			qc.invalidateQueries({ queryKey: queryKeys.config })
			toast.success("Workspace configuration updated successfully.")
			setAnthropicKey("")
			setCursorKey("")
			setSlackToken("")
			setGithubToken("")
			setGoogleClientSecret("")
			setEnrichmentApiKey("")
			setClearSlackToken(false)
			setClearGithubToken(false)
			setClearGoogleSecret(false)
			setClearEnrichmentKey(false)
			setEditingSection(null)
		},
		onError: (err: Error) => {
			toast.error(err.message, "Failed to update configuration")
		},
	})

	return (
		<Card>
			<div className="px-5 py-3 border-b border-line flex justify-between items-center">
				<span className="text-xs tracked text-fg">WORKSPACE CONFIGURATION</span>
				{updateConfig.isPending && (
					<span className="text-xs tracked text-amber">⏳ SAVING CHANGES…</span>
				)}
			</div>
			<div className="p-5 space-y-6">
				{/* Section 1: Org Details */}
				<div>
					<div className="flex justify-between items-center mb-3">
						<div className="text-xs tracked text-amber">/ 01 · ORGANIZATION</div>
						{editingSection === null && (
							<button
								type="button"
								onClick={() => setEditingSection("org")}
								className="flex items-center gap-1.5 text-[9px] tracked text-fg-muted hover:text-amber cursor-pointer transition-colors border-none bg-transparent outline-none"
								title="Edit Organization Details"
							>
								<Edit2 className="h-2.5 w-2.5" strokeWidth={1.5} />
								EDIT
							</button>
						)}
					</div>

					{editingSection !== "org" ? (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<Label className="text-xs tracked text-fg-muted">ORG NAME</Label>
								<p className="mt-1 text-fg text-sm">{adminCfg?.orgName || "—"}</p>
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">ALLOWED EMAIL DOMAINS</Label>
								{adminCfg?.allowedEmailDomains && adminCfg.allowedEmailDomains.length > 0 ? (
									<div className="mt-1 flex flex-wrap gap-1.5">
										{adminCfg.allowedEmailDomains.map((d) => (
											<Badge key={d} variant="secondary" className="font-mono text-xs">
												@{d}
											</Badge>
										))}
									</div>
								) : (
									<p className="mt-1 text-fg text-sm">{adminCfg?.allowedEmailDomain || "Any"}</p>
								)}
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">SELF-SIGNUP</Label>
								<p className="mt-1 text-fg text-sm">
									{adminCfg?.openSignupEnabled ? "Enabled (domain-gated)" : "Invite-only"}
								</p>
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">SPEND VISIBILITY</Label>
								<p className="mt-1 text-fg text-sm">
									{adminCfg?.spendVisibility === "admin_only"
										? "Admin Only"
										: adminCfg?.spendVisibility === "viewer_own"
											? "Viewer Own Spend"
											: "Viewer All Spend"}
								</p>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<Label htmlFor="orgName" className="text-xs tracked text-fg-muted">
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
									<Label htmlFor="domain" className="text-xs tracked text-fg-muted">
										ALLOWED EMAIL DOMAINS (COMMA-SEPARATED, OPTIONAL)
									</Label>
									<Input
										id="domain"
										value={allowedDomain}
										onChange={(e) => setAllowedDomain(e.target.value)}
										placeholder="acme.com, example.com"
										className="mt-1"
									/>
								</div>
								<div>
									<Label className="text-xs tracked text-fg-muted">SELF-SIGNUP</Label>
									<div className="mt-2 flex items-center gap-2 text-xs text-fg-muted select-none">
										<Checkbox
											id="openSignup"
											checked={openSignup}
											onCheckedChange={(checked) => setOpenSignup(Boolean(checked))}
										/>
										<label htmlFor="openSignup" className="cursor-pointer">
											Allow self-signup for {allowedDomain ? "allowed domains" : "any domain"}
										</label>
									</div>
								</div>
								<div>
									<Label className="text-xs tracked text-fg-muted">SPEND VISIBILITY</Label>
									<Select
										value={spendVisibility}
										onValueChange={(val) =>
											setSpendVisibility(val as "admin_only" | "viewer_own" | "viewer_all")
										}
									>
										<SelectTrigger className="mt-1 w-full h-9 bg-transparent border border-line text-fg text-sm">
											<SelectValue placeholder="Select visibility mode" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="admin_only">Admin Only</SelectItem>
											<SelectItem value="viewer_own">Viewer Own Spend</SelectItem>
											<SelectItem value="viewer_all">Viewer All Spend</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
							<div className="flex justify-end gap-2 pt-2">
								<button
									type="button"
									onClick={() => handleCancel("org")}
									className="text-xs px-3 h-7 text-fg-muted hover:text-fg border border-line hover:border-line-strong transition-colors cursor-pointer bg-transparent"
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
						<div className="text-xs tracked text-amber">/ 02 · GOOGLE OAUTH</div>
						{editingSection === null && (
							<button
								type="button"
								onClick={() => setEditingSection("oauth")}
								className="flex items-center gap-1.5 text-[9px] tracked text-fg-muted hover:text-amber cursor-pointer transition-colors border-none bg-transparent outline-none"
								title="Edit Google OAuth Configuration"
							>
								<Edit2 className="h-2.5 w-2.5" strokeWidth={1.5} />
								EDIT
							</button>
						)}
					</div>

					{editingSection !== "oauth" ? (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<Label className="text-xs tracked text-fg-muted">STATUS</Label>
								<p className="mt-1 text-fg text-sm">
									{adminCfg?.googleOauthEnabled ? "Enabled" : "Disabled"}
								</p>
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">AUTH RESTRICTION</Label>
								<p className="mt-1 text-fg text-sm">
									{adminCfg?.passwordAuthDisabled
										? "Password auth disabled (Google Auth only)"
										: "Password & Google Auth allowed"}
								</p>
							</div>
							{adminCfg?.googleOauthEnabled && (
								<>
									<div>
										<Label className="text-xs tracked text-fg-muted">CLIENT ID</Label>
										<p className="mt-1 text-fg text-sm font-mono truncate max-w-xs">
											{adminCfg?.googleClientId || "—"}
										</p>
									</div>
									<div>
										<Label className="text-xs tracked text-fg-muted">CLIENT SECRET</Label>
										<p className="mt-1 text-fg text-sm font-mono">
											{adminCfg?.googleClientSecretSet
												? "•••••••••••• (configured)"
												: "Not configured"}
										</p>
									</div>
									<div>
										<Label className="text-xs tracked text-fg-muted">REDIRECT URI</Label>
										<p className="mt-1 text-fg text-sm font-mono truncate max-w-xs">
											{adminCfg?.googleOauthRedirectUri || "—"}
										</p>
									</div>
								</>
							)}
						</div>
					) : (
						<div className="space-y-4">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<Label className="text-xs tracked text-fg-muted">STATUS</Label>
									<div className="mt-2 flex items-center gap-2 text-xs text-fg-muted select-none">
										<Checkbox
											id="googleOauthEnabled"
											checked={googleOauthEnabled}
											onCheckedChange={(checked) => {
												const isEnabled = Boolean(checked)
												setGoogleOauthEnabled(isEnabled)
												if (!isEnabled) {
													setPasswordAuthDisabled(false)
												}
											}}
										/>
										<label htmlFor="googleOauthEnabled" className="cursor-pointer">
											Enable Google OAuth login
										</label>
									</div>
								</div>

								<div>
									<Label className="text-xs tracked text-fg-muted">AUTH RESTRICTION</Label>
									<div className="mt-2 flex items-center gap-2 text-xs text-fg-muted select-none">
										<Checkbox
											id="passwordAuthDisabled"
											checked={passwordAuthDisabled}
											disabled={!googleOauthEnabled}
											onCheckedChange={(checked) => setPasswordAuthDisabled(Boolean(checked))}
										/>
										<label
											htmlFor="passwordAuthDisabled"
											className={cn(
												"cursor-pointer",
												!googleOauthEnabled && "cursor-not-allowed opacity-50",
											)}
										>
											Disable password login & signup
										</label>
									</div>
									{!googleOauthEnabled && (
										<p className="text-[10px] text-fg-muted mt-1">
											Google OAuth must be enabled to disable password authentication.
										</p>
									)}
								</div>

								{googleOauthEnabled && (
									<>
										<div>
											<Label htmlFor="googleClientId" className="text-xs tracked text-fg-muted">
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
										<SecretField
											id="googleClientSecret"
											label="GOOGLE CLIENT SECRET"
											value={googleClientSecret}
											onChange={setGoogleClientSecret}
											isSet={adminCfg?.googleClientSecretSet}
											cleared={clearGoogleSecret}
											onClearChange={setClearGoogleSecret}
											clearLabel="Clear Secret"
											unsetPlaceholder="Enter client secret"
										/>
										<div>
											<Label
												htmlFor="googleOauthRedirectUri"
												className="text-xs tracked text-fg-muted"
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
									className="text-xs px-3 h-7 text-fg-muted hover:text-fg border border-line hover:border-line-strong transition-colors cursor-pointer bg-transparent"
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
						<div className="text-xs tracked text-amber">/ 03 · CREDENTIALS & API KEYS</div>
						{editingSection === null && (
							<button
								type="button"
								onClick={() => setEditingSection("creds")}
								className="flex items-center gap-1.5 text-[9px] tracked text-fg-muted hover:text-amber cursor-pointer transition-colors border-none bg-transparent outline-none"
								title="Edit Credentials & API Keys"
							>
								<Edit2 className="h-2.5 w-2.5" strokeWidth={1.5} />
								EDIT
							</button>
						)}
					</div>

					{editingSection !== "creds" ? (
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<Label className="text-xs tracked text-fg-muted">ANTHROPIC ADMIN API KEY</Label>
								<p className="mt-1 text-fg text-sm font-mono">
									{adminCfg?.anthropicAdminApiKeySet
										? "•••••••••••• (configured)"
										: "Not configured"}
								</p>
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">CURSOR ADMIN API KEY</Label>
								<p className="mt-1 text-fg text-sm font-mono">
									{adminCfg?.cursorAdminApiKeySet ? "•••••••••••• (configured)" : "Not configured"}
								</p>
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">SLACK BOT TOKEN</Label>
								<p className="mt-1 text-fg text-sm font-mono">
									{adminCfg?.slackBotTokenSet ? "•••••••••••• (configured)" : "Not configured"}
								</p>
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">SLACK CHANNEL ID</Label>
								<p className="mt-1 text-fg text-sm font-mono">{adminCfg?.slackChannelId || "—"}</p>
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">GITHUB ACCESS TOKEN</Label>
								<p className="mt-1 text-fg text-sm font-mono">
									{adminCfg?.githubAccessTokenSet ? "•••••••••••• (configured)" : "Not configured"}
								</p>
							</div>
							<div>
								<Label className="text-xs tracked text-fg-muted">GITHUB ORGANIZATION</Label>
								<p className="mt-1 text-fg text-sm font-mono">{adminCfg?.githubOrg || "—"}</p>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<div className="flex items-center justify-between mb-1">
										<Label htmlFor="anthropic" className="text-xs tracked text-fg-muted">
											ANTHROPIC ADMIN API KEY
										</Label>
										<ValidationStatusPip state={anthropicVal.state} />
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
										<p className="text-xs text-amber-hot mt-1">{anthropicVal.error}</p>
									) : null}
								</div>

								<div>
									<div className="flex items-center justify-between mb-1">
										<Label htmlFor="cursor" className="text-xs tracked text-fg-muted">
											CURSOR ADMIN API KEY
										</Label>
										<ValidationStatusPip state={cursorVal.state} />
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
										<p className="text-xs text-amber-hot mt-1">{cursorVal.error}</p>
									) : null}
								</div>

								<SecretField
									id="slackToken"
									label="SLACK BOT TOKEN"
									value={slackToken}
									onChange={setSlackToken}
									isSet={adminCfg?.slackBotTokenSet}
									cleared={clearSlackToken}
									onClearChange={setClearSlackToken}
									unsetPlaceholder="xoxb-..."
									validation={slackVal}
								/>

								<div>
									<Label htmlFor="slackChannel" className="text-xs tracked text-fg-muted">
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

								<SecretField
									id="githubToken"
									label="GITHUB ACCESS TOKEN"
									value={githubToken}
									onChange={setGithubToken}
									isSet={adminCfg?.githubAccessTokenSet}
									cleared={clearGithubToken}
									onClearChange={setClearGithubToken}
									unsetPlaceholder="ghp_... or github_pat_..."
									validation={githubVal}
								/>

								<div>
									<Label htmlFor="githubOrg" className="text-xs tracked text-fg-muted">
										GITHUB ORGANIZATION
									</Label>
									<Input
										id="githubOrg"
										value={githubOrg}
										onChange={(e) => setGithubOrg(e.target.value)}
										placeholder="GitHub Org Name"
										className="mt-1"
									/>
								</div>

								<div className="md:col-span-2 pt-4 border-t border-line/60">
									<div className="text-xs font-medium text-fg mb-3 font-mono">
										PR ENRICHMENT & AI CLASSIFICATION PROVIDER
									</div>
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div>
											<Label htmlFor="enrichmentProvider" className="text-xs tracked text-fg-muted">
												PROVIDER
											</Label>
											<Select
												value={enrichmentProvider}
												onValueChange={(val: "anthropic" | "openai" | "openai_compatible") =>
													setEnrichmentProvider(val)
												}
											>
												<SelectTrigger
													id="enrichmentProvider"
													className="mt-1 h-9 bg-transparent border-line text-xs"
												>
													<SelectValue placeholder="Select Provider" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="anthropic">Anthropic</SelectItem>
													<SelectItem value="openai">OpenAI</SelectItem>
													<SelectItem value="openai_compatible">
														Custom OpenAI-compatible / Proxy
													</SelectItem>
												</SelectContent>
											</Select>
										</div>

										<div>
											<Label
												htmlFor="enrichmentModelName"
												className="text-xs tracked text-fg-muted"
											>
												MODEL NAME
											</Label>
											<Input
												id="enrichmentModelName"
												value={enrichmentModelName}
												onChange={(e) => setEnrichmentModelName(e.target.value)}
												placeholder="e.g. claude-3-5-haiku-20241022 or gpt-4o-mini"
												className="mt-1"
											/>
										</div>

										<SecretField
											id="enrichmentApiKey"
											label="ENRICHMENT API KEY"
											value={enrichmentApiKey}
											onChange={setEnrichmentApiKey}
											isSet={adminCfg?.enrichmentApiKeySet}
											cleared={clearEnrichmentKey}
											onClearChange={setClearEnrichmentKey}
											clearLabel="Clear Key"
											unsetPlaceholder="API Key for classification"
											className="md:col-span-2"
										/>

										<div className="md:col-span-2">
											<Label
												htmlFor="enrichmentBaseUrl"
												className="text-[10px] tracked text-fg-muted"
											>
												CUSTOM PROXY / BASE URL (OPTIONAL)
											</Label>
											<Input
												id="enrichmentBaseUrl"
												value={enrichmentBaseUrl}
												onChange={(e) => setEnrichmentBaseUrl(e.target.value)}
												placeholder="e.g. https://my-internal-proxy.com/v1"
												className="mt-1"
											/>
										</div>
									</div>
								</div>
							</div>
							<div className="flex justify-end gap-2 pt-2">
								<button
									type="button"
									onClick={() => handleCancel("creds")}
									className="text-xs px-3 h-7 text-fg-muted hover:text-fg border border-line hover:border-line-strong transition-colors cursor-pointer bg-transparent"
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
										slackVal.state === "bad" ||
										githubVal.state === "checking" ||
										githubVal.state === "bad"
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
		</Card>
	)
}
