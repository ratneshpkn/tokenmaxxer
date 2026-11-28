import { useEffect, useRef, useState } from "react"
import { Typography } from "@/components/ui/typography"
import { api } from "@/lib/api"

export type ValidationState = "idle" | "checking" | "ok" | "bad"
export type KeyProvider = "anthropic" | "cursor" | "slack" | "github"

export function useDebouncedKeyValidation(
	value: string,
	provider: KeyProvider,
	extra?: string,
	delay = 500,
): { state: ValidationState; error: string | null } {
	const [state, setState] = useState<ValidationState>("idle")
	const [error, setError] = useState<string | null>(null)
	const acRef = useRef<AbortController | null>(null)
	const lastFingerprintRef = useRef<string>("")

	useEffect(() => {
		if (!value || value.length < 8) {
			acRef.current?.abort()
			lastFingerprintRef.current = ""
			setState("idle")
			setError(null)
			return
		}
		if (provider === "github" && !extra?.trim()) {
			acRef.current?.abort()
			lastFingerprintRef.current = ""
			setState("bad")
			setError("Please enter your GitHub organization")
			return
		}

		const fp = `${value}|${extra ?? ""}`
		if (fp === lastFingerprintRef.current) return
		setState("checking")
		setError(null)

		const t = setTimeout(async () => {
			acRef.current?.abort()
			const ac = new AbortController()
			acRef.current = ac
			try {
				const res = await api.setup.validateKey(
					provider,
					value,
					provider === "slack" ? extra || undefined : undefined,
					provider === "github" ? extra || undefined : undefined,
					ac.signal,
				)
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

		return () => {
			clearTimeout(t)
			acRef.current?.abort()
		}
	}, [value, provider, extra, delay])

	return { state, error }
}

export function ValidationStatusPip({
	state,
}: {
	state: ValidationState
}): React.JSX.Element | null {
	if (state === "idle") return null
	if (state === "checking") return <Typography variant="label">⏳ CHECKING…</Typography>
	if (state === "ok") {
		return (
			<Typography variant="label" className="text-mint">
				✓ VALID
			</Typography>
		)
	}
	return (
		<Typography variant="label" className="text-amber-hot">
			✗ INVALID
		</Typography>
	)
}
