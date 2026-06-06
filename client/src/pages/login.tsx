import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Redirect, useLocation } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"

export function LoginPage(): React.JSX.Element {
	const [, navigate] = useLocation()
	const params = new URLSearchParams(window.location.search)
	const oauthErr = params.get("error")

	const { data: cfg, isLoading: cfgLoading } = useQuery({
		queryKey: ["config"],
		queryFn: api.config,
	})

	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Fresh deployment, no users yet — send the visitor to signup, not login.
	// "Welcome back" makes no sense for someone who's never been here.
	if (!cfgLoading && cfg?.bootstrapNeeded) {
		return <Redirect to="/signup" />
	}

	async function handleSubmit(e: React.FormEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		setSubmitting(true)
		try {
			await api.auth.login(email, password)
			navigate("/")
		} catch {
			setError("Invalid credentials")
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-bg">
			<div className="w-[420px] max-w-[90vw] space-y-5">
				<div>
					<div className="text-[10px] tracked text-fg-dim mb-2">/ TOKENMAXXER · SIGN IN</div>
					<h1 className="font-display text-5xl text-fg leading-none tracking-tight">
						Welcome back.
					</h1>
					<p className="text-xs text-fg-mid mt-2">{cfg?.orgName || "tokenmaxxer"}</p>
				</div>

				{oauthErr === "unauthorized" ? (
					<div className="border-l-2 border-amber-hot pl-3 py-1 text-[11px] text-amber-hot">
						ACCESS DENIED · this email is not allowed
					</div>
				) : null}

				<form onSubmit={handleSubmit} className="space-y-3">
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
							className="mt-1"
						/>
					</div>
					{error ? (
						<div className="border-l-2 border-amber-hot pl-3 py-1 text-[11px] text-amber-hot">
							{error}
						</div>
					) : null}
					<Button type="submit" disabled={submitting} className="w-full">
						{submitting ? "SIGNING IN…" : "▶ SIGN IN"}
					</Button>
				</form>

				{cfg?.googleOauthEnabled ? (
					<>
						<div className="flex items-center gap-3 text-[10px] tracked text-fg-very-dim">
							<span className="flex-1 h-px bg-line" /> OR <span className="flex-1 h-px bg-line" />
						</div>
						<Button
							variant="outline"
							className="w-full"
							onClick={() => {
								window.location.href = "/api/auth/google"
							}}
						>
							▶ SIGN IN WITH GOOGLE
						</Button>
					</>
				) : null}

				{cfg?.bootstrapNeeded || cfg?.openSignupEnabled ? (
					<p className="text-[10px] tracked text-fg-dim text-center">
						DON'T HAVE AN ACCOUNT?{" "}
						<a href="/signup" className="text-amber hover:underline">
							SIGN UP
						</a>
					</p>
				) : null}
			</div>
		</div>
	)
}
