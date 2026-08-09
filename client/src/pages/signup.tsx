import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useLocation } from "wouter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Typography } from "@/components/ui/typography"
import { api } from "@/lib/api"

export function SignupPage(): React.JSX.Element {
	const [, navigate] = useLocation()
	const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: api.config })
	const qc = useQueryClient()

	const search = typeof window !== "undefined" ? window.location.search : ""
	const inviteToken = new URLSearchParams(search).get("invite") ?? undefined

	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const headline = cfg?.bootstrapNeeded ? "Set up tokenmaxxer" : "Create your account"
	const sub = cfg?.bootstrapNeeded
		? "Create the admin account. You'll wire up the API keys next."
		: inviteToken
			? "You've been invited. Pick a password to complete registration."
			: "Open signup is enabled for your domain."

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError(null)
		setSubmitting(true)
		try {
			await api.auth.signup(email, password, inviteToken)
			await qc.invalidateQueries({ queryKey: ["me"] })
			if (cfg?.bootstrapNeeded) {
				navigate("/setup")
			} else {
				navigate("/")
			}
		} catch (err) {
			setError((err as Error).message)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-bg">
			<div className="w-full max-w-sm space-y-6">
				<div>
					<Typography variant="label" as="div" className="mb-2">
						/ TOKENMAXXER · REGISTRATION
					</Typography>
					<Typography variant="display-lg" as="h1">
						{headline}
					</Typography>
					<Typography variant="subtle" as="p" className="mt-2">
						{sub}
					</Typography>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<Label htmlFor="email">EMAIL</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							className="mt-1"
						/>
					</div>
					<div>
						<Label htmlFor="password">PASSWORD</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={8}
							className="mt-1"
						/>
						<Typography variant="subtle" as="p" className="mt-1">
							8+ characters.
						</Typography>
					</div>

					{error ? (
						<div className="border-l-2 border-amber-hot pl-3 py-1 text-xs text-amber-hot">
							{error}
						</div>
					) : null}

					<Button type="submit" disabled={submitting} className="w-full">
						{submitting ? "CREATING…" : "▶ CREATE ACCOUNT"}
					</Button>

					<Typography variant="label" as="p" className="text-center block">
						ALREADY HAVE AN ACCOUNT?{" "}
						<a href="/login" className="text-amber hover:underline">
							SIGN IN
						</a>
					</Typography>
				</form>
			</div>
		</div>
	)
}
