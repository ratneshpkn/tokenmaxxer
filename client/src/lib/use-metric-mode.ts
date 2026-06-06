import { useEffect, useState } from "react"

/** Global "primary metric" toggle. Persisted in localStorage and synced cross-tab.
 *  Admins can flip the dashboard between cost-primary and tokens-primary. */

const STORAGE_KEY = "tokenmaxxer.metricMode"
const EVENT = "tokenmaxxer:metric-mode-changed"

export type MetricMode = "cost" | "tokens"

function readInitial(): MetricMode {
	if (typeof window === "undefined") return "cost"
	const v = window.localStorage.getItem(STORAGE_KEY)
	return v === "tokens" ? "tokens" : "cost"
}

export function useMetricMode(): [MetricMode, () => void] {
	const [mode, setMode] = useState<MetricMode>(readInitial)

	useEffect(() => {
		const handler = (): void => setMode(readInitial())
		window.addEventListener(EVENT, handler)
		window.addEventListener("storage", handler) // cross-tab sync
		return () => {
			window.removeEventListener(EVENT, handler)
			window.removeEventListener("storage", handler)
		}
	}, [])

	function toggle(): void {
		const next: MetricMode = readInitial() === "cost" ? "tokens" : "cost"
		window.localStorage.setItem(STORAGE_KEY, next)
		window.dispatchEvent(new Event(EVENT))
	}

	return [mode, toggle]
}
