import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useLocation } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"

export function SignupPage(): React.JSX.Element {
	const [, navigate] = useLocation()
	const params = new URLSearchParams(window.location.search)
	const inviteToken = params.get("token") ?? undefined

	const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: api.config })

	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const headline = cfg?.bootstrapNeeded ? "Set up tokenmaxxer" : "Create your account"
	const sub = cfg?.bootstrapNeeded
		? "Create the admin account. You'll wire up the API keys next."
		: inviteToken
			? "Accept your invitation."
			: `Self-signup for @${cfg?.allowedEmailDomain ?? "your-org"} addresses.`

	async function handleSubmit(e: React.FormEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		setSubmitting(true)
		try {
			const res = await api.auth.signup(email, password, inviteToken)
			if (res.role === "admin" && cfg?.bootstrapNeeded) {
				navigate("/setup")
			} else {
				navigate("/")
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			setError(msg.replace(/^\d+\s+\/api\/auth\/signup:\s*/, ""))
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-bg">
			<form onSubmit={handleSubmit} className="w-[420px] max-w-[90vw] space-y-5">
				<div>
					<div className="text-[10px] tracked text-fg-dim mb-2">/ TOKENMAXXER · SIGNUP</div>
					<h1 className="font-display text-5xl text-fg leading-none tracking-tight">{headline}</h1>
					<p className="text-xs text-fg-mid mt-2">{sub}</p>
				</div>

				<div className="space-y-3">
					<div>
						<Label htmlFor="email" className="text-[10px] tracked text-fg-dim">
							EMAIL
						</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							autoFocus
							className="mt-1"
						/>
					</div>
					<div>
						<Label htmlFor="password" className="text-[10px] tracked text-fg-dim">
							PASSWORD
						</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={8}
							className="mt-1"
						/>
						<p className="text-[10px] text-fg-very-dim mt-1">8+ characters.</p>
					</div>
				</div>

				{error ? (
					<div className="border-l-2 border-amber-hot pl-3 py-1 text-[11px] text-amber-hot">
						{error}
					</div>
				) : null}

				<Button type="submit" disabled={submitting} className="w-full">
					{submitting ? "CREATING…" : "▶ CREATE ACCOUNT"}
				</Button>

				<p className="text-[10px] tracked text-fg-dim text-center">
					ALREADY HAVE AN ACCOUNT?{" "}
					<a href="/login" className="text-amber hover:underline">
						SIGN IN
					</a>
				</p>
			</form>
		</div>
	)
}
