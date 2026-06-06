import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useLocation } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"

type ValidationState = "idle" | "checking" | "ok" | "bad"

function useDebouncedValidation(
	value: string,
	fn: (v: string, signal: AbortSignal) => Promise<{ ok: boolean; error?: string }>,
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
				const r = await fn(value, ac.signal)
				if (ac.signal.aborted) return
				if (r.ok) {
					setState("ok")
					setError(null)
					lastFingerprintRef.current = fp
				} else {
					setState("bad")
					setError(r.error ?? "Invalid")
				}
			} catch (err) {
				if (ac.signal.aborted) return
				setState("bad")
				setError(err instanceof Error ? err.message : String(err))
			}
		}, delay)

		return () => clearTimeout(t)
	}, [value, fn, delay])

	return { state, error }
}

function StatusPip({ state }: { state: ValidationState }): React.JSX.Element | null {
	if (state === "idle") return null
	if (state === "checking")
		return <span className="text-[10px] tracked text-fg-dim">⏳ CHECKING…</span>
	if (state === "ok") return <span className="text-[10px] tracked text-mint">✓ VALID</span>
	return <span className="text-[10px] tracked text-amber-hot">✗ INVALID</span>
}

export function SetupPage(): React.JSX.Element {
	const [, navigate] = useLocation()
	const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: api.config })

	useEffect(() => {
		if (cfg?.setupCompleted) navigate("/")
	}, [cfg?.setupCompleted, navigate])

	const [orgName, setOrgName] = useState("")
	const [allowedDomain, setAllowedDomain] = useState("")
	const [openSignup, setOpenSignup] = useState(false)
	const [anthropicKey, setAnthropicKey] = useState("")
	const [cursorKey, setCursorKey] = useState("")
	const [slackToken, setSlackToken] = useState("")
	const [slackChannel, setSlackChannel] = useState("")
	const [ccThreshold, setCcThreshold] = useState(50)
	const [cuThreshold, setCuThreshold] = useState(50)

	const anthropicVal = useDebouncedValidation(anthropicKey, async (v, signal) => {
		const r = await fetch("/api/setup/validate-key", {
			method: "POST",
			headers: { "content-type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ provider: "anthropic", key: v }),
			signal,
		})
		return r.json()
	})
	const cursorVal = useDebouncedValidation(cursorKey, async (v, signal) => {
		const r = await fetch("/api/setup/validate-key", {
			method: "POST",
			headers: { "content-type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ provider: "cursor", key: v }),
			signal,
		})
		return r.json()
	})
	const slackVal = useDebouncedValidation(slackToken, async (v, signal) => {
		if (!v) return { ok: true }
		const r = await fetch("/api/setup/validate-key", {
			method: "POST",
			headers: { "content-type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ provider: "slack", key: v, channelId: slackChannel || undefined }),
			signal,
		})
		return r.json()
	})

	const canSave =
		orgName.trim().length > 0 && anthropicVal.state === "ok" && cursorVal.state === "ok"

	const [phase, setPhase] = useState<"form" | "syncing" | "done">("form")
	const [runIds, setRunIds] = useState<string[]>([])

	const save = useMutation({
		mutationFn: () =>
			api.setup.save({
				orgName: orgName.trim(),
				allowedEmailDomain: allowedDomain.trim() || null,
				openSignupEnabled: openSignup,
				anthropicAdminApiKey: anthropicKey,
				cursorAdminApiKey: cursorKey,
				slackBotToken: slackToken.trim() || null,
				slackChannelId: slackChannel.trim() || null,
				claudeCodeDailyThresholdCents: Math.round(ccThreshold * 100),
				cursorDailyThresholdCents: Math.round(cuThreshold * 100),
			}),
	})

	async function handleSubmit(e: React.FormEvent): Promise<void> {
		e.preventDefault()
		if (!canSave) return
		await save.mutateAsync()
		setPhase("syncing")
		// Explicit 365-day backfill, not `sync.run`. The latter's cold-start
		// detection ("is daily_*_usage empty?") races against the hourly cron —
		// if even one cron tick has fired by the time the user finishes the
		// wizard, the table is no longer empty and the lookback collapses to
		// 30 days. Backfill takes an explicit range and is immune to this.
		const r = await api.sync.backfill(365)
		setRunIds(r.runIds)
	}

	const { data: runs = [] } = useQuery({
		queryKey: ["sync.runs", runIds],
		queryFn: () => api.sync.runsByIds(runIds),
		enabled: phase === "syncing" && runIds.length > 0,
		refetchInterval: 750,
	})

	useEffect(() => {
		if (phase !== "syncing") return
		if (runs.length < runIds.length) return
		if (runs.every((r) => r.status === "success" || r.status === "failed")) {
			setPhase("done")
		}
	}, [runs, runIds, phase])

	return (
		<div className="min-h-screen bg-bg text-fg font-mono">
			<div className="max-w-3xl mx-auto px-8 py-12">
				<div className="text-[10px] tracked text-fg-dim mb-2">/ TOKENMAXXER · SETUP</div>
				<h1 className="font-display text-6xl text-fg leading-none tracking-tight">
					First-time setup.
				</h1>
				<p className="text-xs text-fg-mid mt-2">
					One-time configuration. You can edit any of this later in Settings.
				</p>

				{phase === "form" ? (
					<form onSubmit={handleSubmit} className="mt-10 space-y-10">
						<section>
							<div className="text-[10px] tracked text-amber mb-3">/ 01 · ORGANIZATION</div>
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
										required
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
							</div>
							<label className="mt-3 flex items-center gap-2 text-[11px] text-fg-mid">
								<input
									type="checkbox"
									checked={openSignup}
									onChange={(e) => setOpenSignup(e.target.checked)}
								/>
								<span>
									Allow self-signup for {allowedDomain ? `@${allowedDomain}` : "the allowed domain"}{" "}
									addresses
								</span>
							</label>
						</section>

						<section>
							<div className="text-[10px] tracked text-amber mb-3">/ 02 · AI TOOLING KEYS</div>
							<div className="space-y-4">
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
										placeholder="sk-ant-admin-..."
										type="password"
										required
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
										placeholder="key_..."
										type="password"
										required
									/>
									{cursorVal.error ? (
										<p className="text-[10px] text-amber-hot mt-1">{cursorVal.error}</p>
									) : null}
								</div>
							</div>
						</section>

						<section>
							<div className="text-[10px] tracked text-amber mb-3">
								/ 03 · NOTIFICATIONS (OPTIONAL)
							</div>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="md:col-span-2">
									<div className="flex items-center justify-between mb-1">
										<Label htmlFor="slackToken" className="text-[10px] tracked text-fg-dim">
											SLACK BOT TOKEN
										</Label>
										<StatusPip state={slackVal.state} />
									</div>
									<Input
										id="slackToken"
										value={slackToken}
										onChange={(e) => setSlackToken(e.target.value)}
										placeholder="xoxb-..."
										type="password"
									/>
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
								<div className="grid grid-cols-2 gap-2">
									<div>
										<Label className="text-[10px] tracked text-fg-dim">CC ALERT $/DAY</Label>
										<Input
											type="number"
											value={ccThreshold}
											onChange={(e) => setCcThreshold(parseFloat(e.target.value || "0"))}
											className="mt-1"
										/>
									</div>
									<div>
										<Label className="text-[10px] tracked text-fg-dim">CU ALERT $/DAY</Label>
										<Input
											type="number"
											value={cuThreshold}
											onChange={(e) => setCuThreshold(parseFloat(e.target.value || "0"))}
											className="mt-1"
										/>
									</div>
								</div>
							</div>
						</section>

						<Button type="submit" disabled={!canSave || save.isPending} className="w-full">
							{save.isPending ? "SAVING…" : "▶ SAVE & PULL INITIAL DATA"}
						</Button>
					</form>
				) : (
					<SyncProgress runs={runs} done={phase === "done"} onContinue={() => navigate("/")} />
				)}
			</div>
		</div>
	)
}

function SyncProgress({
	runs,
	done,
	onContinue,
}: {
	runs: Array<{ id: string; job: string; status: string; rowsUpserted: number }>
	done: boolean
	onContinue: () => void
}): React.JSX.Element {
	function pillFor(job: string) {
		const r = runs.find((x) => x.job === job)
		if (!r) return <span className="text-[10px] tracked text-fg-dim">⏳ STARTING…</span>
		if (r.status === "running")
			return <span className="text-[10px] tracked text-amber">⏳ RUNNING</span>
		if (r.status === "success")
			return (
				<span className="text-[10px] tracked text-mint">
					✓ {r.rowsUpserted.toLocaleString()} rows
				</span>
			)
		return <span className="text-[10px] tracked text-amber-hot">✗ FAILED</span>
	}

	return (
		<div className="mt-12 space-y-8">
			<div>
				<div className="text-[10px] tracked text-amber mb-3">/ PULLING INITIAL DATA</div>
				<ul className="border border-line">
					<li className="flex items-center justify-between px-4 py-3 border-b border-line">
						<span className="text-xs">Anthropic / Claude Code</span>
						{pillFor("anthropic")}
					</li>
					<li className="flex items-center justify-between px-4 py-3">
						<span className="text-xs">Cursor</span>
						{pillFor("cursor")}
					</li>
				</ul>
			</div>

			{done ? (
				<Button onClick={onContinue} className="w-full">
					VIEW DASHBOARD →
				</Button>
			) : null}
		</div>
	)
}
